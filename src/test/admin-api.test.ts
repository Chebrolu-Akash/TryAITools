// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in tests */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi, MAX_BODY_BYTES } from "@/lib/admin/api";
import type { JwksProvider } from "@/lib/admin/jwt";
import {
  AUD,
  goodClaims,
  goodEnv,
  makeKey,
  OWNER,
  signJwt,
  staticJwks,
  brokenJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { assertSqliteAvailable, createTestDb, type TestDb } from "./helpers/sqlite-d1";

afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000;
const ORIGIN = "https://admin.test";
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SEED = [
  "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('cat-a','cat-a','Category A','[\"Sub One\",\"Sub Two\"]',1,'published')",
  "INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES ('cat-old','cat-old','Old Category','[]',2,'archived')",
  "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,import_issue,updated_at) VALUES ('t1','alpha','Alpha','https://alpha.example.com','cat-a','Sub One','published','index',0,NULL,'2026-01-01T00:00:00.000Z')",
  "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,import_issue,updated_at) VALUES ('t2','tool-name','Tool Name','https://Website','cat-a','Sub Two','draft','noindex',1,'placeholder_name','2026-01-01T00:00:00.000Z')",
  "INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,updated_at) VALUES ('t3','no-url','No Url','','cat-a',NULL,'draft','noindex',0,'2026-01-01T00:00:00.000Z')",
];

const toolBody = (o: Record<string, unknown> = {}) => ({
  client_id: UUID(1),
  slug: "new-tool",
  name: "New Tool",
  url: "https://new.example.com",
  category_id: "cat-a",
  subcategory: "Sub One",
  indexing: "noindex",
  tags: [],
  ...o,
});
const rawTool = (db: TestDb, slug: string) =>
  db.raw.prepare("SELECT * FROM tools WHERE slug = ?").get(slug);
const count = (db: TestDb, table: string) =>
  db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n as number;

describe("admin API", () => {
  it("a SQLite engine is available, so these tests really run (never skipped)", () =>
    assertSqliteAvailable());

  let key!: TestKey;
  let stranger!: TestKey;
  beforeAll(async () => {
    key = await makeKey("k1");
    stranger = await makeKey("k1");
  });
  const tokenFor = (k: TestKey = key, over: Record<string, unknown> = {}) =>
    signJwt(k, goodClaims(NOW, over));
  let db: TestDb;
  let tick = 0;
  let env: Record<string, unknown> = goodEnv;
  let jwks!: JwksProvider;
  let ownerToken = "";

  beforeEach(async () => {
    db = createTestDb({ seed: SEED });
    tick = 0;
    env = goodEnv;
    jwks = staticJwks(key);
    ownerToken = await tokenFor();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const call = async (
    method: string,
    path: string,
    o: {
      body?: unknown;
      token?: string | null;
      headers?: Record<string, string>;
      csrf?: boolean;
      rawBody?: string;
      dbOverride?: TestDb | null;
    } = {},
  ) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    const token = o.token === undefined ? ownerToken : o.token;
    if (token) headers["cf-access-jwt-assertion"] = token;
    if (method !== "GET" && o.csrf !== false)
      Object.assign(headers, {
        "x-requested-with": "tryaitools-admin",
        origin: ORIGIN,
        "content-type": "application/json",
      });
    const body = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const res = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, { method, headers, body }),
      {
        env: async () => env,
        db: async () => (o.dbOverride === undefined ? db : o.dbOverride),
        now: () => `2026-10-26T10:00:${String(++tick).padStart(2, "0")}.000Z`,
        auth: { jwks, nowSeconds: NOW },
      },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, text, headers: res.headers };
  };

  describe("authentication and authorization on every endpoint", () => {
    const endpoints: [string, string, unknown?][] = [
      ["GET", "session"],
      ["GET", "stats"],
      ["GET", "tools"],
      ["GET", "tools/alpha"],
      ["POST", "tools", toolBody()],
      ["PUT", "tools/alpha", {}],
      ["POST", "tools/alpha/action", { action: "archive", updated_at: "x" }],
      ["GET", "categories"],
      ["POST", "categories", {}],
      ["PUT", "categories/cat-a", {}],
      ["GET", "blog"],
      ["GET", "blog/x"],
      ["POST", "blog", {}],
      ["PUT", "blog/x", {}],
      ["POST", "blog/x/action", {}],
      ["DELETE", "tools/alpha", { updated_at: "x", confirm: "alpha" }],
      ["DELETE", "categories/cat-old", { updated_at: "x", confirm: "cat-old" }],
      ["DELETE", "blog/x", { updated_at: "x", confirm: "x" }],
      ["GET", "does/not/exist"],
      ["GET", "../etc/passwd"],
    ];
    it("rejects every direct request without a token with 401 and changes nothing", async () => {
      const before = count(db, "tools") + count(db, "categories") + count(db, "audit_events");
      for (const [m, p, b] of endpoints) {
        const r = await call(m, p, { token: null, body: b });
        expect(r.status, `${m} ${p}`).toBe(401);
        expect(r.text).not.toContain("alpha");
      }
      expect(count(db, "tools") + count(db, "categories") + count(db, "audit_events")).toBe(before);
    });
    it("rejects a forged identity header without a JWT", async () => {
      const r = await call("GET", "tools", {
        token: null,
        headers: { "cf-access-authenticated-user-email": OWNER },
      });
      expect(r.status).toBe(401);
    });
    it("rejects tokens signed by an unknown key, with the wrong audience, or expired (401)", async () => {
      for (const t of [
        await tokenFor(stranger),
        await tokenFor(key, { aud: ["b".repeat(64)] }),
        await tokenFor(key, { exp: NOW - 10 }),
      ]) {
        for (const [m, p, b] of endpoints.slice(0, 6))
          expect((await call(m, p, { token: t, body: b })).status).toBe(401);
      }
    });
    it("rejects an authenticated user who is not an owner with 403 on reads and writes", async () => {
      const t = await tokenFor(key, { email: "stranger@example.test" });
      for (const [m, p, b] of endpoints.slice(0, 15))
        expect((await call(m, p, { token: t, body: b })).status, `${m} ${p}`).toBe(403);
      expect(count(db, "tools")).toBe(3);
    });
    it("fails closed with 503 when Access or the owner allowlist is not configured", async () => {
      env = { ...goodEnv, OWNER_EMAILS: "" };
      expect((await call("GET", "session")).status).toBe(503);
      env = { ACCESS_TEAM_DOMAIN: goodEnv.ACCESS_TEAM_DOMAIN };
      expect((await call("GET", "tools")).status).toBe(503);
    });
    it("fails closed with 503 when the signing keys are unreachable", async () => {
      jwks = brokenJwks;
      expect((await call("GET", "session")).status).toBe(503);
    });
    it("returns the owner for a valid session and never caches responses", async () => {
      const r = await call("GET", "session");
      expect(r.json).toEqual({ email: OWNER, mode: "access" });
      expect(r.headers.get("cache-control")).toBe("no-store");
    });
    it("rejects writes without CSRF protections even when authenticated", async () => {
      expect((await call("POST", "tools", { body: toolBody(), csrf: false })).status).toBe(403);
      expect(
        (
          await call("POST", "tools", {
            body: toolBody(),
            headers: {
              "x-requested-with": "tryaitools-admin",
              origin: "https://evil.test",
              "content-type": "application/json",
            },
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call("POST", "tools", {
            body: toolBody(),
            headers: {
              "x-requested-with": "tryaitools-admin",
              origin: ORIGIN,
              "content-type": "text/plain",
            },
            csrf: false,
          })
        ).status,
      ).toBe(415);
      expect(count(db, "tools")).toBe(3);
    });
    it("returns 405 for unsupported methods once authorized", async () => {
      expect((await call("PATCH", "tools/alpha", { body: {} })).status).toBe(405);
      expect((await call("DELETE", "tools", { body: {} })).status).toBe(405);
      expect((await call("DELETE", "tools/alpha/action", { body: {} })).status).toBe(405);
      expect(rawTool(db, "alpha")).toBeTruthy();
    });
    it("a delete without CSRF protections is refused before anything is read", async () => {
      const r = await call("DELETE", "tools/alpha", { body: {}, csrf: false });
      expect(r.status).toBe(403);
      expect(rawTool(db, "alpha")).toBeTruthy();
    });
  });

  describe("dashboard", () => {
    it("reports counts for tools, categories and blog posts from D1", async () => {
      const r = await call("GET", "stats");
      expect(r.status).toBe(200);
      expect(r.json.tools).toMatchObject({
        total: 3,
        published: 1,
        draft: 2,
        review: 0,
        needs_review: 1,
        indexable: 1,
      });
      expect(r.json.categories.total).toBe(2);
      expect(r.json.blog).toMatchObject({ available: true, total: 0 });
    });
    it("says so when the blog migration has not been applied instead of inventing numbers", async () => {
      db.raw.exec("DROP TABLE blog_posts");
      expect((await call("GET", "stats")).json.blog).toEqual({ available: false });
    });
  });

  describe("tool listing and search", () => {
    it("lists, filters and paginates", async () => {
      expect((await call("GET", "tools")).json.total).toBe(3);
      expect(
        (await call("GET", "tools?status=published")).json.items.map((t: any) => t.slug),
      ).toEqual(["alpha"]);
      expect((await call("GET", "tools?review=1")).json.items.map((t: any) => t.slug)).toEqual([
        "tool-name",
      ]);
      expect((await call("GET", "tools?q=alp")).json.items.length).toBe(1);
      expect((await call("GET", "tools?pageSize=1&page=2")).json.items.length).toBe(1);
      expect((await call("GET", "tools?pageSize=9999")).json.pageSize).toBe(100);
    });
    it("treats SQL and LIKE metacharacters as plain text", async () => {
      expect(
        (await call("GET", `tools?q=${encodeURIComponent("'; DROP TABLE tools;--")}`)).json.total,
      ).toBe(0);
      expect(count(db, "tools")).toBe(3);
      expect((await call("GET", `tools?q=${encodeURIComponent("%")}`)).json.total).toBe(0);
      expect(
        (await call("GET", `tools?status=${encodeURIComponent("x' OR '1'='1")}`)).json.total,
      ).toBe(3); // unknown filter ignored
    });
    it("404s for unknown slugs and 400s for malformed ones", async () => {
      expect((await call("GET", "tools/nope")).status).toBe(404);
      expect((await call("GET", "tools/Bad_Slug")).status).toBe(400);
      expect((await call("GET", "tools/%E0%A4%A")).status).toBe(400);
    });
  });

  describe("create tool", () => {
    it("creates a draft, persists it, and writes an audit row", async () => {
      const r = await call("POST", "tools", {
        body: toolBody({ tagline: "Short", features: ["One", "Two"] }),
      });
      expect(r.status).toBe(201);
      expect(r.json.tool).toMatchObject({
        slug: "new-tool",
        status: "draft",
        indexing: "noindex",
        content_source: "admin",
        features: ["One", "Two"],
      });
      const row = rawTool(db, "new-tool");
      expect(row).toMatchObject({ name: "New Tool", status: "draft", needs_review: 0 });
      expect(db.raw.prepare("SELECT actor_email, action FROM audit_events").all()).toEqual([
        { actor_email: OWNER, action: "tool.create" },
      ]);
      expect((await call("GET", "tools/new-tool")).json.tool.name).toBe("New Tool"); // survives a reload
    });
    it("is idempotent: retrying the same request creates nothing new", async () => {
      expect((await call("POST", "tools", { body: toolBody() })).status).toBe(201);
      const retry = await call("POST", "tools", { body: toolBody() });
      expect(retry.status).toBe(200);
      expect(retry.json.created).toBe(false);
      expect(count(db, "tools")).toBe(4);
      expect(count(db, "audit_events")).toBe(1);
    });
    it("409s on a duplicate slug from a different form", async () => {
      const r = await call("POST", "tools", {
        body: toolBody({ slug: "alpha", client_id: UUID(2) }),
      });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("slug_taken");
      expect(count(db, "tools")).toBe(3);
    });
    it("rejects invalid input with 422 and per-field messages, saving nothing", async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ url: "javascript:alert(1)" }, "url"],
        [{ url: "ftp://x.example.com" }, "url"],
        [{ url: "https://user:pw@x.example.com" }, "url"],
        [{ url: "not a url" }, "url"],
        [{ name: "" }, "name"],
        [{ name: "x".repeat(121) }, "name"],
        [{ slug: "Bad Slug" }, "slug"],
        [{ slug: "a" }, "slug"],
        [{ slug: "double--hyphen" }, "slug"],
        [{ client_id: "not-a-uuid" }, "client_id"],
        [{ features: new Array(21).fill("x") }, "features"],
        [{ canonical_url: "javascript:1" }, "canonical_url"],
        [{ indexing: "maybe" }, "indexing"],
        [{ name: "bad\u0000name" }, "name"],
      ];
      for (const [over, field] of cases) {
        const r = await call("POST", "tools", { body: toolBody(over) });
        expect(r.status, JSON.stringify(over)).toBe(422);
        expect(Object.keys(r.json.error.fields), JSON.stringify(over)).toContain(field);
      }
      expect((await call("POST", "tools", { body: { ...toolBody(), extra: "x" } })).status).toBe(
        422,
      ); // unknown fields rejected
      expect(count(db, "tools")).toBe(3);
    });
    it("validates category and subcategory references", async () => {
      expect(
        (await call("POST", "tools", { body: toolBody({ category_id: "missing" }) })).json.error
          .fields.category_id,
      ).toBeTruthy();
      expect(
        (
          await call("POST", "tools", {
            body: toolBody({ category_id: "cat-old", subcategory: null }),
          })
        ).json.error.fields.category_id,
      ).toBeTruthy();
      expect(
        (await call("POST", "tools", { body: toolBody({ subcategory: "Nope" }) })).json.error.fields
          .subcategory,
      ).toBeTruthy();
      expect(
        (await call("POST", "tools", { body: toolBody({ indexing: "index" }) })).json.error.fields
          .indexing,
      ).toBeTruthy();
      expect(count(db, "tools")).toBe(3);
    });
    it("stores script-like text as inert plain text (rendered escaped by React)", async () => {
      const r = await call("POST", "tools", {
        body: toolBody({
          name: "<script>alert(1)</script>",
          tagline: "<img src=x onerror=alert(1)>",
        }),
      });
      expect(r.status).toBe(201);
      expect(r.json.tool.name).toBe("<script>alert(1)</script>");
    });
    it("413s oversized bodies and 400s invalid JSON", async () => {
      expect(
        (await call("POST", "tools", { rawBody: "x".repeat(MAX_BODY_BYTES + 1) })).status,
      ).toBe(413);
      expect((await call("POST", "tools", { rawBody: "{not json" })).status).toBe(400);
    });
  });

  describe("update tool", () => {
    const edit = async (over: Record<string, unknown> = {}, slug = "alpha") => {
      const cur = (await call("GET", `tools/${slug}`)).json.tool;
      const { client_id: _c, slug: _s, ...fields } = toolBody();
      return call("PUT", `tools/${slug}`, {
        body: {
          ...fields,
          name: cur.name,
          url: cur.url,
          category_id: cur.category_id,
          subcategory: cur.subcategory,
          indexing: cur.indexing,
          updated_at: cur.updated_at,
          ...over,
        },
      });
    };
    it("persists edits, bumps updated_at, keeps the slug, and audits", async () => {
      const r = await edit({ name: "Alpha Renamed", tagline: "New tagline", pros: ["Fast"] });
      expect(r.status).toBe(200);
      expect(r.json.tool).toMatchObject({
        slug: "alpha",
        name: "Alpha Renamed",
        tagline: "New tagline",
        pros: ["Fast"],
        content_source: "admin",
      });
      expect((await call("GET", "tools/alpha")).json.tool.name).toBe("Alpha Renamed");
      expect(db.raw.prepare("SELECT action FROM audit_events").all()).toEqual([
        { action: "tool.update" },
      ]);
    });
    it("409s on a stale updated_at (lost-update protection) and saves nothing", async () => {
      const r = await edit({ name: "Stale", updated_at: "2020-01-01T00:00:00.000Z" });
      expect(r.status).toBe(409);
      expect(rawTool(db, "alpha").name).toBe("Alpha");
      expect(count(db, "audit_events")).toBe(0);
    });
    it("refuses to enable indexing on a tool that is not published", async () => {
      const r = await edit({ indexing: "index" }, "no-url");
      expect(r.status).toBe(422);
      expect(rawTool(db, "no-url").indexing).toBe("noindex");
    });
    it("lets an untouched legacy subcategory pass and rejects a changed invalid one", async () => {
      db.raw.exec("UPDATE tools SET subcategory='Legacy' WHERE slug='alpha'");
      expect((await edit({ subcategory: "Legacy" })).status).toBe(200);
      expect((await edit({ subcategory: "Other Legacy" })).status).toBe(422);
    });
    it("404s for a missing tool", async () => {
      const r = await call("PUT", "tools/nope", {
        body: {
          ...toolBody(),
          client_id: undefined,
          slug: undefined,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      });
      expect(r.status).toBe(404);
      expect((await call("GET", "tools/nope")).status).toBe(404);
    });
  });

  describe("review / publish workflow", () => {
    const act = async (slug: string, action: string) => {
      const cur = (await call("GET", `tools/${slug}`)).json.tool;
      return call("POST", `tools/${slug}/action`, { body: { action, updated_at: cur.updated_at } });
    };
    it("blocks publishing a tool that is flagged as needing review", async () => {
      const r = await act("tool-name", "publish");
      expect(r.status).toBe(409);
      expect(rawTool(db, "tool-name").status).toBe("draft");
    });
    it("blocks publishing without a valid official URL even after the flag is cleared", async () => {
      expect((await act("tool-name", "clear_needs_review")).status).toBe(200);
      const r = await act("tool-name", "publish"); // url is the placeholder https://Website (no dot)
      expect(r.status).toBe(422);
      expect(rawTool(db, "tool-name").status).toBe("draft");
      const noUrl = await act("no-url", "publish");
      expect(noUrl.status).toBe(422);
    });
    it("walks draft -> review -> published -> unpublished -> archived -> restored, persisting each step", async () => {
      await call("POST", "tools", { body: toolBody() });
      for (const [action, status, indexing] of [
        ["send_to_review", "review", "noindex"],
        ["publish", "published", "noindex"],
        ["unpublish", "draft", "noindex"],
        ["archive", "archived", "noindex"],
        ["restore", "draft", "noindex"],
      ] as const) {
        const r = await act("new-tool", action);
        expect(r.status, action).toBe(200);
        expect(rawTool(db, "new-tool")).toMatchObject({ status, indexing });
      }
      expect(
        db.raw
          .prepare("SELECT action FROM audit_events ORDER BY id")
          .all()
          .map((r: any) => r.action),
      ).toEqual([
        "tool.create",
        "tool.send_to_review",
        "tool.publish",
        "tool.unpublish",
        "tool.archive",
        "tool.restore",
      ]);
    });
    it("unpublishing or archiving also drops indexing; flagging a published tool hides it", async () => {
      expect((await act("alpha", "flag_needs_review")).status).toBe(200);
      expect(rawTool(db, "alpha")).toMatchObject({
        status: "draft",
        indexing: "noindex",
        needs_review: 1,
      });
    });
    it("rejects impossible transitions and stale tokens", async () => {
      expect((await act("alpha", "restore")).status).toBe(409);
      expect((await act("alpha", "send_to_review")).status).toBe(409);
      const r = await call("POST", "tools/alpha/action", {
        body: { action: "archive", updated_at: "2020-01-01T00:00:00.000Z" },
      });
      expect(r.status).toBe(409);
      expect(rawTool(db, "alpha").status).toBe("published");
      expect(
        (
          await call("POST", "tools/alpha/action", {
            body: { action: "delete", updated_at: "2020-01-01T00:00:00.000Z" },
          })
        ).status,
      ).toBe(422);
    });
  });

  describe("categories", () => {
    const body = (o: Record<string, unknown> = {}) => ({
      slug: "cat-new",
      name: "Brand New",
      description: null,
      subcategories: ["X"],
      sort_order: 5,
      status: "draft",
      indexing: "noindex",
      ...o,
    });
    it("lists with tool counts", async () => {
      const r = await call("GET", "categories");
      expect(r.json.items.find((c: any) => c.slug === "cat-a")).toMatchObject({
        tool_count: 3,
        subcategories: ["Sub One", "Sub Two"],
      });
    });
    it("creates, persists, and rejects duplicates by slug or name", async () => {
      expect((await call("POST", "categories", { body: body() })).status).toBe(201);
      expect(db.raw.prepare("SELECT name FROM categories WHERE slug='cat-new'").get().name).toBe(
        "Brand New",
      );
      expect((await call("POST", "categories", { body: body() })).status).toBe(409);
      expect(
        (
          await call("POST", "categories", {
            body: body({ slug: "other-slug", name: "brand new" }),
          })
        ).status,
      ).toBe(409);
      expect((await call("POST", "categories", { body: body({ slug: "Bad Slug" }) })).status).toBe(
        422,
      );
    });
    const upd = async (slug: string, over: Record<string, unknown>) => {
      const cur = (await call("GET", "categories")).json.items.find((c: any) => c.slug === slug);
      return call("PUT", `categories/${slug}`, {
        body: {
          name: cur.name,
          description: cur.description,
          subcategories: cur.subcategories,
          sort_order: cur.sort_order,
          status: cur.status,
          indexing: cur.indexing,
          seo_title: null,
          seo_description: null,
          updated_at: cur.updated_at,
          ...over,
        },
      });
    };
    it("edits a category without touching its slug or its tools", async () => {
      const r = await upd("cat-a", { name: "Category A Renamed", description: "Hello" });
      expect(r.status).toBe(200);
      expect(rawTool(db, "alpha").category_id).toBe("cat-a");
      expect(db.raw.prepare("SELECT slug,name FROM categories WHERE id='cat-a'").get()).toEqual({
        slug: "cat-a",
        name: "Category A Renamed",
      });
    });
    it("cannot orphan tools: used subcategories cannot be removed and live categories cannot be archived", async () => {
      expect((await upd("cat-a", { subcategories: ["Sub One"] })).status).toBe(409); // Sub Two is used by 'tool-name'
      const r = await upd("cat-a", { status: "archived" });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("category_not_empty");
      expect(db.raw.prepare("SELECT status FROM categories WHERE id='cat-a'").get().status).toBe(
        "published",
      );
    });
    it("409s on a duplicate name and on a stale token", async () => {
      expect((await upd("cat-a", { name: "old category" })).status).toBe(409);
      expect((await upd("cat-a", { updated_at: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
    });
    it("reports how many tools use each subcategory", async () => {
      const r = await call("GET", "categories");
      expect(r.json.items.find((c: any) => c.slug === "cat-a").subcategory_counts).toEqual({
        "Sub One": 1,
        "Sub Two": 1,
      });
      expect(r.json.items.find((c: any) => c.slug === "cat-old").subcategory_counts).toEqual({});
    });
    const delCat = async (slug: string, over: Record<string, unknown> = {}) => {
      const cur = (await call("GET", "categories")).json.items.find((c: any) => c.slug === slug);
      return call("DELETE", `categories/${slug}`, {
        body: { updated_at: cur.updated_at, confirm: slug, ...over },
      });
    };
    it("refuses to delete a category that still has tools, in any status", async () => {
      const r = await delCat("cat-a");
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("category_not_empty");
      expect(count(db, "categories")).toBe(2);
    });
    it("deletes an empty category with the typed confirmation, and audits it", async () => {
      expect((await delCat("cat-old", { confirm: "wrong" })).status).toBe(422);
      expect((await delCat("cat-old", { updated_at: "2020-01-01T00:00:00.000Z" })).status).toBe(
        409,
      );
      expect(count(db, "categories")).toBe(2);
      const r = await delCat("cat-old");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ deleted: true, slug: "cat-old" });
      expect(db.raw.prepare("SELECT 1 FROM categories WHERE slug='cat-old'").get()).toBeFalsy();
      expect(
        db.raw.prepare("SELECT action, entity_id FROM audit_events ORDER BY id DESC").get(),
      ).toEqual({ action: "category.delete", entity_id: "cat-old" });
      expect((await delCat("cat-a", { confirm: "cat-a" })).status).toBe(409);
    });
    it("404s when deleting a category that does not exist", async () =>
      expect(
        (
          await call("DELETE", "categories/nope", {
            body: { updated_at: "x".repeat(10), confirm: "nope" },
          })
        ).status,
      ).toBe(404));
  });

  describe("delete tool", () => {
    const del = async (slug: string, over: Record<string, unknown> = {}) => {
      const cur = (await call("GET", `tools/${slug}`)).json.tool;
      return call("DELETE", `tools/${slug}`, {
        body: { updated_at: cur.updated_at, confirm: slug, ...over },
      });
    };
    const archive = async (slug: string) => {
      const cur = (await call("GET", `tools/${slug}`)).json.tool;
      return call("POST", `tools/${slug}/action`, {
        body: { action: "archive", updated_at: cur.updated_at },
      });
    };
    it("refuses to delete a tool that is not archived", async () => {
      const r = await del("alpha");
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("not_archived");
      expect(rawTool(db, "alpha")).toBeTruthy();
    });
    it("requires the typed slug and a current updated_at", async () => {
      await archive("alpha");
      expect((await del("alpha", { confirm: "Alpha" })).status).toBe(422);
      expect((await del("alpha", { updated_at: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
      expect((await del("alpha", { extra: 1 })).status).toBe(422);
      expect(rawTool(db, "alpha")).toBeTruthy();
    });
    it("deletes an archived tool, cascades its redirects, and writes exactly one audit row", async () => {
      db.raw.exec("INSERT INTO tool_redirects (old_slug, tool_id) VALUES ('old-alpha', 't1')");
      await archive("alpha");
      const audits = count(db, "audit_events");
      const r = await del("alpha");
      expect(r.status).toBe(200);
      expect(rawTool(db, "alpha")).toBeFalsy();
      expect(count(db, "tool_redirects")).toBe(0);
      expect(count(db, "audit_events")).toBe(audits + 1);
      expect((await call("GET", "tools/alpha")).status).toBe(404);
      expect(
        (
          await call("DELETE", "tools/alpha", {
            body: { updated_at: "x".repeat(10), confirm: "alpha" },
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("blog", () => {
    const post = (o: Record<string, unknown> = {}) => ({
      client_id: UUID(9),
      slug: "hello-world",
      title: "Hello World",
      excerpt: "An excerpt",
      body_md: "# Hi\n\nBody",
      author_name: null,
      tags: ["news"],
      seo_title: null,
      seo_description: null,
      canonical_url: null,
      ...o,
    });
    const act = async (slug: string, action: string) => {
      const cur = (await call("GET", `blog/${slug}`)).json.post;
      return call("POST", `blog/${slug}/action`, { body: { action, updated_at: cur.updated_at } });
    };
    it("creates a DRAFT (never auto-published), idempotently", async () => {
      const r = await call("POST", "blog", { body: post() });
      expect(r.status).toBe(201);
      expect(r.json.post).toMatchObject({ status: "draft", published_at: null, tags: ["news"] });
      expect((await call("POST", "blog", { body: post() })).json.created).toBe(false);
      expect(count(db, "blog_posts")).toBe(1);
      expect((await call("POST", "blog", { body: post({ client_id: UUID(10) }) })).status).toBe(
        409,
      );
    });
    it("validates fields", async () => {
      for (const over of [
        { title: "" },
        { slug: "Bad Slug" },
        { canonical_url: "javascript:1" },
        { body_md: "x".repeat(100_001) },
        { tags: new Array(16).fill("t") },
      ]) {
        expect(
          (await call("POST", "blog", { body: post(over) })).status,
          JSON.stringify(over).slice(0, 40),
        ).toBe(422);
      }
      expect(count(db, "blog_posts")).toBe(0);
    });
    it("stores Markdown as typed (HTML is neutralized at render time, never stored-and-trusted)", async () => {
      const r = await call("POST", "blog", {
        body: post({ body_md: "<script>alert(1)</script> [x](javascript:alert(1))" }),
      });
      expect(r.json.post.body_md).toContain("<script>");
    });
    it("publish requires excerpt and body, sets published_at once, unpublish keeps it", async () => {
      await call("POST", "blog", { body: post({ excerpt: null }) });
      expect((await act("hello-world", "publish")).status).toBe(422);
      expect(db.raw.prepare("SELECT status FROM blog_posts").get().status).toBe("draft");
      const cur = (await call("GET", "blog/hello-world")).json.post;
      const upd = await call("PUT", "blog/hello-world", {
        body: {
          ...cur,
          excerpt: "Now present",
          updated_at: cur.updated_at,
          id: "injected",
          slug: "other-slug",
          status: "published",
          published_at: "2020-01-01T00:00:00.000Z",
          created_at: "2020-01-01T00:00:00.000Z",
        },
      });
      expect(upd.status).toBe(422); // unknown keys (id, status, ...) are rejected by the strict schema
      const clean = {
        title: cur.title,
        excerpt: "Now present",
        body_md: cur.body_md,
        author_name: null,
        tags: cur.tags,
        seo_title: null,
        seo_description: null,
        canonical_url: null,
        updated_at: cur.updated_at,
      };
      expect((await call("PUT", "blog/hello-world", { body: clean })).status).toBe(200);
      const pub = await act("hello-world", "publish");
      expect(pub.status).toBe(200);
      const first = pub.json.post.published_at;
      expect(first).toBeTruthy();
      expect(pub.json.post.status).toBe("published");
      const un = await act("hello-world", "unpublish");
      expect(un.json.post).toMatchObject({ status: "draft", published_at: first });
      expect((await act("hello-world", "publish")).json.post.published_at).toBe(first);
    });
    it("archives and restores; rejects invalid transitions", async () => {
      await call("POST", "blog", { body: post() });
      expect((await act("hello-world", "unpublish")).status).toBe(409);
      expect((await act("hello-world", "archive")).status).toBe(200);
      expect((await act("hello-world", "publish")).status).toBe(409);
      expect((await act("hello-world", "restore")).json.post.status).toBe("draft");
    });
    it("lists and filters by status", async () => {
      await call("POST", "blog", { body: post() });
      expect((await call("GET", "blog?status=draft")).json.total).toBe(1);
      expect((await call("GET", "blog?status=published")).json.total).toBe(0);
    });
    it("deletes drafts and archived posts with the typed slug, but never a published one", async () => {
      const del = async (slug: string, confirm = slug) => {
        const cur = (await call("GET", `blog/${slug}`)).json.post;
        return call("DELETE", `blog/${slug}`, {
          body: { updated_at: cur.updated_at, confirm },
        });
      };
      await call("POST", "blog", { body: post() });
      expect((await act("hello-world", "publish")).status).toBe(200);
      const pub = await del("hello-world");
      expect(pub.status).toBe(409);
      expect(pub.json.error.code).toBe("is_published");
      expect((await act("hello-world", "unpublish")).status).toBe(200);
      expect((await del("hello-world", "hello")).status).toBe(422);
      expect(count(db, "blog_posts")).toBe(1);
      const r = await del("hello-world");
      expect(r.status).toBe(200);
      expect(count(db, "blog_posts")).toBe(0);
      expect(db.raw.prepare("SELECT action FROM audit_events ORDER BY id DESC").get().action).toBe(
        "post.delete",
      );
    });
  });

  describe("database failures are reported honestly", () => {
    it("never reports success when the batch throws, and does not leak the internal error", async () => {
      db.failNextBatch = new Error("D1_ERROR: disk I/O error at /secret/path");
      const r = await call("POST", "tools", { body: toolBody() });
      expect(r.status).toBe(500);
      expect(r.json.error.code).toBe("database_error");
      expect(r.text).not.toContain("secret");
      expect(r.text).not.toContain("disk");
      expect(rawTool(db, "new-tool")).toBeUndefined();
    });
    it("never reports success when D1 does not confirm the write", async () => {
      db.failNextBatch = "unconfirmed";
      const r = await call("POST", "tools", { body: toolBody() });
      expect(r.status).toBe(500);
      expect(r.json.created).toBeUndefined();
    });
    it("maps a unique-constraint race to 409, not success", async () => {
      db.failNextBatch = new Error("UNIQUE constraint failed: tools.slug");
      const r = await call("POST", "tools", { body: toolBody() });
      expect(r.status).toBe(409);
    });
    it("returns 503 when no database is bound, for reads and writes", async () => {
      expect((await call("GET", "tools", { dbOverride: null })).status).toBe(503);
      expect((await call("POST", "tools", { body: toolBody(), dbOverride: null })).status).toBe(
        503,
      );
    });
    it("returns a safe 500 when a read fails", async () => {
      db.raw.exec("DROP TABLE tools");
      const r = await call("GET", "tools");
      expect(r.status).toBe(500);
      expect(r.json.error.code).toBe("database_error");
      expect(r.text).not.toMatch(/no such table/i);
    });
    it("rolls back the whole batch: no audit row without its change", async () => {
      const cur = (await call("GET", "tools/alpha")).json.tool;
      db.raw.exec(
        "CREATE TRIGGER block_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit blocked'); END",
      );
      const r = await call("POST", "tools/alpha/action", {
        body: { action: "archive", updated_at: cur.updated_at },
      });
      expect(r.status).toBe(500);
      expect(rawTool(db, "alpha").status).toBe("published"); // the tool change was rolled back too
    });
  });
});
