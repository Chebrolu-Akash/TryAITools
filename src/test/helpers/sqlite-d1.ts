/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
// TEST HELPER ONLY (not imported by application code): a D1-compatible adapter over node:sqlite, so
// the admin API is tested against real SQL, the real migrations and real constraints.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { AdminDb } from "@/lib/admin/db";

type RawStmt = {
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
  run(...p: unknown[]): { changes: number | bigint };
};
type RawDb = { exec(sql: string): void; prepare(sql: string): RawStmt };
export type SqliteEngine = { name: "node:sqlite" | "bun:sqlite"; open: () => RawDb };

let cached: SqliteEngine | null | undefined;

/**
 * Finds an in-memory SQLite: Node's built-in `node:sqlite`, else Bun's `bun:sqlite`. The admin API tests run
 * against REAL SQL and the REAL migrations, so they must never be skipped silently: if neither engine exists,
 * `createTestDb` throws and `assertSqliteAvailable` fails a test with instructions.
 * TEST_SQLITE_ENGINE=node|bun forces one engine (used to test both paths).
 */
export function sqliteEngine(): SqliteEngine | null {
  if (cached !== undefined) return cached;
  const want = process.env.TEST_SQLITE_ENGINE;
  const node = (): SqliteEngine | null => {
    try {
      const m = (
        process as unknown as { getBuiltinModule?: (n: string) => any }
      ).getBuiltinModule?.("node:sqlite");
      return m?.DatabaseSync
        ? { name: "node:sqlite", open: () => new m.DatabaseSync(":memory:") }
        : null;
    } catch {
      return null;
    }
  };
  const bun = (): SqliteEngine | null => {
    try {
      const m = createRequire(resolve(process.cwd(), "noop.js"))("bun:sqlite") as {
        Database: new (p: string) => RawDb;
      };
      return { name: "bun:sqlite", open: () => new m.Database(":memory:") };
    } catch {
      return null;
    }
  };
  cached = want === "bun" ? bun() : want === "node" ? node() : (node() ?? bun());
  return cached;
}

export const sqliteAvailable = (): boolean => sqliteEngine() !== null;

export const SQLITE_HELP =
  "No SQLite engine found for the database tests (need Node >= 22.5 `node:sqlite` or Bun's `bun:sqlite`). Upgrade Bun (`bun upgrade`) and re-run. These tests are NOT optional: they are the proof that writes persist and authorization holds.";

/** Call from a test so a missing engine is a visible FAILURE, never a silent skip. */
export function assertSqliteAvailable(): void {
  if (!sqliteAvailable()) throw new Error(SQLITE_HELP);
}

export type TestDb = AdminDb & { raw: any; failNextBatch?: Error | "unconfirmed" };

export function createTestDb(opts: { migrations?: boolean; seed?: string[] } = {}): TestDb {
  const engine = sqliteEngine();
  if (!engine) throw new Error(SQLITE_HELP);
  const base = engine.open();
  // Normalize engine differences: a missing row is `undefined` for both (bun:sqlite returns null).
  const raw: RawDb = {
    exec: (sql) => base.exec(sql),
    prepare: (sql) => {
      const st = base.prepare(sql);
      return {
        get: (...p) => st.get(...p) ?? undefined,
        all: (...p) => st.all(...p),
        run: (...p) => st.run(...p),
      };
    },
  };
  raw.exec("PRAGMA foreign_keys = ON");
  if (opts.migrations !== false) {
    const dir = resolve(process.cwd(), "migrations");
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith(".sql"))
      .sort())
      raw.exec(readFileSync(resolve(dir, f), "utf8"));
  }
  for (const s of opts.seed ?? []) raw.exec(s);

  const stmt = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async () => (raw.prepare(sql).get(...params) as any) ?? null, // node returns undefined, bun returns null
    all: async () => ({ success: true, results: raw.prepare(sql).all(...params) as any[] }),
    run: async () => ({
      success: true,
      meta: { changes: Number(raw.prepare(sql).run(...params).changes) },
    }),
    _exec: () => ({
      success: true,
      meta: { changes: Number(raw.prepare(sql).run(...params).changes) },
    }),
  });

  const db: any = {
    raw,
    prepare: (sql: string) => stmt(sql),
    async batch(stmts: any[]) {
      if (db.failNextBatch) {
        const f = db.failNextBatch;
        db.failNextBatch = undefined;
        if (f === "unconfirmed") return stmts.map(() => ({ success: false, meta: { changes: 0 } }));
        throw f;
      }
      raw.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._exec());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return db as TestDb;
}
