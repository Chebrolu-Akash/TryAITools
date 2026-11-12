import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/db/types";

/** D1 with batch(): statements run in one implicit transaction; a failure rolls the whole batch back. */
export interface AdminDb extends D1DatabaseLike {
  batch(
    statements: D1PreparedStatementLike[],
  ): Promise<Array<{ success: boolean; meta?: { changes?: number } }>>;
}

/** An error that maps directly to an HTTP response. `message` is safe to show to the admin. */
export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 500 | 503,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * A D1 failure the admin should explain rather than report as a bug: the daily row-read quota of the Free plan, or D1
 * being unreachable or overloaded. Returns null for anything else (SQL and constraint errors stay internal errors).
 */
export function databaseUnavailable(e: unknown): HttpError | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (/exceeded D1.s .*(limit|quota)|daily row read limit|rows? read limit/i.test(msg))
    return new HttpError(
      503,
      "d1_quota_exceeded",
      "The database has reached its daily read limit on the Cloudflare Free plan. It resets at 00:00 UTC. Nothing was saved.",
    );
  if (
    /overloaded|Network connection lost|storage (caused|operation)|internal error|timed? ?out|unavailable/i.test(
      msg,
    ) &&
    !/constraint|no such|syntax error|SQLITE_/i.test(msg)
  )
    return new HttpError(
      503,
      "database_unavailable",
      "The database is temporarily unavailable. Nothing was saved. Try again in a minute.",
    );
  return null;
}

export type WriteStep = { sql: string; params: unknown[]; expectChanges: number };

const unique = (msg: string) => /UNIQUE constraint failed/i.test(msg);
const fk = (msg: string) => /FOREIGN KEY constraint failed/i.test(msg);

/**
 * Runs the steps atomically and returns ONLY if D1 confirms every statement succeeded with the exact
 * number of changed rows. Otherwise it throws, so the API can never report a save that did not happen.
 *   - first step affecting a different row count than expected  -> 409 conflict (stale or missing row)
 *   - UNIQUE violation (race on slug/name/id)                    -> 409 duplicate
 *   - anything else                                              -> 500 database_error (details only in server logs)
 */
export async function writeBatch(db: AdminDb | null, steps: WriteStep[]): Promise<void> {
  if (!db || typeof db.batch !== "function")
    throw new HttpError(
      503,
      "database_unavailable",
      "The database is not available. Nothing was saved.",
    );
  let results;
  try {
    results = await db.batch(steps.map((s) => db.prepare(s.sql).bind(...s.params)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (unique(msg))
      throw new HttpError(
        409,
        "duplicate",
        "A record with the same unique value already exists. Nothing was saved.",
      );
    if (fk(msg))
      throw new HttpError(
        422,
        "invalid_reference",
        "A referenced record does not exist. Nothing was saved.",
      );
    const unavailable = databaseUnavailable(e);
    if (unavailable) throw unavailable;
    console.error("admin db write failed:", unique(msg) ? "unique" : "other");
    throw new HttpError(
      500,
      "database_error",
      "The database rejected the change. Nothing was saved.",
    );
  }
  if (!Array.isArray(results) || results.length !== steps.length)
    throw new HttpError(
      500,
      "database_error",
      "The database did not confirm the change. Nothing was saved.",
    );
  for (let i = 0; i < steps.length; i++) {
    const r = results[i];
    if (!r || r.success !== true)
      throw new HttpError(
        500,
        "database_error",
        "The database did not confirm the change. Nothing was saved.",
      );
    if ((r.meta?.changes ?? 0) !== steps[i].expectChanges) {
      if (i === 0)
        throw new HttpError(
          409,
          "conflict",
          "This record was changed or removed by someone else. Reload and try again. Nothing was saved.",
        );
      throw new HttpError(
        500,
        "database_error",
        "The database did not confirm the change. Nothing was saved.",
      );
    }
  }
}

/** Wraps reads so unexpected D1 errors become a safe 500 instead of leaking internals. */
export async function readSafe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const unavailable = databaseUnavailable(e);
    if (unavailable) throw unavailable;
    console.error("admin db read failed");
    throw new HttpError(500, "database_error", "The database could not be read.");
  }
}

/**
 * Marks the public catalogue as changed, in the same batch as the write, so every Worker isolate re-reads it on its next
 * request (see src/lib/catalog/versioned-cache.ts). The value only needs to be unique.
 */
export const catalogVersionStep = (now: string): WriteStep => ({
  sql: "INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  params: [`${now}#${crypto.randomUUID()}`, now],
  expectChanges: 1,
});

/**
 * Marks the content sections (blog, courses, gadgets, guest articles) as changed, in the same batch as the write, so the
 * static-site gate re-checks those pages (src/static/freshness.ts). Separate from catalog_version: a blog edit does not
 * make tool pages re-check anything.
 */
export const contentVersionStep = (now: string): WriteStep => ({
  sql: "INSERT INTO meta (key, value, updated_at) VALUES ('content_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  params: [`${now}#${crypto.randomUUID()}`, now],
  expectChanges: 1,
});

/** Which row a write must have just touched. Table and column names come from this fixed list, never from input. */
export type AuditGuard = {
  table:
    | "tools"
    | "categories"
    | "blog_posts"
    | "courses"
    | "gadgets"
    | "guest_articles"
    | "tutorials"
    | "media"
    | "news_articles"
    | "news_sources";
  key: "id" | "slug";
  value: string;
  stamp: "created_at" | "updated_at";
};

/**
 * Audit row that is written only if the change it describes actually happened. It deliberately does NOT use
 * SQLite `changes()` (whose behaviour inside a D1 batch is not documented by Cloudflare). Instead it checks the
 * row itself: every write stamps the row with this request's unique timestamp (`now`), so "the row carries my
 * timestamp" proves the preceding statement took effect. If it did not (stale update), nothing is audited and
 * writeBatch() reports a conflict from the first statement's confirmed row count.
 */
export const auditStep = (
  actor: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  now: string,
  guard: AuditGuard,
): WriteStep => ({
  sql: `INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${guard.table} WHERE ${guard.key} = ? AND ${guard.stamp} = ?)`,
  params: [now, actor, action, entityType, entityId, summary.slice(0, 200), guard.value, now],
  expectChanges: 1,
});
