// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, adminRequest, qs } from "@/components/admin/client";
import {
  categoryPayload,
  csvToList,
  emptyCategoryForm,
  emptyPostForm,
  emptyToolForm,
  linesToList,
  newClientId,
  postPayload,
  slugify,
  toolFormFromApi,
  toolPayload,
} from "@/components/admin/forms";
import { MarkdownView } from "@/components/admin/MarkdownView";
import { AdminApp } from "@/components/admin/AdminApp";
import { handleAdminApi } from "@/lib/admin/api";
import type { JwksProvider } from "@/lib/admin/jwt";
import { adminPageHeaders, guardAdminPage, isAdminPagePath } from "@/lib/admin/guard";
import {
  blogCreateSchema,
  categoryCreateSchema,
  toolCreateSchema,
  toolUpdateSchema,
} from "@/lib/admin/validation";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  OWNER,
  type TestKey,
} from "./helpers/access-jwt";

afterEach(() => vi.restoreAllMocks());
import { assertSqliteAvailable, createTestDb } from "./helpers/sqlite-d1";

const NOW = 1_800_000_000;
const ORIGIN = "https://admin.test";

describe("admin page gate (server-side)", () => {
  let key!: TestKey;
  let jwks!: JwksProvider;
  let deps!: { jwks: JwksProvider; nowSeconds: number };
  beforeAll(async () => {
    key = await makeKey("k1");
    jwks = staticJwks(key);
    deps = { jwks, nowSeconds: NOW };
  });
  const req = (path: string, token?: string) =>
    new Request(`${ORIGIN}${path}`, { headers: token ? { "cf-access-jwt-assertion": token } : {} });
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));

  it("does not touch public pages, even when admin is not configured", async () => {
    for (const p of [
      "/",
      "/tools/chatgpt",
      "/categories",
      "/sitemap.xml",
      "/administrator",
      "/about",
    ])
      expect(await guardAdminPage(req(p), {}, deps)).toBeNull();
  });
  it("401 without a token", async () => {
    const r = (await guardAdminPage(req("/admin"), goodEnv, deps))!;
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("401 for a forged token, 403 for a non-owner, 503 when not configured", async () => {
    const other = await makeKey("k1");
    expect(
      (await guardAdminPage(req("/admin", await signJwt(other, goodClaims(NOW))), goodEnv, deps))!
        .status,
    ).toBe(401);
    expect(
      (await guardAdminPage(
        req("/admin", await signJwt(key, goodClaims(NOW, { email: "stranger@example.test" }))),
        goodEnv,
        deps,
      ))!.status,
    ).toBe(403);
    expect(
      (await guardAdminPage(req("/admin", await signJwt(key, goodClaims(NOW))), {}, deps))!.status,
    ).toBe(503);
  });
  it("lets a verified owner through", async () => {
    expect(
      await guardAdminPage(
        req("/admin?view=tools", await signJwt(key, goodClaims(NOW))),
        goodEnv,
        deps,
      ),
    ).toBeNull();
  });
  it("guards every path the router would treat as /admin (case, encoding, slashes, sub-paths)", async () => {
    for (const p of [
      "/admin",
      "/admin/",
      "/Admin",
      "/ADMIN/tools",
      "/%61dmin",
      "/%2561dmin",
      "//admin",
      "/admin%2Ftools",
      "/%61%64%6d%69%6e/x",
      "/\\admin",
    ]) {
      expect(isAdminPagePath(p), p).toBe(true);
      expect((await guardAdminPage(req(p), goodEnv, deps))?.status, p).toBe(401);
    }
    for (const p of ["/administrator", "/admins", "/tools/admin", "/"])
      expect(isAdminPagePath(p), p).toBe(false);
  });
  it("leaves malformed escapes on public URLs to the router (no admin 401 page for junk)", async () => {
    for (const p of ["/%E0%A4%A", "/tools/%", "/%zz"]) {
      expect(isAdminPagePath(p), p).toBe(false);
      expect(await guardAdminPage(req(p), goodEnv, deps), p).toBeNull();
    }
  });
  it("sets no-store and noindex headers for served admin pages", () => {
    expect(adminPageHeaders).toEqual({
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    });
  });
});

describe("admin client", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("sends the CSRF header and JSON only on writes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = async (url: string, init?: RequestInit) => (
      calls.push({ url, init: init! }),
      json(200, { ok: 1 })
    );
    await adminRequest("GET", "stats", undefined, f);
    await adminRequest("POST", "/tools", { a: 1 }, f);
    expect(calls[0].url).toBe("/api/admin/stats");
    expect((calls[0].init.headers as Record<string, string>)["x-requested-with"]).toBeUndefined();
    expect(calls[1].url).toBe("/api/admin/tools");
    const h = calls[1].init.headers as Record<string, string>;
    expect(h["x-requested-with"]).toBe("tryaitools-admin");
    expect(h["content-type"]).toBe("application/json");
    expect(calls[1].init.credentials).toBe("same-origin");
  });
  it("surfaces server errors with field messages", async () => {
    const f = async () =>
      json(422, {
        error: {
          code: "validation_failed",
          message: "Please fix",
          fields: { name: "Name is required" },
        },
      });
    await expect(adminRequest("POST", "tools", {}, f)).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
      fields: { name: "Name is required" },
    });
  });
  it("never treats a non-JSON response (e.g. an Access login page) as success", async () => {
    const f = async () => new Response("<html>login</html>", { status: 200 });
    await expect(adminRequest("GET", "stats", undefined, f)).rejects.toBeInstanceOf(AdminApiError);
    const f2 = async () => new Response("<html>denied</html>", { status: 403 });
    await expect(adminRequest("GET", "stats", undefined, f2)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("reports network failure as not saved", async () => {
    await expect(
      adminRequest("PUT", "tools/x", {}, async () => {
        throw new Error("offline");
      }),
    ).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
  it("qs drops empty values", () =>
    expect(qs({ q: "a b", status: "", page: 2, review: false, x: undefined })).toBe(
      "?q=a+b&page=2",
    ));
});

describe("form helpers build payloads the server accepts", () => {
  it("slugify / lists / client id", () => {
    expect(slugify("  Hello, World & Co! ")).toBe("hello-world-and-co");
    expect(linesToList("a\n\n b \r\nc")).toEqual(["a", "b", "c"]);
    expect(csvToList("x, y,,z")).toEqual(["x", "y", "z"]);
    expect(newClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("tool payload passes the create and update schemas; empty strings become null", () => {
    const f = {
      ...emptyToolForm("cat-a"),
      slug: "my-tool",
      name: "My Tool",
      url: "https://my.example.com",
      featuresText: "One\nTwo",
      tagsText: "a, b",
    };
    const create = toolCreateSchema.safeParse({
      client_id: newClientId(),
      slug: f.slug,
      ...toolPayload(f),
    });
    expect(create.success).toBe(true);
    expect((create as any).data.tagline).toBeNull();
    expect((create as any).data.features).toEqual(["One", "Two"]);
    expect(
      toolUpdateSchema.safeParse({ updated_at: "2026-01-01T00:00:00.000Z", ...toolPayload(f) })
        .success,
    ).toBe(true);
  });
  it("a record round-trips through the form unchanged", () => {
    const api = {
      slug: "s",
      name: "N",
      url: "https://n.example.com",
      category_id: "c",
      subcategory: "Sub",
      tags: ["a"],
      features: ["x", "y"],
      pros: null,
      indexing: "index",
    };
    const f = toolFormFromApi(api);
    expect(f.featuresText).toBe("x\ny");
    expect(toolPayload(f).features).toEqual(["x", "y"]);
    expect(toolPayload(f).pros).toEqual([]);
    expect(f.indexing).toBe("index");
  });
  it("category and blog payloads pass their schemas", () => {
    const c = {
      ...emptyCategoryForm(),
      slug: "new-cat",
      name: "New Cat",
      subcategoriesText: "A\nB",
    };
    expect(categoryCreateSchema.safeParse({ slug: c.slug, ...categoryPayload(c) }).success).toBe(
      true,
    );
    const p = { ...emptyPostForm(), slug: "hello", title: "Hello", body_md: "# Hi" };
    expect(
      blogCreateSchema.safeParse({ client_id: newClientId(), slug: p.slug, ...postPayload(p) })
        .success,
    ).toBe(true);
  });
  it("the server still rejects what the browser lets through (server-side validation is the authority)", () => {
    const bad = {
      ...emptyToolForm("cat-a"),
      slug: "Bad Slug",
      name: "",
      url: "javascript:alert(1)",
    };
    const r = toolCreateSchema.safeParse({
      client_id: newClientId(),
      slug: bad.slug,
      ...toolPayload(bad),
    });
    expect(r.success).toBe(false);
  });
});

describe("form payloads against the real API and SQLite", () => {
  it("a SQLite engine is available (never skipped)", () => assertSqliteAvailable());
  let key!: TestKey;
  beforeAll(async () => {
    key = await makeKey("k1");
  });
  it("creates a tool and a post from form payloads, persisted", async () => {
    const db = createTestDb({
      seed: [
        "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('cat-a','cat-a','Cat A','[\"Sub\"]',1,'published')",
      ],
    });
    const token = await signJwt(key, goodClaims(NOW));
    const call = async (method: string, path: string, body: unknown) =>
      handleAdminApi(
        new Request(`${ORIGIN}/api/admin/${path}`, {
          method,
          headers: {
            "cf-access-jwt-assertion": token,
            "x-requested-with": "tryaitools-admin",
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        {
          env: async () => goodEnv,
          db: async () => db,
          auth: { jwks: staticJwks(key), nowSeconds: NOW },
        },
      );
    const tf = {
      ...emptyToolForm("cat-a"),
      slug: "ui-tool",
      name: "UI Tool",
      url: "https://ui.example.com",
      subcategory: "Sub",
    };
    const r = await call("POST", "tools", {
      client_id: newClientId(),
      slug: tf.slug,
      ...toolPayload(tf),
    });
    expect(r.status).toBe(201);
    expect(
      db.raw.prepare("SELECT status, content_source FROM tools WHERE slug='ui-tool'").get(),
    ).toMatchObject({ status: "draft", content_source: "admin" });
    const pf = {
      ...emptyPostForm(),
      slug: "ui-post",
      title: "UI Post",
      excerpt: "x",
      body_md: "# Hi <script>alert(1)</script>",
    };
    expect(
      (await call("POST", "blog", { client_id: newClientId(), slug: pf.slug, ...postPayload(pf) }))
        .status,
    ).toBe(201);
    expect(
      db.raw.prepare("SELECT status FROM blog_posts WHERE slug='ui-post'").get(),
    ).toMatchObject({ status: "draft" });
  });
});

describe("rendering safety", () => {
  const html = (md: string) => renderToStaticMarkup(<MarkdownView source={md} />);
  it("escapes raw HTML and script text instead of interpreting it", () => {
    const out = html(
      '# Title\n\n<script>alert(1)</script> <img src=x onerror="alert(1)"> <b>bold</b>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("drops javascript:, data: and protocol-relative links; hardens external ones", () => {
    const out = html(
      "[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.test) [d](https://ok.example.com/x) [e](/about)",
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text");
    expect(out).not.toContain("evil.test");
    expect(out).toContain('href="https://ok.example.com/x"');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(out).toContain('href="/about"');
  });
  it("cannot break out of an attribute: quotes in URLs are percent-encoded, no event-handler attribute appears", () => {
    const out = html('[x](https://a.example.com/"onmouseover="alert(1))');
    expect(out).toContain("%22onmouseover=%22");
    expect(/<a\b[^>]*\sonmouseover=/i.test(out)).toBe(false);
    expect(/<[a-z][^>]*\son[a-z]+=/i.test(out)).toBe(false);
  });
  it("shows an empty state", () => expect(html("")).toContain("Nothing to preview"));
  it("admin UI source never uses raw-HTML sinks or dynamic code", () => {
    const dir = resolve(process.cwd(), "src/components/admin");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(
        /dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(
          src,
        ),
        f,
      ).toBe(false);
    }
  });
  it("the admin shell renders without crashing and shows no data before the session is verified", () => {
    const out = renderToStaticMarkup(<AdminApp search={{}} nav={() => {}} />);
    expect(out).toContain("Checking your sign-in");
    expect(out).not.toContain(OWNER);
  });
});
