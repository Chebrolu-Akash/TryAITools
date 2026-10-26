import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleDbCheck } from "@/lib/db/check";
import { DbWriteError, dbWrite } from "@/lib/db/write";
import { loadTools } from "@/lib/db/tools-repo";
import { contentFor } from "@/lib/tool-content";
import { slugOfTool } from "@/lib/tool-pages";
import { categories, tools } from "@/lib/tools";
import type { D1DatabaseLike } from "@/lib/db/types";
// @ts-ignore -- plain ESM helper shared with the Node import scripts
import { assignSlugs } from "../../scripts/db/slugs.mjs";
// @ts-ignore
import snapshot from "../../scripts/db/curated-snapshot.json";

const fakeDb = (impl: { first?: () => unknown; all?: () => unknown; run?: () => unknown }): D1DatabaseLike => {
  const stmt: any = {
    bind: () => stmt,
    first: async () => impl.first?.(),
    all: async () => impl.all?.(),
    run: async () => impl.run?.(),
  };
  return { prepare: () => stmt };
};

describe("import parity with the live site code", () => {
  it("import slugs equal the slugs the public site generates, for every tool", () => {
    const expected = assignSlugs(tools, categories);
    expect(tools.map((t) => slugOfTool(t))).toEqual(expected);
  });

  it("curated snapshot used by the import matches tool-content.ts", () => {
    for (const item of (snapshot as any).items) {
      const t = tools.find((x) => x.name === item.primary.name && x.category === item.primary.category)!;
      expect(t, item.key).toBeTruthy();
      const c = contentFor(t);
      expect(c.tagline).toBe(item.content.tagline);
      expect(c.overview).toBe(item.content.overview);
      expect(c.features).toEqual(item.content.features);
    }
  });
});

describe("dbWrite", () => {
  it("throws when there is no database", async () => {
    await expect(dbWrite(null, "UPDATE t SET a=?", [1])).rejects.toBeInstanceOf(DbWriteError);
  });
  it("throws when D1 rejects the statement", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ run: () => Promise.reject(new Error("boom")) });
    await expect(dbWrite(db, "UPDATE t SET a=?", [1])).rejects.toMatchObject({ message: "write_failed" });
  });
  it("throws when success is not confirmed", async () => {
    await expect(dbWrite(fakeDb({ run: () => ({ success: false }) }), "x")).rejects.toMatchObject({ message: "write_not_confirmed" });
  });
  it("throws when the affected-row count is not what the caller expected", async () => {
    const db = fakeDb({ run: () => ({ success: true, meta: { changes: 0 } }) });
    await expect(dbWrite(db, "x", [], { expectChanges: 1 })).rejects.toMatchObject({ message: "unexpected_change_count" });
  });
  it("returns the change count only on a confirmed write", async () => {
    const db = fakeDb({ run: () => ({ success: true, meta: { changes: 1 } }) });
    await expect(dbWrite(db, "x", [], { expectChanges: 1 })).resolves.toEqual({ changes: 1 });
  });
});

describe("loadTools fallback", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  it("uses JSON when there is no binding", async () => {
    const r = await loadTools(null);
    expect(r.source).toBe("json");
    expect(r.tools).toBe(tools);
  });
  it("uses JSON when the query throws", async () => {
    expect((await loadTools(fakeDb({ all: () => Promise.reject(new Error("down")) }))).source).toBe("json");
  });
  it("uses JSON when the table is empty", async () => {
    expect((await loadTools(fakeDb({ all: () => ({ results: [] }) }))).source).toBe("json");
  });
  it("uses D1 rows when present", async () => {
    const rows = [{ id: "a", name: "A", url: "https://a.com", category: "AI Writing Tools", subcategory: "" }];
    const r = await loadTools(fakeDb({ all: () => ({ results: rows }) }));
    expect(r).toEqual({ source: "d1", tools: rows });
  });
});

describe("/api/db-check diagnostic", () => {
  const ok = fakeDb({ first: () => ({ value: "preview", c: 5 }) });
  const resolver = (db: D1DatabaseLike | null) => async () => ({ db, source: "server-entry" as const });
  it("returns 404 on the production domain, even when a DB is bound", async () => {
    for (const host of ["https://tryaitools.io/api/db-check", "https://www.tryaitools.io/api/db-check", "https://example.com/api/db-check"]) {
      expect((await handleDbCheck(new Request(host), resolver(ok))).status).toBe(404);
    }
  });
  it("reports binding state on workers.dev and localhost", async () => {
    for (const host of ["https://pixel-perfect.acct.workers.dev/api/db-check", "http://localhost:3000/api/db-check"]) {
      const body = await (await handleDbCheck(new Request(host), resolver(ok))).json();
      expect(body).toMatchObject({ bound: true, canRead: true, environment: "preview" });
    }
  });
  it("reports unbound without throwing", async () => {
    const body = await (await handleDbCheck(new Request("http://localhost:3000/api/db-check"), resolver(null))).json();
    expect(body).toMatchObject({ bound: false, canRead: false });
  });
  it("does not leak error details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = fakeDb({ first: () => Promise.reject(new Error("secret table path")) });
    const text = await (await handleDbCheck(new Request("http://localhost/api/db-check"), resolver(bad))).text();
    expect(text).toContain("query_failed");
    expect(text).not.toContain("secret");
  });
});

describe("getD1", () => {
  beforeEach(() => vi.resetModules());
  it("finds nothing outside Workers and does not throw", async () => {
    const { getD1 } = await import("@/lib/db/env");
    expect(await getD1()).toEqual({ db: null, source: "none" });
  });
  it("uses the env passed to the server entry", async () => {
    const { getD1, captureRuntimeEnv } = await import("@/lib/db/env");
    const DB = fakeDb({});
    captureRuntimeEnv({ DB });
    expect(await getD1()).toEqual({ db: DB, source: "server-entry" });
  });
  it("ignores an env value that is not a D1 database", async () => {
    const { getD1, captureRuntimeEnv } = await import("@/lib/db/env");
    captureRuntimeEnv({ DB: "nope" });
    expect((await getD1()).db).toBeNull();
  });
});
