// SERVER ONLY. The admin side of AI News: statistics, sources (enable/disable, priority), articles (list, unpublish,
// republish, feature, retry, delete), runs and failures. Called from src/lib/admin/api.ts after Cloudflare Access and
// CSRF checks. Every write is one atomic batch with an audit row; changes visible on /news bump meta.news_version.
import { z } from "zod";
import {
  auditStep,
  HttpError,
  readSafe,
  writeBatch,
  type AdminDb,
  type WriteStep,
} from "@/lib/admin/db";
import { stringList } from "./model";

type Row = Record<string, unknown>;
type Ctx = { db: AdminDb | null; actor: string; now: string };
const need = (db: AdminDb | null): AdminDb => {
  if (!db) throw new HttpError(503, "database_unavailable", "The database is not available.");
  return db;
};
const missing = (e: unknown) => /no such table/i.test(e instanceof Error ? e.message : String(e));
const NOT_MIGRATED = new HttpError(
  503,
  "news_not_migrated",
  "The AI News tables do not exist in this database yet (migration 0009_ai_news.sql).",
);
/** Like readSafe (which hides the message), but a missing news table is reported as "not migrated" first. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (missing(e)) throw NOT_MIGRATED;
    return readSafe(() => Promise.reject(e));
  }
}

export const newsVersionStep = (now: string): WriteStep => ({
  sql: "INSERT INTO meta (key, value, updated_at) VALUES ('news_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  params: [`${now}#${crypto.randomUUID()}`, now],
  expectChanges: 1,
});

export const ARTICLE_STATUSES = [
  "pending",
  "published",
  "failed",
  "skipped",
  "unpublished",
] as const;
export const newsArticleActionSchema = z.object({
  action: z.enum(["unpublish", "republish", "feature", "unfeature", "retry", "delete"]),
  updated_at: z.string().min(1).max(40),
});
export const newsSourceUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    max_items: z.number().int().min(1).max(30).optional(),
    updated_at: z.string().min(1).max(40),
  })
  .strict();
export const newsRunSchema = z
  .object({
    source_ids: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(60),
      )
      .max(12)
      .optional(),
    article_ids: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict();

export async function newsStats(db: AdminDb | null) {
  const d = need(db);
  return guarded(async () => {
    const a = (await d
      .prepare(
        `SELECT count(*) AS total, COALESCE(sum(status='published'),0) AS published, COALESCE(sum(status='pending'),0) AS pending,
                COALESCE(sum(status='failed'),0) AS failed, COALESCE(sum(status='skipped'),0) AS skipped,
                COALESCE(sum(status='unpublished'),0) AS unpublished, COALESCE(sum(featured=1 AND status='published'),0) AS featured
           FROM news_articles WHERE status <> 'deleted'`,
      )
      .first<Row>()) as Row;
    const s = (await d
      .prepare(
        "SELECT count(*) AS total, COALESCE(sum(enabled),0) AS enabled, COALESCE(sum(enabled=1 AND consecutive_failures>=3),0) AS failing FROM news_sources",
      )
      .first<Row>()) as Row;
    const since = new Date(Date.parse(new Date().toISOString()) - 30 * 86400_000).toISOString();
    const c = (await d
      .prepare(
        `SELECT count(*) AS runs, COALESCE(sum(published),0) AS published, COALESCE(sum(input_tokens),0) AS input_tokens,
                COALESCE(sum(output_tokens),0) AS output_tokens, COALESCE(sum(cost_usd),0) AS cost_usd
           FROM news_runs WHERE started_at > ?`,
      )
      .bind(since)
      .first<Row>()) as Row;
    const runs = await d
      .prepare(
        `SELECT id, trigger, status, started_at, finished_at, sources_checked, items_seen, items_new, duplicates, published,
                failed, skipped, input_tokens, output_tokens, cost_usd, model, error
           FROM news_runs ORDER BY started_at DESC LIMIT 15`,
      )
      .all<Row>();
    const failures = await d
      .prepare(
        "SELECT id, run_id, source_id, article_id, stage, message, at FROM news_failures ORDER BY id DESC LIMIT 30",
      )
      .all<Row>();
    return {
      articles: a,
      sources: s,
      last30Days: c,
      runs: runs.results,
      failures: failures.results,
    };
  });
}

export async function listNewsSources(db: AdminDb | null) {
  const d = need(db);
  return guarded(async () => ({
    sources: (
      await d
        .prepare(
          `SELECT s.id, s.name, s.kind, s.feed_url, s.site_url, s.default_category, s.enabled, s.use_images, s.priority,
                  s.max_items, s.robots_status, s.robots_checked_at, s.last_fetched_at, s.last_success_at, s.last_error,
                  s.consecutive_failures, s.notes, s.updated_at,
                  (SELECT count(*) FROM news_articles a WHERE a.source_id = s.id AND a.status = 'published') AS published
             FROM news_sources s ORDER BY s.enabled DESC, s.priority, s.name`,
        )
        .all<Row>()
    ).results,
  }));
}

export async function updateNewsSource(
  ctx: Ctx,
  id: string,
  input: z.infer<typeof newsSourceUpdateSchema>,
) {
  const d = need(ctx.db);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of ["enabled", "priority", "max_items"] as const)
    if (input[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(typeof input[k] === "boolean" ? (input[k] ? 1 : 0) : input[k]);
    }
  if (!sets.length) throw new HttpError(422, "validation_failed", "Nothing to change.");
  await guarded(() =>
    writeBatch(d, [
      {
        sql: `UPDATE news_sources SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND updated_at = ?`,
        params: [...params, ctx.now, id, input.updated_at],
        expectChanges: 1,
      },
      auditStep(
        ctx.actor,
        "news_source.update",
        "news_source",
        id,
        JSON.stringify(input),
        ctx.now,
        {
          table: "news_sources",
          key: "id",
          value: id,
          stamp: "updated_at",
        },
      ),
    ]),
  );
  return { ok: true };
}

export async function listNewsArticles(db: AdminDb | null, q: Record<string, string>) {
  const d = need(db);
  const status = (ARTICLE_STATUSES as readonly string[]).includes(q["status"] ?? "")
    ? q["status"]!
    : null;
  const page = Math.max(1, Math.min(200, Math.floor(Number(q["page"] ?? 1)) || 1));
  const search = (q["q"] ?? "").trim().slice(0, 80);
  const where = ["status <> 'deleted'"];
  const params: unknown[] = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    where.push("(original_title LIKE ? OR title LIKE ? OR source_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const size = 25;
  return guarded(async () => {
    const { results } = await d
      .prepare(
        `SELECT id, slug, status, featured, title, original_title, source_id, source_name, canonical_url, category,
                coverage_count, attempts, last_error, model, input_tokens, output_tokens, cost_usd, source_published_at,
                collected_at, published_at, updated_at
           FROM news_articles WHERE ${where.join(" AND ")}
          ORDER BY collected_at DESC, id LIMIT ? OFFSET ?`,
      )
      .bind(...params, size + 1, (page - 1) * size)
      .all<Row>();
    return { items: results.slice(0, size), page, hasMore: results.length > size };
  });
}

export async function getNewsArticle(db: AdminDb | null, id: string) {
  const d = need(db);
  return guarded(async () => {
    const r = await d
      .prepare("SELECT * FROM news_articles WHERE id = ? AND status <> 'deleted'")
      .bind(id)
      .first<Row>();
    if (!r) throw new HttpError(404, "not_found", "Article not found.");
    return {
      ...r,
      takeaways: stringList(r["takeaways"]),
      tags: stringList(r["tags"]),
      companies: stringList(r["companies"]),
      products: stringList(r["products"]),
    };
  });
}

/**
 * Admin actions on one article. retry only re-queues it (status 'pending', attempts reset); the caller then runs the
 * summariser for it right away. delete wipes the content but keeps URL, GUID and headline as a tombstone so the next
 * run does not collect the same item again.
 */
export async function applyNewsArticleAction(
  ctx: Ctx,
  id: string,
  input: z.infer<typeof newsArticleActionSchema>,
) {
  const d = need(ctx.db);
  const row = (await getNewsArticle(d, id)) as Row;
  const status = String(row["status"]);
  const bad = (m: string) => new HttpError(409, "invalid_transition", m);
  let sql: string;
  let visible = status === "published";
  switch (input.action) {
    case "unpublish":
      if (status !== "published") throw bad("Only published articles can be unpublished.");
      sql = "UPDATE news_articles SET status = 'unpublished', featured = 0";
      break;
    case "republish":
      if (status !== "unpublished") throw bad("Only unpublished articles can be republished.");
      sql = "UPDATE news_articles SET status = 'published'";
      visible = true;
      break;
    case "feature":
    case "unfeature":
      if (status !== "published") throw bad("Only published articles can be featured.");
      sql = `UPDATE news_articles SET featured = ${input.action === "feature" ? 1 : 0}`;
      break;
    case "retry":
      if (!["failed", "skipped", "pending"].includes(status))
        throw bad("Only failed, skipped or pending articles can be retried.");
      sql = "UPDATE news_articles SET status = 'pending', attempts = 0, last_error = NULL";
      visible = false;
      break;
    case "delete":
      sql = `UPDATE news_articles SET status = 'deleted', featured = 0, slug = NULL, title = NULL, summary = NULL,
               card_description = NULL, takeaways = '[]', tags = '[]', companies = '[]', products = '[]',
               source_text = '', image_url = NULL`;
      break;
  }
  const steps: WriteStep[] = [
    {
      sql: `${sql}, updated_at = ? WHERE id = ? AND updated_at = ?`,
      params: [ctx.now, id, input.updated_at],
      expectChanges: 1,
    },
    auditStep(
      ctx.actor,
      `news.${input.action}`,
      "news_article",
      id,
      String(row["title"] ?? row["original_title"] ?? ""),
      ctx.now,
      { table: "news_articles", key: "id", value: id, stamp: "updated_at" },
    ),
  ];
  if (visible) steps.push(newsVersionStep(ctx.now));
  await guarded(() => writeBatch(d, steps));
  return { ok: true, action: input.action };
}
