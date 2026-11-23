// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in tests */
// Bulk tool management against the real migrations and SQL: selection across pages, dry-run preview, the indexing gate,
// chunked apply that writes only the chosen fields (with audit + undo rows), per-row edits, tags, shared category
// memberships, undo with conflict detection, and authentication.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAdminApi } from "@/lib/admin/api";
import { CHUNK } from "@/lib/admin/bulk";
import type { JwksProvider } from "@/lib/admin/jwt";
import {
  goodClaims,
  goodEnv,
  makeKey,
  signJwt,
  staticJwks,
  type TestKey,
} from "./helpers/access-jwt";
import { createTestDb, type TestDb } from "./helpers/sqlite-d1";
import { passGate } from "./helpers/gate-fixture";

const NOW = 1_800_000_000;
const ORIGIN = "https://admin.test";
const OLD = "2026-01-01T00:00:00.000Z";

function seed(): string[] {
  const s = [
    `INSERT INTO categories (id,slug,name,subcategories,sort_order,status) VALUES
      ('writing','writing','Writing','["Assistants","Editing"]',1,'published'),
      ('video','video','Video','["Generation","Avatars"]',2,'published'),
      ('old','old','Old','[]',3,'archived')`,
    `INSERT INTO meta (key,value) VALUES ('catalog_version','v0') ON CONFLICT(key) DO UPDATE SET value='v0'`,
  ];
  // 25 imported, unreviewed tools in Writing / Assistants
  for (let i = 1; i <= 25; i++)
    s.push(
      `INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,tags,sort_order,updated_at)
       VALUES ('t${i}','tool-${i}','Tool ${i}','https://t${i}.example.com','writing','Assistants','published','noindex',0,'["AI Writing"]',${i},'${OLD}')`,
    );
  // a reviewed tool with content (passes the gate once indexed), and a flagged draft
  s.push(
    `INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,overview,features,pricing_model,review_status,tags,sort_order,updated_at)
     VALUES ('r1','ready','Ready','https://ready.example.com','writing','Editing','published','noindex',0,'An overview.','["One"]','freemium','reviewed','[]',100,'${OLD}')`,
    `INSERT INTO tools (id,slug,name,url,category_id,subcategory,status,indexing,needs_review,sort_order,updated_at)
     VALUES ('f1','flagged','Flagged','https://flagged.example.com','writing','Assistants','draft','noindex',1,101,'${OLD}')`,
  );
  return s;
}

describe("admin bulk management", () => {
  let key!: TestKey;
  let token = "";
  beforeAll(async () => {
    key = await makeKey("k1");
    token = await signJwt(key, goodClaims(NOW));
  });
  let db: TestDb;
  let tick = 0;
  let jwks!: JwksProvider;
  beforeEach(() => {
    db = createTestDb({ seed: seed() });
    tick = 0;
    jwks = staticJwks(key);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    o: { token?: string | null; csrf?: boolean } = {},
  ) => {
    const headers: Record<string, string> = {};
    const t = o.token === undefined ? token : o.token;
    if (t) headers["cf-access-jwt-assertion"] = t;
    if (method !== "GET" && o.csrf !== false)
      Object.assign(headers, {
        "x-requested-with": "tryaitools-admin",
        origin: ORIGIN,
        "content-type": "application/json",
      });
    const res = await handleAdminApi(
      new Request(`${ORIGIN}/api/admin/${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      }),
      {
        env: async () => goodEnv,
        db: async () => db,
        now: () =>
          `2026-11-08T10:${String(Math.floor(++tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}.000Z`,
        auth: { jwks, nowSeconds: NOW },
      },
    );
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const tool = (slug: string) => db.raw.prepare("SELECT * FROM tools WHERE slug = ?").get(slug);
  const n = (sql: string) => db.raw.prepare(sql).get().n as number;
  /** Runs a whole operation the way the admin UI does: start, apply in chunks of CHUNK, finish. */
  const run = async (slugs: string[], edit: Record<string, unknown>, action = "edit") => {
    const op = (
      await call("POST", "bulk/operations", { action, summary: "test", total: slugs.length })
    ).json.op.id;
    const results: any[] = [];
    for (let i = 0; i < slugs.length; i += CHUNK) {
      const r = await call("POST", `bulk/operations/${op}/apply`, {
        slugs: slugs.slice(i, i + CHUNK),
        ...edit,
      });
      expect(r.status).toBe(200);
      results.push(...r.json.results);
    }
    expect((await call("POST", `bulk/operations/${op}/finish`)).status).toBe(200);
    return { op, results };
  };
  const all25 = Array.from({ length: 25 }, (_, i) => `tool-${i + 1}`);

  it("every bulk endpoint requires Access (401 without a token) and POSTs require the CSRF headers", async () => {
    for (const [m, p] of [
      ["GET", "bulk/select"],
      ["POST", "bulk/preview"],
      ["GET", "bulk/operations"],
      ["POST", "bulk/operations"],
    ] as const)
      expect(
        (await call(m, p, m === "POST" ? {} : undefined, { token: null })).status,
        `${m} ${p}`,
      ).toBe(401);
    const r = await call(
      "POST",
      "bulk/operations",
      { action: "x", summary: "x", total: 1 },
      { csrf: false },
    );
    expect(r.status).toBe(403);
    expect(n("SELECT count(*) n FROM bulk_operations")).toBe(0);
  });

  it("select all matching returns every filtered tool across pages, and the list paginates the same set", async () => {
    const sel = await call("GET", "bulk/select?category=writing&status=published");
    expect(sel.json.slugs).toHaveLength(26);
    const page2 = await call("GET", "tools?category=writing&status=published&page=2&pageSize=10");
    expect(page2.json.total).toBe(26);
    expect(page2.json.items.map((t: any) => t.slug)).toEqual(sel.json.slugs.slice(10, 20));
    expect((await call("GET", "bulk/select?q=tool-1")).json.slugs).toContain("tool-10");
    expect((await call("GET", "bulk/select?review_status=reviewed")).json.slugs).toEqual(["ready"]);
    expect((await call("GET", "bulk/select?subcategory=Editing")).json.slugs).toEqual(["ready"]);
  });

  it("preview is a dry run: exact per-tool changes and counts, invalid tools with reasons, nothing written", async () => {
    const before =
      n("SELECT count(*) n FROM audit_events") + n("SELECT count(*) n FROM bulk_operation_items");
    const r = await call("POST", "bulk/preview", {
      slugs: ["tool-1", "tool-2", "flagged", "nope"],
      set: { category_id: "video", subcategory: "Generation", status: "published" },
    });
    expect(r.status).toBe(200);
    expect(r.json.counts).toEqual({ selected: 4, change: 2, unchanged: 0, invalid: 1, missing: 1 });
    const t1 = r.json.items.find((i: any) => i.slug === "tool-1");
    expect(t1.changes).toEqual({
      category_id: { from: "writing", to: "video" },
      subcategory: { from: "Assistants", to: "Generation" },
    });
    expect(r.json.items.find((i: any) => i.slug === "flagged").reasons[0]).toMatch(/flagged/);
    expect(tool("tool-1").category_id).toBe("writing");
    expect(
      n("SELECT count(*) n FROM audit_events") + n("SELECT count(*) n FROM bulk_operation_items"),
    ).toBe(before);
  });

  it("validates category/subcategory pairs and refuses archived categories", async () => {
    const r = await call("POST", "bulk/preview", {
      slugs: ["tool-1", "tool-2"],
      set: { category_id: "video" },
    });
    expect(r.json.counts.invalid).toBe(2); // "Assistants" is not a Video subcategory
    expect(r.json.items[0].reasons[0]).toMatch(/choose a subcategory/);
    const a = await call("POST", "bulk/preview", {
      slugs: ["tool-1"],
      set: { category_id: "old", subcategory: null },
    });
    expect(a.json.items[0].reasons).toContain("category is archived");
  });

  it("the indexing gate: unreviewed tools are never indexed; a reviewed, complete tool is", async () => {
    // "ready" has the old minimum (reviewed, an overview, one feature): G1–G10 refuse it until a full approved review
    const thin = await call("POST", "bulk/preview", {
      slugs: ["ready"],
      set: { indexing: "index" },
    });
    expect(thin.json.items[0].status).toBe("invalid");
    expect(thin.json.items[0].reasons.join(" ")).toMatch(/G1: .*G2: .*G3: .*G9: .*G10: /);
    passGate(db.raw, "ready", "2026-11-08T09:00:00.000Z");
    const r = await call("POST", "bulk/preview", {
      slugs: ["tool-1", "ready"],
      set: { indexing: "index" },
    });
    const t1 = r.json.items.find((i: any) => i.slug === "tool-1");
    expect(t1.status).toBe("invalid");
    expect(t1.reasons).toEqual(
      expect.arrayContaining([
        "G9: not reviewed",
        "G1: overview has 0 words (needs 45–110)",
        "G2: 0 feature(s) (needs at least 3)",
      ]),
    );
    expect(r.json.items.find((i: any) => i.slug === "ready").status).toBe("change");
    const { results } = await run(
      ["tool-1", "ready"],
      { set: { indexing: "index" } },
      "enable_indexing",
    );
    expect(results.find((x: any) => x.slug === "tool-1").result).toBe("skipped");
    expect(tool("tool-1").indexing).toBe("noindex");
    expect(tool("ready").indexing).toBe("index");
  });

  it("bulk 'mark reviewed' cannot stand in for an editor's approval (G9)", async () => {
    const r = await call("POST", "bulk/preview", {
      slugs: ["tool-1"],
      set: { review_status: "reviewed" },
    });
    expect(r.json.items[0].status).toBe("invalid");
    expect(r.json.items[0].reasons[0]).toMatch(/^G9: only an approved review/);
    const { results } = await run(["tool-1"], { set: { review_status: "reviewed" } });
    expect(results[0].result).toBe("skipped");
    expect(tool("tool-1").review_status).toBe("unreviewed");
  });

  it("undo cannot switch indexing back on unless the tool passes the gate", async () => {
    passGate(db.raw, "ready", "2026-11-08T09:00:00.000Z");
    db.raw.exec(`UPDATE tools SET indexing = 'index' WHERE slug = 'ready'`);
    const { op } = await run(["ready"], { set: { indexing: "noindex" } }, "disable_indexing");
    expect(tool("ready").indexing).toBe("noindex");
    // the tool stops passing (its URL check went stale and failed), then the disable is undone
    db.raw.exec(`UPDATE tools SET url_status = 'dead' WHERE slug = 'ready'`);
    const u = await call("POST", `bulk/operations/${op}/undo`, {});
    expect(u.json.results[0].result).toBe("blocked");
    expect(u.json.results[0].reasons.join(" ")).toMatch(/G6: URL status is dead/);
    expect(tool("ready").indexing).toBe("noindex");
  });

  it("an indexed tool may be bulk-edited, but not into failing a check it passed (no regression)", async () => {
    passGate(db.raw, "ready", "2026-11-08T09:00:00.000Z");
    db.raw.exec(`UPDATE tools SET indexing = 'index' WHERE slug = 'ready'`);
    // tags are not part of the gate: allowed
    expect(
      (await run(["ready"], { tags: { mode: "add", values: ["AI Writing"] } })).results[0].result,
    ).toBe("applied");
    // a subcategory change within the confirmed category keeps every check passing: allowed
    const ok = await call("POST", "bulk/preview", {
      slugs: ["ready"],
      set: { subcategory: "Assistants" },
    });
    expect(ok.json.items[0].status).toBe("change");
    // moving it to another category voids the editor's category confirmation (G10), which it passed: refused
    const bad = await call("POST", "bulk/preview", {
      slugs: ["ready"],
      set: { category_id: "video", subcategory: "Generation" },
    });
    expect(bad.json.items[0].status).toBe("invalid");
    expect(bad.json.items[0].reasons.join(" ")).toMatch(
      /G10: category changed since it was confirmed.*the tool is indexed/,
    );
  });

  it("apply writes only the chosen fields, in chunks, with one audit row and one undo row per tool", async () => {
    const before = tool("tool-7");
    const v0 = db.raw.prepare("SELECT value FROM meta WHERE key='catalog_version'").get().value;
    const { op, results } = await run(all25, {
      set: { subcategory: "Editing", pricing_model: "paid" },
    });
    expect(results.filter((r: any) => r.result === "applied")).toHaveLength(25);
    const after = tool("tool-7");
    expect([after.subcategory, after.pricing_model]).toEqual(["Editing", "paid"]);
    for (const k of [
      "name",
      "url",
      "category_id",
      "status",
      "indexing",
      "tags",
      "overview",
      "review_status",
    ])
      expect(after[k], k).toEqual(before[k]);
    expect(n("SELECT count(*) n FROM audit_events WHERE action = 'tool.bulk_update'")).toBe(25);
    expect(n(`SELECT count(*) n FROM bulk_operation_items WHERE op_id = '${op}'`)).toBe(25);
    expect(
      db.raw.prepare("SELECT value FROM meta WHERE key='catalog_version'").get().value,
    ).not.toBe(v0);
    const o = db.raw.prepare("SELECT * FROM bulk_operations WHERE id = ?").get(op);
    expect([o.status, o.applied, o.skipped, o.failed]).toEqual(["done", 25, 0, 0]);
  });

  it("a chunk larger than the limit is rejected before anything is written", async () => {
    const op = (await call("POST", "bulk/operations", { action: "x", summary: "x", total: 11 }))
      .json.op.id;
    const r = await call("POST", `bulk/operations/${op}/apply`, {
      slugs: all25.slice(0, CHUNK + 1),
      set: { pricing_model: "paid" },
    });
    expect(r.status).toBe(422);
    expect(n("SELECT count(*) n FROM tools WHERE pricing_model = 'paid'")).toBe(0);
  });

  it("per-row edits give each tool its own value in one operation", async () => {
    await run(["tool-1", "tool-2"], {
      rows: [
        { slug: "tool-1", set: { pricing_model: "free" } },
        { slug: "tool-2", set: { pricing_model: "paid", subcategory: "Editing" } },
      ],
    });
    expect([tool("tool-1").pricing_model, tool("tool-1").subcategory]).toEqual([
      "free",
      "Assistants",
    ]);
    expect([tool("tool-2").pricing_model, tool("tool-2").subcategory]).toEqual(["paid", "Editing"]);
  });

  it("tags: add, remove and replace within the tag vocabulary; unknown tags are refused", async () => {
    await run(["tool-1"], { tags: { mode: "add", values: ["Automation"] } });
    expect(JSON.parse(tool("tool-1").tags)).toEqual(["AI Writing", "Automation"]);
    await run(["tool-1"], { tags: { mode: "remove", values: ["AI Writing"] } });
    expect(JSON.parse(tool("tool-1").tags)).toEqual(["Automation"]);
    await run(["tool-1"], { tags: { mode: "replace", values: ["AI Writing"] } });
    expect(JSON.parse(tool("tool-1").tags)).toEqual(["AI Writing"]);
    const bad = await call("POST", "bulk/preview", {
      slugs: ["tool-1"],
      tags: { mode: "add", values: ["Not a tag"] },
    });
    expect(bad.status).toBe(422);
  });

  it("shared category memberships: a tool appears in extra categories without a copy, never in its own twice", async () => {
    await run(["tool-1"], {
      memberships: {
        add: [
          { category_id: "video", subcategory: "Avatars" },
          { category_id: "writing", subcategory: null },
        ],
      },
    });
    expect(
      db.raw
        .prepare("SELECT category_id, subcategory FROM tool_categories WHERE tool_id = 't1'")
        .all(),
    ).toEqual([{ category_id: "video", subcategory: "Avatars" }]);
    expect((await call("GET", "bulk/select?category=video")).json.slugs).toEqual(["tool-1"]);
    await run(["tool-1"], { memberships: { remove: ["video"] } });
    expect(n("SELECT count(*) n FROM tool_categories")).toBe(0);
  });

  it("undo restores every tool of an operation, and skips a tool someone edited since (conflict)", async () => {
    const { op } = await run(["tool-1", "tool-2", "tool-3"], {
      set: { pricing_model: "paid" },
      tags: { mode: "add", values: ["Automation"] },
    });
    // someone edits tool-3's pricing afterwards
    db.raw.exec(
      `UPDATE tools SET pricing_model = 'free', updated_at = '2026-11-08T11:00:00.000Z' WHERE slug = 'tool-3'`,
    );
    const u = await call("POST", `bulk/operations/${op}/undo`, {});
    expect(u.status).toBe(200);
    const by = Object.fromEntries(u.json.results.map((r: any) => [r.slug, r.result]));
    expect(by).toEqual({ "tool-1": "restored", "tool-2": "restored", "tool-3": "conflict" });
    expect([tool("tool-1").pricing_model, JSON.parse(tool("tool-1").tags)]).toEqual([
      null,
      ["AI Writing"],
    ]);
    expect(tool("tool-3").pricing_model).toBe("free"); // the later edit is kept
    expect(n("SELECT count(*) n FROM audit_events WHERE action = 'tool.bulk_undo'")).toBe(2);
    const ops = await call("GET", "bulk/operations");
    expect(ops.json.items[0]).toMatchObject({ id: op, undoable: 0 });
  });

  it("unpublishing or archiving in bulk also turns indexing off", async () => {
    db.raw.exec(`UPDATE tools SET indexing = 'index' WHERE slug = 'ready'`);
    await run(["ready"], { set: { status: "archived" } });
    expect([tool("ready").status, tool("ready").indexing]).toEqual(["archived", "noindex"]);
  });
});
