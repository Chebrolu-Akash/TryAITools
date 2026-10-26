import type { D1DatabaseLike } from "./types";

export class DbWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbWriteError";
  }
}

/**
 * Runs one parameterized write and THROWS unless D1 confirms success (and, when `expectChanges`
 * is given, the exact number of affected rows). Admin APIs must use this so a failed or no-op
 * write can never be reported to the user as saved.
 */
export async function dbWrite(db: D1DatabaseLike | null, sql: string, params: unknown[] = [], opts: { expectChanges?: number } = {}) {
  if (!db) throw new DbWriteError("database_unavailable");
  let res;
  try {
    res = await db.prepare(sql).bind(...params).run();
  } catch (e) {
    console.error("D1 write failed", e);
    throw new DbWriteError("write_failed");
  }
  if (!res || res.success !== true) throw new DbWriteError("write_not_confirmed");
  const changes = res.meta?.changes ?? 0;
  if (opts.expectChanges !== undefined && changes !== opts.expectChanges) throw new DbWriteError("unexpected_change_count");
  return { changes };
}
