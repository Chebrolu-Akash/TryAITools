// The Worker's front door when a static build is deployed (bundled as .output/server/gate.mjs by
// scripts/static/build-gate.mjs; the app's own entry is passed in as `app`).
//
//   GET /api/search                     JSON search from the build's search index (search.ts), no React, no D1 scan
//   GET /sitemap.xml, /sitemaps/<n>.xml the build's sitemap, kept current between builds (sitemap.ts)
//   GET public pages                    static HTML if still accurate (see freshness.ts), else the app renders it, or 404
//   GET /media/<id>.<ext>               an uploaded image, straight from R2 (media-serve.ts)
//   GET /api/stats                      footer statistics from GA4 (src/lib/stats.ts; off until configured)
//   GET /_static/*                      never public (build metadata)
//   /admin*, /api/*, /_serverFn/*       the app (admin, admin API, server functions)
//   anything else                       the static 404 page (no React, no D1)
//
// The gate's own code is small and loaded at Worker startup, so a page served from static HTML costs a D1 version read
// and an asset fetch, not a React render.
//
// D1 failures: pages fail closed (503) unless this isolate verified the catalogue within FAIL_OPEN_WINDOW_MS. Search and
// the sitemap always fail closed: they list many tools at once, and a crawler or a search box can simply retry.
import { normalizeToolsQuery, PAGE_SIZE } from "@/lib/catalog/views";
import type { D1DatabaseLike } from "@/lib/db/types";
import { SECURITY_HEADERS } from "@/lib/security-headers";
import { SITE_URL } from "@/lib/site";
import {
  changesSince,
  classify,
  decide,
  LEGACY_COURSES,
  type BuildInfo,
  type Freshness,
} from "./freshness";
import {
  SEARCH_INDEX_PATH,
  searchListSince,
  searchPage,
  type SearchIndex,
  type SearchList,
} from "./search";
import {
  contentEntries,
  isSitemapPath,
  replaceContent,
  SITEMAP_DATA_PATH,
  sitemapFiles,
  sitemapSince,
  type SitemapBase,
} from "./sitemap";
import { legacyCoursePath } from "@/lib/content/legacy";
import { serveMedia, type MediaReader } from "@/lib/media-serve";
import { handleStats, STATS_PATH } from "@/lib/stats";

type Fetcher = { fetch(input: Request | string): Promise<Response> };
type Env = { DB?: D1DatabaseLike; ASSETS?: Fetcher } & Record<string, unknown>;
export type App = { fetch(request: Request, env: Env, ctx: unknown): Promise<Response> | Response };
/** The AI News cron module (src/lib/news/cron.ts), loaded only when a Cron Trigger fires. */
export type CronModule = {
  scheduled(
    controller: unknown,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<void>;
};

export const BUILD_INFO_PATH = "/_static/build.json";
/** Old tool slug -> current slug, for redirects that already existed when the pages were built. */
export const REDIRECTS_PATH = "/_static/redirects.json";
export const refsPath = (kind: "tool" | "category", slug: string) =>
  `/_static/refs/${kind === "tool" ? "t" : "c"}/${slug}.json`;
/** A verified state may be reused this long when D1 is briefly unreachable (pages only). */
export const FAIL_OPEN_WINDOW_MS = 60_000;
/** Paths the app itself must answer when a static build is deployed (case-insensitive, like the router). */
const APP_PATH = /^\/(admin|api|_serverFn)(\/|$)/i;
const TOOL_IS_PUBLIC = `SELECT 1 AS ok FROM tools t JOIN categories c ON c.id = t.category_id
  WHERE t.slug = ? AND t.status = 'published' AND t.needs_review = 0 AND c.status = 'published'`;
const CATEGORY_IS_PUBLIC = "SELECT 1 AS ok FROM categories WHERE slug = ? AND status = 'published'";

const withHeaders = (res: Response, extra: Record<string, string> = {}) => {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
const json = (body: unknown, status = 200) =>
  withHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    { "cache-control": "no-store" },
  );
const unavailable = (body = "Temporarily unavailable") =>
  withHeaders(new Response(body, { status: 503 }), {
    "retry-after": "5",
    "cache-control": "no-store",
  });
const xml = (body: string | ReadableStream | null) =>
  withHeaders(
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
    }),
    { "cache-control": "public, max-age=0, must-revalidate" },
  );

/** One value per catalogue version, computed once per isolate; an older version's result never replaces a newer one. */
function perVersion<T>() {
  let done: { version: string; seq: number; value: T } | null = null;
  let pending: { version: string; promise: Promise<T> } | null = null;
  return (version: string, seq: number, compute: () => Promise<T>): Promise<T> => {
    if (done?.version === version) return Promise.resolve(done.value);
    if (pending?.version !== version) {
      const promise = compute().then((value) => {
        if (!done || seq >= done.seq) done = { version, seq, value };
        return value;
      });
      pending = { version, promise };
      void promise.then(
        () => pending?.promise === promise && (pending = null),
        () => pending?.promise === promise && (pending = null),
      );
    }
    return pending.promise;
  };
}

export function createGate(
  app: App,
  opts: { now?: () => number; cron?: () => Promise<CronModule> } = {},
) {
  const now = opts.now ?? (() => Date.now());
  let build: BuildInfo | null | undefined; // undefined = not loaded yet, null = no static build deployed
  let state: { freshness: Freshness; at: number; seq: number } | null = null;
  let pending: { version: string; promise: Promise<Freshness> } | null = null;
  let reads = 0;
  const assetJson = new Map<string, Promise<unknown>>(); // build files never change within a deployment
  const searchLists = perVersion<SearchList>();
  const sitemaps = perVersion<Map<string, string>>();

  async function buildInfo(env: Env): Promise<BuildInfo | null> {
    if (build !== undefined) return build;
    if (!env.ASSETS) return (build = null);
    const res = await env.ASSETS.fetch(new Request(`https://assets.invalid${BUILD_INFO_PATH}`));
    build = res.ok ? ((await res.json()) as BuildInfo) : null;
    return build;
  }

  /** A build file (search index, sitemap entries), parsed once per isolate. Throws if the build has none. */
  function buildFile<T>(env: Env, path: string): Promise<T> {
    let p = assetJson.get(path);
    if (!p) {
      p = env.ASSETS!.fetch(new Request(`https://assets.invalid${path}`)).then((res) => {
        if (!res.ok) throw new Error(`build file ${path} missing`);
        return res.json();
      });
      p.catch(() => assetJson.delete(path));
      assetJson.set(path, p);
    }
    return p as Promise<T>;
  }

  async function referencing(env: Env, kind: "tool" | "category", slug: string): Promise<string[]> {
    const res = await env.ASSETS!.fetch(
      new Request(`https://assets.invalid${refsPath(kind, slug)}`),
    );
    return res.ok ? ((await res.json()) as string[]) : [];
  }

  /** Keeps the newest result: `seq` is taken before reading the version, so it follows the order versions were seen. */
  const store = (freshness: Freshness, seq: number) => {
    if (!state || seq >= state.seq) state = { freshness, at: now(), seq };
  };

  /** The freshness state for the current catalogue version (computed once per version per isolate). */
  async function freshness(
    env: Env,
    info: BuildInfo,
  ): Promise<Freshness & { seq: number; contentVersion: string; newsVersion: string }> {
    const db = env.DB!;
    const seq = ++reads;
    // All versions in one primary-key read.
    const { results } = await db
      .prepare(
        "SELECT key, value FROM meta WHERE key IN ('catalog_version', 'content_version', 'news_version')",
      )
      .all<Record<string, unknown>>();
    const meta = new Map(results.map((r) => [r["key"], String(r["value"] ?? "")]));
    const version = meta.get("catalog_version") ?? "";
    const contentVersion = meta.get("content_version") ?? "";
    const newsVersion = meta.get("news_version") ?? "";
    // A build without contentVersion (made before the content sections) never serves them statically; same for news.
    const contentUnchanged =
      info.contentVersion !== undefined && contentVersion === info.contentVersion;
    const newsUnchanged = info.newsVersion !== undefined && newsVersion === info.newsVersion;
    const withContent = (f: Freshness) => ({
      ...f,
      contentUnchanged,
      newsUnchanged,
      seq,
      contentVersion,
      newsVersion,
    });
    if (state && state.freshness.version === version) {
      state.at = now(); // verified just now
      if (seq >= state.seq)
        state.freshness = { ...state.freshness, contentUnchanged, newsUnchanged };
      return withContent(state.freshness);
    }
    if (version === info.snapshotVersion) {
      const f: Freshness = {
        version,
        unchanged: true,
        contentUnchanged,
        newsUnchanged,
        hiddenTools: new Set(),
        changedTools: new Set(),
        hiddenCategories: new Set(),
        changedCategories: new Set(),
        affected: new Set(),
      };
      store(f, seq);
      return withContent(f);
    }
    // Share an in-flight computation only for the SAME version: a request that has seen a newer version must never be
    // answered with an older state (it could miss a tool that was just hidden).
    if (pending?.version !== version) {
      const promise = (async () => {
        const c = await changesSince(db, info.snapshotAt);
        const lists = await Promise.all([
          ...[...c.hiddenTools].map((s) => referencing(env, "tool", s)),
          ...[...c.hiddenCategories].map((s) => referencing(env, "category", s)),
        ]);
        const f: Freshness = {
          version,
          unchanged: false,
          contentUnchanged,
          newsUnchanged,
          ...c,
          affected: new Set(lists.flat()),
        };
        store(f, seq);
        return f;
      })();
      pending = { version, promise };
      void promise.then(
        () => pending?.promise === promise && (pending = null),
        () => pending?.promise === promise && (pending = null),
      );
    }
    return withContent(await pending!.promise);
  }

  async function serveStatic(env: Env, request: Request, path: string): Promise<Response | null> {
    const url = new URL(path, request.url);
    const res = await env.ASSETS!.fetch(new Request(url, request));
    if (res.status === 404) return null; // not pre-built (e.g. published after the build)
    return withHeaders(res, { "cache-control": "public, max-age=0, must-revalidate" });
  }

  async function notFound(env: Env, request: Request): Promise<Response> {
    const page = await env.ASSETS!.fetch(new Request(new URL("/404", request.url)));
    const body = page.ok ? page.body : "Not found";
    return withHeaders(
      new Response(body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }),
      { "cache-control": "no-store", "x-robots-tag": "noindex" },
    );
  }

  async function search(env: Env, info: BuildInfo, url: URL): Promise<Response> {
    try {
      const f = await freshness(env, info);
      const index = await buildFile<SearchIndex>(env, SEARCH_INDEX_PATH);
      const list = f.unchanged
        ? index
        : await searchLists(f.version, f.seq, () =>
            searchListSince(env.DB!, index, info.snapshotAt, f.hiddenTools),
          );
      const q = Object.fromEntries(url.searchParams);
      return json(
        searchPage(list, normalizeToolsQuery({ ...q, page: Number(q["page"] ?? 1) }), PAGE_SIZE),
      );
    } catch (e) {
      console.error("gate: search failed", e instanceof Error ? e.message : e);
      return json({ error: "Search is temporarily unavailable." }, 503);
    }
  }

  async function sitemap(env: Env, info: BuildInfo, request: Request, path: string) {
    try {
      const f = await freshness(env, info);
      if (f.unchanged && f.contentUnchanged && f.newsUnchanged) {
        const res = await env.ASSETS!.fetch(new Request(new URL(path, request.url)));
        return res.ok ? xml(res.body) : notFound(env, request);
      }
      const base = await buildFile<SitemapBase>(env, SITEMAP_DATA_PATH);
      const key = `${f.version}|${f.contentVersion}|${f.newsVersion}`;
      const files = await sitemaps(key, f.seq, async () => {
        const entries = f.unchanged
          ? base.entries
          : await sitemapSince(env.DB!, base, (slug) => referencing(env, "tool", slug));
        // News entries are part of the content entries (contentEntries reads both).
        return sitemapFiles(
          f.contentUnchanged && f.newsUnchanged
            ? entries
            : replaceContent(entries, await contentEntries(env.DB!, SITE_URL)),
          SITE_URL,
        );
      });
      const body = files.get(path);
      return body === undefined ? notFound(env, request) : xml(body);
    } catch (e) {
      console.error("gate: sitemap failed", e instanceof Error ? e.message : e);
      return unavailable();
    }
  }

  return {
    // AI News Cron Trigger: the ingestion code lives in a separate bundle, loaded only here.
    async scheduled(
      controller: unknown,
      env: Env,
      ctx: { waitUntil(p: Promise<unknown>): void },
    ): Promise<void> {
      if (!opts.cron) return;
      await (await opts.cron()).scheduled(controller, env, ctx);
    },

    async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      if (url.pathname.startsWith("/_static/")) return notFound(env, request);
      const read = method === "GET" || method === "HEAD";
      // Footer statistics: GA4 totals, cached (no D1, no app).
      if (url.pathname === STATS_PATH && read) return withHeaders(await handleStats(env));
      // Uploaded images: straight from R2, no D1 and no app.
      if (url.pathname.startsWith("/media/"))
        return serveMedia(request, (env["MEDIA"] as MediaReader | undefined) ?? null);
      const isSearch = url.pathname === "/api/search";
      const isSitemap = isSitemapPath(url.pathname);
      const page = classify(url.pathname);
      if (!env.DB || !env.ASSETS) return app.fetch(request, env, ctx);
      const info = await buildInfo(env);
      if (!info) return app.fetch(request, env, ctx); // no static build deployed: the app renders as before
      if (read && isSearch) return search(env, info, url);
      if (read && isSitemap) return sitemap(env, info, request, url.pathname);
      // Only the admin, the APIs and server functions need the app. Any other unknown path (bots probing
      // /wp-login.php, /x.html, ...) gets the static 404 page: no React render, no D1 read.
      if (APP_PATH.test(url.pathname)) return app.fetch(request, env, ctx);
      // Old AI Courses URLs: the listing moved to /learn/courses; an entry's new URL depends on its kind (course or
      // book), which the app looks up and answers with a 301 (or 404).
      const legacy = read ? LEGACY_COURSES.exec(url.pathname) : null;
      if (legacy && !legacy[1])
        return withHeaders(
          new Response(null, { status: 301, headers: { location: `/learn/courses${url.search}` } }),
          { "cache-control": "public, max-age=3600" },
        );
      if (legacy) {
        let to: string | null;
        try {
          to = await legacyCoursePath(env.DB, legacy[1]!);
        } catch (e) {
          console.error("gate: legacy lookup failed", e instanceof Error ? e.message : e);
          return unavailable();
        }
        return to
          ? withHeaders(
              new Response(null, { status: 301, headers: { location: `${to}${url.search}` } }),
              { "cache-control": "public, max-age=3600" },
            )
          : notFound(env, request);
      }
      if (!read || page.kind === "pass") return notFound(env, request);
      // One URL per page: /tools/x/ (and /about/, /tools/, ...) redirect permanently to the canonical form, query kept.
      if (url.pathname !== page.path)
        return withHeaders(
          new Response(null, { status: 301, headers: { location: page.path + url.search } }),
          { "cache-control": "public, max-age=3600" },
        );

      let f: Freshness;
      try {
        f = await freshness(env, info);
      } catch (e) {
        console.error("gate: D1 check failed", e instanceof Error ? e.message : e);
        if (!state || now() - state.at > FAIL_OPEN_WINDOW_MS) return unavailable();
        f = state.freshness; // verified within the last minute
      }
      const decision = decide(page, f);
      if (decision === "not-found") return notFound(env, request);
      // AI News: search and pagination live in the query string, which a static file cannot answer; an article published
      // after the build has no file. Both are rendered by the app (which answers 404 for an unknown article).
      if (page.kind === "news") {
        if (decision === "static" && !url.search) {
          const res = await serveStatic(env, request, page.path);
          if (res) return res;
        }
        return app.fetch(request, env, ctx);
      }
      if (decision === "static") {
        // Once anything has changed, a pre-built tool or category page is served only after its row confirms it is still
        // public (one indexed lookup). Renames, deletions or edits that change detection did not see go to the app
        // instead, which answers with the current page, the 301 for an old tool slug, or 404.
        if ((page.kind === "tool" || page.kind === "category") && !f.unchanged) {
          let ok = false;
          try {
            const sql = page.kind === "tool" ? TOOL_IS_PUBLIC : CATEGORY_IS_PUBLIC;
            ok = !!(await env.DB.prepare(sql).bind(page.slug).first());
          } catch (e) {
            console.error("gate: row check failed", e instanceof Error ? e.message : e);
            return unavailable();
          }
          if (!ok) return app.fetch(request, env, ctx);
        }
        const res = await serveStatic(env, request, page.path);
        if (res) return res;
        // Content unchanged since the build: every published entry was pre-built, so a missing file is a 404.
        if (page.kind === "content") return notFound(env, request);
        // Not pre-built while the catalogue equals the build: every public page was pre-built, so this is an old tool
        // slug (301 from the build's redirect list) or a URL that does not exist (404). Neither needs the React app.
        const redirects = f.unchanged
          ? await buildFile<Record<string, string>>(env, REDIRECTS_PATH).catch(
              () => null, // a build without the list (older build): let the app decide, as before
            )
          : null;
        if (redirects) {
          const to = page.kind === "tool" ? redirects[page.slug] : undefined;
          return to
            ? withHeaders(
                new Response(null, {
                  status: 301,
                  headers: { location: `/tools/${to}${url.search}` },
                }),
                { "cache-control": "public, max-age=3600" },
              )
            : notFound(env, request);
        }
      }
      return app.fetch(request, env, ctx);
    },
  };
}
