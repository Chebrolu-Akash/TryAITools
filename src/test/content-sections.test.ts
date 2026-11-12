// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in tests */
// Content sections (courses & books, gadgets, sponsored guest articles, blog covers) and image uploads: admin CRUD and
// workflow rules against the real migrations, what the public pages may read, Markdown images, the sitemap and the gate.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import type { MediaBucket } from "@/lib/admin/media";
import { createContentReader } from "@/lib/content/reader";
import { parseMarkdown } from "@/lib/markdown";
import { serveMedia } from "@/lib/media-serve";
import { classify, decide, type Freshness } from "@/static/freshness";
import { contentEntries, replaceContent, sitemapFromDb } from "@/static/sitemap";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";

afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000;
const ORIGIN = "https://admin.test";
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REVIEW = "A useful review. ".repeat(30); // > 300 characters: allowed to be indexed

/** A minimal PNG header (signature + IHDR with width/height): enough for the byte sniffer. */
const png = (w = 64, h = 48) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const fakeBucket = () => {
  const files = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket: MediaBucket & { get: (k: string) => Promise<any> } = {
    async put(key, value, o) {
      files.set(key, {
        bytes: value instanceof Uint8Array ? value : new Uint8Array(value),
        ...(o?.httpMetadata?.contentType ? { type: o.httpMetadata.contentType } : {}),
      });
      return null;
    },
    async delete(key) {
      files.delete(key);
    },
    async get(key) {
      const f = files.get(key);
      return f
        ? { body: new Blob([f.bytes as BlobPart]).stream(), size: f.bytes.length, httpEtag: '"e1"' }
        : null;
    },
  };
  return { bucket, files };
};

const course = (o: Record<string, unknown> = {}) => ({
  client_id: UUID(1),
  slug: "prompting-101",
  kind: "course",
  title: "Prompting 101",
  provider_or_author: "Example Academy",
  summary: "Learn to write prompts.",
  review_md: "",
  level: "beginner",
  is_free: false,
  affiliate_url: "https://academy.example.com/p101?ref=tai",
  topics: ["Prompts"],
  featured: true,
  sort_order: 0,
  indexing: "noindex",
  ...o,
});
const guest = (o: Record<string, unknown> = {}) => ({
  client_id: UUID(2),
  slug: "agents-at-work",
  title: "Agents at work",
  excerpt: "How teams use AI agents.",
  body_md: "Read more on [our site](https://sponsor.example.com).",
  contributor_name: "Sam Writer",
  contributor_email: "Sam@Sponsor.example.com",
  sponsor_name: "Sponsor Inc",
  sponsor_url: "https://sponsor.example.com",
  sponsor_label: "Sponsored",
  payment_status: "unpaid",
  payment_ref: "INV-42",
  indexing: "index",
  ...o,
});
const updateOf = (body: Record<string, unknown>, updated_at: string) => {
  const { client_id: _c, slug: _s, ...rest } = body;
  return { ...rest, updated_at };
};

describe("content sections", () => {
  let key!: TestKey;
  let db: TestDb;
  let tick = 0;
  let token = "";
  let media = fakeBucket();
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  beforeEach(async () => {
    db = createTestDb();
    tick = 0;
    media = fakeBucket();
    token = await signJwt(key, goodClaims(NOW));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    o: { type?: string; raw?: BodyInit } = {},
  ) => {
    const headers: Record<string, string> = { "cf-access-jwt-assertion": token };
    if (method !== "GET")
      Object.assign(headers, {
        "x-requested-with": "tryaitools-admin",
        origin: ORIGIN,
        "content-type": o.type ?? "application/json",
      });
    const res = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method,
        headers,
        body: o.raw ?? (body === undefined ? null : JSON.stringify(body)),
      }),
      {
        env: async () => goodEnv,
        db: async () => db,
        media: async () => media.bucket,
        now: () => `2026-10-26T10:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks: staticJwks(key), nowSeconds: NOW },
      },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const version = () =>
    db.raw.prepare("SELECT value FROM meta WHERE key = 'content_version'").get()?.value;

  describe("admin: courses", () => {
    it("creates a draft (idempotently), edits it, and publishes only when complete", async () => {
      const v0 = version();
      const a = await call("POST", "courses", course());
      expect(a.status).toBe(201);
      expect(a.json.item).toMatchObject({ status: "draft", featured: true, topics: ["Prompts"] });
      expect(version()).not.toBe(v0); // the static site re-checks content pages
      expect((await call("POST", "courses", course())).status).toBe(200); // same client_id: no second row
      expect(db.raw.prepare("SELECT count(*) AS n FROM courses").get().n).toBe(1);

      const noLink = await call(
        "PUT",
        "courses/prompting-101",
        updateOf(course({ affiliate_url: null }), a.json.item.updated_at),
      );
      expect(noLink.status).toBe(200);
      const blocked = await call("POST", "courses/prompting-101/action", {
        action: "publish",
        updated_at: noLink.json.item.updated_at,
      });
      expect(blocked.status).toBe(422);

      const fixed = await call(
        "PUT",
        "courses/prompting-101",
        updateOf(course(), noLink.json.item.updated_at),
      );
      const pub = await call("POST", "courses/prompting-101/action", {
        action: "publish",
        updated_at: fixed.json.item.updated_at,
      });
      expect(pub.status).toBe(200);
      expect(pub.json.item.status).toBe("published");
      expect(pub.json.item.published_at).toBeTruthy();
      // published entries cannot be deleted
      const del = await call("DELETE", "courses/prompting-101", {
        updated_at: pub.json.item.updated_at,
        confirm: "prompting-101",
      });
      expect(del.status).toBe(409);
    });

    it("rejects http affiliate links, unknown fields, and indexing a thin page", async () => {
      expect(
        (await call("POST", "courses", course({ affiliate_url: "http://x.example" }))).status,
      ).toBe(422);
      expect((await call("POST", "courses", course({ status: "published" }))).status).toBe(422);
      const thin = await call("POST", "courses", course({ indexing: "index" }));
      expect(thin.status).toBe(422);
      expect(thin.json.error.fields.indexing).toMatch(/300/);
      expect(
        (await call("POST", "courses", course({ indexing: "index", review_md: REVIEW }))).status,
      ).toBe(201);
    });

    it("refuses a stale edit (optimistic concurrency)", async () => {
      const a = await call("POST", "courses", course());
      await call("PUT", "courses/prompting-101", updateOf(course(), a.json.item.updated_at));
      const stale = await call(
        "PUT",
        "courses/prompting-101",
        updateOf(course(), a.json.item.updated_at),
      );
      expect(stale.status).toBe(409);
    });
  });

  describe("admin: sponsored guest articles", () => {
    it("can only be published once paid, and stays paid while published", async () => {
      const a = await call("POST", "guest-articles", guest());
      expect(a.status).toBe(201);
      expect(a.json.item.contributor_email).toBe("sam@sponsor.example.com"); // the admin sees it
      const review = await call("POST", "guest-articles/agents-at-work/action", {
        action: "send_to_review",
        updated_at: a.json.item.updated_at,
      });
      expect(review.json.item.status).toBe("review");
      const unpaid = await call("POST", "guest-articles/agents-at-work/action", {
        action: "publish",
        updated_at: review.json.item.updated_at,
      });
      expect(unpaid.status).toBe(422);
      expect(unpaid.json.error.message).toMatch(/paid/);

      const paid = await call(
        "PUT",
        "guest-articles/agents-at-work",
        updateOf(guest({ payment_status: "paid" }), review.json.item.updated_at),
      );
      const pub = await call("POST", "guest-articles/agents-at-work/action", {
        action: "publish",
        updated_at: paid.json.item.updated_at,
      });
      expect(pub.json.item.status).toBe("published");
      const refund = await call(
        "PUT",
        "guest-articles/agents-at-work",
        updateOf(guest({ payment_status: "refunded" }), pub.json.item.updated_at),
      );
      expect(refund.status).toBe(409);
      expect(refund.json.error.fields.payment_status).toBeTruthy();
    });

    it("a cover image needs alt text", async () => {
      const r = await call("POST", "guest-articles", guest({ cover_image_id: UUID(9) }));
      expect(r.status).toBe(422);
      expect(r.json.error.fields.cover_alt).toBeTruthy();
    });
  });

  describe("public reader", () => {
    const publishGuest = async () => {
      const a = await call("POST", "guest-articles", guest({ payment_status: "paid" }));
      await call("POST", "guest-articles/agents-at-work/action", {
        action: "publish",
        updated_at: a.json.item.updated_at,
      });
    };

    it("never returns a contributor email or payment details", async () => {
      await publishGuest();
      const r = createContentReader(db);
      const out = JSON.stringify([
        await r.list("guest-articles"),
        await r.item("guest-articles", "agents-at-work"),
      ]);
      expect(out).toContain("Sponsor Inc");
      for (const secret of ["sam@sponsor", "INV-42", "payment", "contributor_email", "paid"])
        expect(out.toLowerCase()).not.toContain(secret.toLowerCase());
    });

    it("shows published entries only", async () => {
      await call("POST", "courses", course());
      const r = createContentReader(db);
      expect(await r.list("courses")).toEqual([]);
      expect(await r.item("courses", "prompting-101")).toBeNull();
    });

    it("reads a database without the content tables as empty", async () => {
      const bare = createTestDb({ migrations: false });
      bare.raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      const r = createContentReader(bare);
      expect(await r.list("gadgets")).toEqual([]);
      expect(await r.item("blog", "x")).toBeNull();
      expect(await contentEntries(bare)).toEqual([]);
    });
  });

  describe("images", () => {
    const upload = (bytes: Uint8Array, type = "image/png", alt = "A chart") =>
      call("POST", `media?alt=${encodeURIComponent(alt)}`, undefined, {
        type,
        raw: bytes as BodyInit,
      });

    it("stores a checked image in R2 and the media table, and serves it by its public URL", async () => {
      const r = await upload(png(640, 480));
      expect(r.status).toBe(201);
      const { id, url, width, height } = r.json.media;
      expect(url).toBe(`/media/${id}.png`);
      expect([width, height]).toEqual([640, 480]);
      expect(media.files.has(`media/${id}.png`)).toBe(true);
      const res = await serveMedia(new Request(`https://x.test${url}`), media.bucket);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(
        (await serveMedia(new Request(`https://x.test/media/${id}.jpg`), media.bucket)).status,
      ).toBe(404);
      expect(
        (await serveMedia(new Request("https://x.test/media/../secret.png"), media.bucket)).status,
      ).toBe(404);
    });

    it("refuses SVG, mislabelled bytes, other content types and files over 2 MB", async () => {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
      expect((await upload(svg, "image/svg+xml")).status).toBe(415); // not an accepted upload type
      expect((await upload(svg, "image/png")).status).toBe(415); // claims PNG, bytes are not
      expect((await upload(png(), "text/plain")).status).toBe(415);
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(png());
      expect((await upload(big)).status).toBe(413);
      expect(media.files.size).toBe(0);
    });

    it("an upload is a write: it needs the CSRF header like every other write", async () => {
      const res = await handleAdminApi(
        new Request(`${ORIGIN}/api/admin/media`, {
          method: "POST",
          headers: {
            "cf-access-jwt-assertion": token,
            origin: ORIGIN,
            "content-type": "image/png",
          },
          body: png() as BodyInit,
        }),
        {
          env: async () => goodEnv,
          db: async () => db,
          media: async () => media.bucket,
          auth: { jwks: staticJwks(key), nowSeconds: NOW },
        },
      );
      expect(res.status).toBe(403);
      // and JSON endpoints still refuse an image body
      expect(
        (await call("POST", "courses", undefined, { type: "image/png", raw: png() as BodyInit }))
          .status,
      ).toBe(415);
    });

    it("an image in use (as a cover or inside Markdown) cannot be deleted", async () => {
      const { id, url } = (await upload(png())).json.media;
      const a = await call("POST", "courses", course({ review_md: `![Chart](${url})` }));
      expect(a.status).toBe(201);
      expect((await call("DELETE", `media/${id}`, {})).status).toBe(409);
      await call(
        "PUT",
        "courses/prompting-101",
        updateOf(course({ review_md: "" }), a.json.item.updated_at),
      );
      expect((await call("DELETE", `media/${id}`, {})).status).toBe(200);
      expect(media.files.size).toBe(0);
    });
  });

  describe("Markdown images", () => {
    it("embeds only images uploaded through the admin", () => {
      const id = UUID(5);
      const [p] = parseMarkdown(
        `![ok](/media/${id}.webp) ![x](https://evil.example/a.png) ![y](/media/${id}.svg)`,
      );
      const nodes = (p as any).c;
      expect(nodes.filter((n: any) => n.t === "img")).toEqual([
        { t: "img", src: `/media/${id}.webp`, alt: "ok" },
      ]);
      expect(JSON.stringify(nodes)).not.toContain("evil.example");
    });
  });

  describe("sitemap and gate", () => {
    it("lists a section once it has a published entry, and only indexable self-canonical entries", async () => {
      const before = await sitemapFromDb(db);
      expect(before.some((e) => e.path.startsWith("/learn"))).toBe(false); // empty: hub and listings stay out
      const a = await call("POST", "courses", course({ indexing: "index", review_md: REVIEW }));
      await call("POST", "courses/prompting-101/action", {
        action: "publish",
        updated_at: a.json.item.updated_at,
      });
      const b = await call("POST", "courses", course({ client_id: UUID(3), slug: "thin-one" }));
      await call("POST", "courses/thin-one/action", {
        action: "publish",
        updated_at: b.json.item.updated_at,
      });
      const g = await call(
        "POST",
        "guest-articles",
        guest({ payment_status: "paid", canonical_url: "https://sponsor.example.com/original" }),
      );
      await call("POST", "guest-articles/agents-at-work/action", {
        action: "publish",
        updated_at: g.json.item.updated_at,
      });
      const paths = (await contentEntries(db)).map((e) => e.path);
      // the hub, the course listing with its indexable course; no empty /learn/books or /learn/tutorials
      expect(paths).toEqual([
        "/learn",
        "/learn/courses",
        "/learn/courses/prompting-101",
        "/guest-articles",
      ]);
      const merged = replaceContent(
        [
          { path: "/", changefreq: "daily", priority: 1 },
          { path: "/learn/courses/old", changefreq: "monthly", priority: 0.6 },
        ],
        await contentEntries(db),
      );
      expect(merged.map((e) => e.path)).toEqual(["/", ...paths]);
    });

    it("serves content pages statically only while content_version equals the build", () => {
      const f: Freshness = {
        version: "v",
        unchanged: true,
        contentUnchanged: true,
        hiddenTools: new Set(),
        changedTools: new Set(),
        hiddenCategories: new Set(),
        changedCategories: new Set(),
        affected: new Set(["/blog/links-a-hidden-tool"]),
      };
      const page = (p: string) =>
        classify(p) as Exclude<ReturnType<typeof classify>, { kind: "pass" }>;
      expect(classify("/learn/courses/")).toEqual({
        kind: "content",
        section: "learn",
        slug: null,
        path: "/learn/courses",
      });
      expect(classify("/learn")).toMatchObject({ kind: "content", path: "/learn" });
      expect(classify("/learn/books/a-book")).toMatchObject({
        slug: "a-book",
        path: "/learn/books/a-book",
      });
      expect(classify("/learn/other").kind).toBe("pass");
      expect(classify("/courses").kind).toBe("pass"); // old URL: the gate redirects it before classifying
      expect(classify("/blog/hello-world")).toMatchObject({ kind: "content", slug: "hello-world" });
      expect(classify("/blog/a/b").kind).toBe("pass");
      expect(decide(page("/learn/courses"), f)).toBe("static");
      expect(decide(page("/blog/links-a-hidden-tool"), f)).toBe("dynamic");
      expect(decide(page("/learn/courses"), { ...f, contentUnchanged: false })).toBe("dynamic");
      expect(decide(page("/tools/x"), { ...f, contentUnchanged: false })).toBe("static"); // the catalogue is unaffected
    });
  });
});
