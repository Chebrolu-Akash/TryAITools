// SERVER ONLY. One AI News ingestion run, shared by the Cron Trigger (src/lib/news/cron.ts) and the admin's "Run now" and
// "Retry" buttons. Idempotent and bounded so it fits Workers Free (10 ms CPU, ~50 subrequests per invocation):
//
//   1. lock      a news_runs row with status 'running'; a second run while one is active does nothing
//   2. collect   up to `maxSources` enabled sources, least recently fetched first (round-robin across runs):
//                robots.txt check (cached 24 h) -> feed fetch (timeout, byte cap, ETag/Last-Modified, one retry)
//                -> parse the newest `max_items` -> validate -> dedupe (URL, GUID, headline, similarity) -> save 'pending'
//   3. summarise up to `maxSummaries` pending items with Gemini (free tier, see summarize.ts) -> 'published' / 'skipped' / retry
//   4. log       run totals, tokens, cost and every failure; bump meta.news_version when something was published
//
// Every source is isolated: a timeout, a bad feed or a robots.txt refusal is logged for that source and the run goes on.
import type { AdminDb } from "@/lib/admin/db";
import { canonicalUrl, findSimilar, significantWords, titleKey } from "./dedupe";
import { parseFeed, type FeedItem } from "./feed";
import { isAllowedNewsImage, isNewsCategory, slugify, type NewsCategory } from "./model";
import { NEWS_USER_AGENT, robotsAllows } from "./robots";
import type { Summarizer } from "./summarize";

export type IngestConfig = {
  maxSources: number;
  maxSummaries: number;
  maxBytes: number;
  fetchTimeoutMs: number;
  /** Feed items older than this are ignored. */
  maxAgeDays: number;
  /** A 'running' run older than this is considered dead and no longer blocks new runs. */
  lockMinutes: number;
  /** Summary attempts per item before it is marked failed. */
  maxAttempts: number;
};
export const DEFAULT_CONFIG: IngestConfig = {
  maxSources: 4,
  maxSummaries: 4,
  maxBytes: 200_000,
  fetchTimeoutMs: 8_000,
  maxAgeDays: 10,
  lockMinutes: 15,
  maxAttempts: 3,
};
const intVar = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
/** Caps from Worker vars (NEWS_MAX_SOURCES_PER_RUN, NEWS_MAX_SUMMARIES_PER_RUN), clamped to safe ranges. */
export const configFromEnv = (env: Record<string, unknown>): IngestConfig => ({
  ...DEFAULT_CONFIG,
  maxSources: intVar(env["NEWS_MAX_SOURCES_PER_RUN"], 1, 12, DEFAULT_CONFIG.maxSources),
  maxSummaries: intVar(env["NEWS_MAX_SUMMARIES_PER_RUN"], 0, 10, DEFAULT_CONFIG.maxSummaries),
});

export type Trigger = "cron" | "manual" | "retry";
export type SourceReport = {
  id: string;
  status: "ok" | "not-modified" | "robots-disallowed" | "failed";
  seen: number;
  added: number;
  duplicates: number;
  error?: string;
};
export type RunReport = {
  runId: string | null;
  /** Set when the run did not start (another run holds the lock). */
  skipped?: string;
  status: "ok" | "partial" | "failed" | "skipped";
  sourcesChecked: number;
  itemsSeen: number;
  itemsNew: number;
  duplicates: number;
  published: number;
  failed: number;
  skippedItems: number;
  /** Items left pending because the free quota, a rate limit, an outage or the key stopped the summary. */
  deferred: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  sources: SourceReport[];
  notes: string[];
};
type Failure = {
  sourceId: string | null;
  articleId: string | null;
  stage: "robots" | "fetch" | "parse" | "validate" | "summarize" | "save";
  message: string;
};
type Row = Record<string, unknown>;
type Source = {
  id: string;
  name: string;
  feed_url: string;
  default_category: string | null;
  use_images: number;
  max_items: number;
  robots_status: string;
  robots_checked_at: string | null;
  etag: string | null;
  last_modified: string | null;
};

export type IngestDeps = {
  db: AdminDb;
  /** null when GEMINI_API_KEY is not configured: items are collected but not summarised. */
  summarizer: Summarizer | null;
  trigger: Trigger;
  fetch?: typeof fetch;
  now?: () => Date;
  config?: Partial<IngestConfig>;
  /** Collect only these sources (admin "fetch this source"); default: the due ones. */
  sourceIds?: string[];
  /** Summarise only these articles and collect nothing (admin "Retry"). */
  articleIds?: string[];
};

const ROBOTS_TTL_MS = 24 * 3600_000;
const MAX_FAILURE_ROWS = 60;
const err = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const rows = async (db: AdminDb, sql: string, ...params: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...params)
      .all<Row>()
  ).results;
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** Reads at most `max` bytes of a response body, then cancels the rest of the download. */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= max) await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, all.length - at));
    all.set(part, at);
    at += part.byteLength;
    if (at >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

export async function runIngestion(deps: IngestDeps): Promise<RunReport> {
  const cfg = { ...DEFAULT_CONFIG, ...deps.config };
  const doFetch = deps.fetch ?? ((i: RequestInfo | URL, init?: RequestInit) => fetch(i, init));
  const now = deps.now ?? (() => new Date());
  const db = deps.db;
  const started = now().toISOString();
  const report: RunReport = {
    runId: null,
    status: "ok",
    sourcesChecked: 0,
    itemsSeen: 0,
    itemsNew: 0,
    duplicates: 0,
    published: 0,
    failed: 0,
    skippedItems: 0,
    deferred: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    sources: [],
    notes: [],
  };
  const failures: Failure[] = [];

  // ---------------------------------------------------------------- 1. lock
  const runId = crypto.randomUUID();
  const staleBefore = new Date(now().getTime() - cfg.lockMinutes * 60_000).toISOString();
  await db
    .prepare(
      "UPDATE news_runs SET status = 'failed', finished_at = ?, error = 'abandoned (lock expired)' WHERE status = 'running' AND started_at < ?",
    )
    .bind(started, staleBefore)
    .run();
  const lock = await db
    .prepare(
      `INSERT INTO news_runs (id, trigger, status, started_at, model)
       SELECT ?, ?, 'running', ?, ? WHERE NOT EXISTS (SELECT 1 FROM news_runs WHERE status = 'running')`,
    )
    .bind(runId, deps.trigger, started, deps.summarizer?.model ?? null)
    .run();
  if ((lock.meta?.changes ?? 0) !== 1)
    return { ...report, status: "skipped", skipped: "Another news run is in progress." };
  report.runId = runId;

  try {
    // ---------------------------------------------------------------- 2. collect
    if (!deps.articleIds) await collect();
    // ---------------------------------------------------------------- 3. summarise
    await summarise();
  } catch (e) {
    report.status = "failed";
    report.notes.push(`run aborted: ${err(e)}`);
    console.error("news: run aborted", err(e));
  }

  // ---------------------------------------------------------------- 4. log
  const finished = now().toISOString();
  if (report.status !== "failed") {
    const allSourcesFailed =
      report.sources.length > 0 && report.sources.every((s) => s.status === "failed");
    report.status =
      allSourcesFailed && report.published === 0 ? "failed" : failures.length ? "partial" : "ok";
  }
  const steps = [
    db
      .prepare(
        `UPDATE news_runs SET status = ?, finished_at = ?, sources_checked = ?, items_seen = ?, items_new = ?, duplicates = ?,
           published = ?, failed = ?, skipped = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, error = ?, details = ?
         WHERE id = ?`,
      )
      .bind(
        report.status,
        finished,
        report.sourcesChecked,
        report.itemsSeen,
        report.itemsNew,
        report.duplicates,
        report.published,
        report.failed,
        report.skippedItems,
        report.inputTokens,
        report.outputTokens,
        Math.round(report.costUsd * 1e6) / 1e6,
        report.notes.length ? report.notes.join("; ").slice(0, 500) : null,
        JSON.stringify({ sources: report.sources, deferred: report.deferred }),
        runId,
      ),
    ...failures
      .slice(0, MAX_FAILURE_ROWS)
      .map((f) =>
        db
          .prepare(
            "INSERT INTO news_failures (run_id, source_id, article_id, stage, message, at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(runId, f.sourceId, f.articleId, f.stage, f.message.slice(0, 500), finished),
      ),
    // Housekeeping: failures older than 30 days and runs older than 90 days.
    db
      .prepare("DELETE FROM news_failures WHERE at < ?")
      .bind(new Date(now().getTime() - 30 * 86400_000).toISOString()),
    db
      .prepare("DELETE FROM news_runs WHERE started_at < ? AND status <> 'running'")
      .bind(new Date(now().getTime() - 90 * 86400_000).toISOString()),
  ];
  if (report.published > 0)
    steps.push(
      db
        .prepare(
          "INSERT INTO meta (key, value, updated_at) VALUES ('news_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(`${finished}#${crypto.randomUUID()}`, finished),
    );
  try {
    await db.batch(steps);
  } catch (e) {
    console.error("news: could not record the run", err(e));
  }
  return report;

  // ================================================================ steps
  async function collect() {
    const sources = (deps.sourceIds?.length
      ? await rows(
          db,
          `SELECT * FROM news_sources WHERE id IN (${placeholders(deps.sourceIds.length)})`,
          ...deps.sourceIds,
        )
      : await rows(
          db,
          `SELECT * FROM news_sources WHERE enabled = 1
              ORDER BY (last_fetched_at IS NOT NULL), last_fetched_at, priority LIMIT ?`,
          cfg.maxSources,
        )) as unknown as Source[];
    if (sources.length === 0) {
      report.notes.push("no enabled sources");
      return;
    }
    const since = new Date(now().getTime() - 4 * 86400_000).toISOString();
    const recent = (
      await rows(
        db,
        "SELECT id, title_key FROM news_articles WHERE collected_at > ? ORDER BY collected_at DESC LIMIT 400",
        since,
      )
    ).map((r) => ({ id: String(r["id"]), words: significantWords(String(r["title_key"])) }));

    // Network in parallel (wall time only, no CPU); database writes one source at a time.
    const fetched = await Promise.all(sources.map((s) => fetchSource(s)));
    for (let i = 0; i < sources.length; i++) {
      report.sourcesChecked++;
      try {
        await saveSource(sources[i]!, fetched[i]!, recent);
      } catch (e) {
        failures.push({
          sourceId: sources[i]!.id,
          articleId: null,
          stage: "save",
          message: err(e),
        });
        report.sources.push({
          id: sources[i]!.id,
          status: "failed",
          seen: 0,
          added: 0,
          duplicates: 0,
          error: err(e),
        });
      }
    }
  }

  type Fetched =
    | {
        kind: "items";
        items: FeedItem[];
        etag: string | null;
        lastModified: string | null;
        robots: string | null;
      }
    | { kind: "not-modified"; robots: string | null }
    | { kind: "robots-disallowed"; robots: string }
    | { kind: "failed"; stage: Failure["stage"]; message: string; robots: string | null };

  async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await doFetch(url, {
          headers: { "user-agent": NEWS_USER_AGENT, ...headers },
          redirect: "follow",
          signal: AbortSignal.timeout(cfg.fetchTimeoutMs),
        });
        if (res.status >= 500 && attempt === 0) {
          await res.body?.cancel().catch(() => {});
          continue;
        }
        return res;
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error("request failed");
  }

  async function fetchSource(s: Source): Promise<Fetched> {
    // robots.txt, at most once a day per source
    let robots: string | null = null;
    const fresh =
      s.robots_checked_at && now().getTime() - Date.parse(s.robots_checked_at) < ROBOTS_TTL_MS;
    if (fresh && s.robots_status === "disallowed")
      return { kind: "robots-disallowed", robots: "disallowed" };
    if (!fresh || s.robots_status === "unknown") {
      try {
        const res = await get(new URL("/robots.txt", s.feed_url).toString(), {
          accept: "text/plain",
        });
        if (res.status >= 500) throw new Error(`robots.txt answered ${res.status}`);
        const txt = res.ok ? await readCapped(res, 64_000) : "";
        if (!res.ok) await res.body?.cancel().catch(() => {});
        robots = robotsAllows(txt, s.feed_url) ? "allowed" : "disallowed";
      } catch (e) {
        return {
          kind: "failed",
          stage: "robots",
          message: `robots.txt unavailable: ${err(e)}`,
          robots: null,
        };
      }
      if (robots === "disallowed") return { kind: "robots-disallowed", robots };
    }
    try {
      const res = await get(s.feed_url, {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        ...(s.etag ? { "if-none-match": s.etag } : {}),
        ...(s.last_modified ? { "if-modified-since": s.last_modified } : {}),
      });
      if (res.status === 304) return { kind: "not-modified", robots };
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { kind: "failed", stage: "fetch", message: `feed answered ${res.status}`, robots };
      }
      const xml = await readCapped(res, cfg.maxBytes);
      try {
        return {
          kind: "items",
          items: parseFeed(xml, s.max_items),
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          robots,
        };
      } catch (e) {
        return { kind: "failed", stage: "parse", message: err(e), robots };
      }
    } catch (e) {
      return { kind: "failed", stage: "fetch", message: `feed request failed: ${err(e)}`, robots };
    }
  }

  async function saveSource(
    s: Source,
    f: Fetched,
    recent: { id: string; words: Set<string> }[],
  ): Promise<void> {
    const at = now().toISOString();
    const robotsCols =
      f.robots !== null
        ? { sql: ", robots_status = ?, robots_checked_at = ?", params: [f.robots, at] }
        : { sql: "", params: [] };
    const sourceUpdate = (
      ok: boolean,
      extra: { sql: string; params: unknown[] },
      error: string | null,
    ) =>
      db
        .prepare(
          `UPDATE news_sources SET last_fetched_at = ?, updated_at = ?${robotsCols.sql}${extra.sql},
             last_error = ?, consecutive_failures = ${ok ? "0" : "consecutive_failures + 1"} WHERE id = ?`,
        )
        .bind(at, at, ...robotsCols.params, ...extra.params, error, s.id);

    if (f.kind !== "items") {
      const error =
        f.kind === "failed"
          ? f.message
          : f.kind === "robots-disallowed"
            ? "robots.txt disallows automated access"
            : null;
      if (f.kind === "failed")
        failures.push({ sourceId: s.id, articleId: null, stage: f.stage, message: f.message });
      if (f.kind === "robots-disallowed")
        failures.push({ sourceId: s.id, articleId: null, stage: "robots", message: error! });
      await sourceUpdate(
        f.kind === "not-modified",
        f.kind === "not-modified"
          ? { sql: ", last_success_at = ?", params: [at] }
          : { sql: "", params: [] },
        error,
      ).run();
      report.sources.push({
        id: s.id,
        status: f.kind,
        seen: 0,
        added: 0,
        duplicates: 0,
        ...(error ? { error } : {}),
      });
      return;
    }

    // validate
    const oldest = now().getTime() - cfg.maxAgeDays * 86400_000;
    const candidates: { item: FeedItem; url: string; key: string; published: string | null }[] = [];
    for (const item of f.items) {
      const url = canonicalUrl(item.link);
      const key = titleKey(item.title);
      const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (!url || key.length < 10) {
        failures.push({
          sourceId: s.id,
          articleId: null,
          stage: "validate",
          message: `invalid item: ${item.title.slice(0, 80)}`,
        });
        continue;
      }
      if (Number.isFinite(t) && t < oldest) continue; // older than the window: not news any more, not an error
      const published = Number.isFinite(t)
        ? new Date(Math.min(t, now().getTime())).toISOString()
        : null;
      candidates.push({ item, url, key, published });
    }
    report.itemsSeen += f.items.length;

    // dedupe against the database, then within this batch, then by similarity
    const existing = candidates.length
      ? await rows(
          db,
          `SELECT canonical_url, guid, source_id, title_key FROM news_articles
            WHERE canonical_url IN (${placeholders(candidates.length)}) OR title_key IN (${placeholders(candidates.length)})
               OR (source_id = ? AND guid IN (${placeholders(candidates.length)}))`,
          ...candidates.map((c) => c.url),
          ...candidates.map((c) => c.key),
          s.id,
          ...candidates.map((c) => c.item.guid ?? ""),
        )
      : [];
    const seenUrls = new Set(existing.map((r) => String(r["canonical_url"])));
    const seenKeys = new Set(existing.map((r) => String(r["title_key"])));
    const seenGuids = new Set(
      existing.filter((r) => r["source_id"] === s.id).map((r) => String(r["guid"])),
    );
    const writes = [];
    let added = 0;
    let duplicates = 0;
    for (const c of candidates) {
      if (
        seenUrls.has(c.url) ||
        seenKeys.has(c.key) ||
        (c.item.guid && seenGuids.has(c.item.guid))
      ) {
        duplicates++;
        continue;
      }
      seenUrls.add(c.url);
      seenKeys.add(c.key);
      if (c.item.guid) seenGuids.add(c.item.guid);
      const similar = findSimilar(c.key, recent);
      if (similar) {
        duplicates++;
        writes.push(
          db
            .prepare(
              "UPDATE news_articles SET coverage_count = coverage_count + 1, updated_at = ? WHERE id = ?",
            )
            .bind(at, similar),
        );
        continue;
      }
      const id = crypto.randomUUID();
      recent.push({ id, words: significantWords(c.key) });
      added++;
      writes.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO news_articles
               (id, source_id, source_name, canonical_url, guid, title_key, original_title, source_text, image_url,
                status, source_published_at, collected_at, run_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            s.id,
            s.name,
            c.url,
            c.item.guid,
            c.key,
            c.item.title,
            c.item.text,
            s.use_images === 1 && isAllowedNewsImage(c.item.imageUrl) ? c.item.imageUrl : null,
            c.published,
            at,
            runId,
            at,
            at,
          ),
      );
    }
    writes.push(
      sourceUpdate(
        true,
        {
          sql: ", last_success_at = ?, etag = ?, last_modified = ?",
          params: [at, f.etag, f.lastModified],
        },
        null,
      ),
    );
    await db.batch(writes);
    report.itemsNew += added;
    report.duplicates += duplicates;
    report.sources.push({ id: s.id, status: "ok", seen: f.items.length, added, duplicates });
  }

  async function summarise() {
    const summarizer = deps.summarizer;
    if (!summarizer) {
      report.notes.push(
        "GEMINI_API_KEY is not configured: items were collected but not summarised",
      );
      return;
    }
    if (cfg.maxSummaries === 0 && !deps.articleIds) return;
    const queue = deps.articleIds?.length
      ? await rows(
          db,
          `SELECT a.*, s.default_category FROM news_articles a JOIN news_sources s ON s.id = a.source_id
            WHERE a.id IN (${placeholders(deps.articleIds.length)}) AND a.status IN ('pending','failed','skipped')`,
          ...deps.articleIds.slice(0, 10),
        )
      : await rows(
          db,
          `SELECT a.*, s.default_category FROM news_articles a JOIN news_sources s ON s.id = a.source_id
            WHERE a.status = 'pending' AND a.attempts < ? ORDER BY a.collected_at DESC, a.source_published_at DESC LIMIT ?`,
          cfg.maxAttempts,
          cfg.maxSummaries,
        );
    // One at a time (free-tier requests per minute are low). The first quota/config error stops the loop: the rest stay
    // pending for a later run instead of hitting the same wall.
    for (const r of queue) {
      const stop = await summariseOne(summarizer, r);
      if (stop) {
        report.notes.push(`summaries paused: ${stop}`);
        break;
      }
    }
  }

  /** Summarises one item; returns a reason when the run must stop calling the model. */
  async function summariseOne(summarizer: Summarizer, r: Row): Promise<string | null> {
    const id = String(r["id"]);
    const at = now().toISOString();
    const result = await summarizer.summarize({
      title: String(r["original_title"]),
      text: String(r["source_text"] ?? ""),
      sourceName: String(r["source_name"]),
      url: String(r["canonical_url"]),
      publishedAt: (r["source_published_at"] as string | null) ?? null,
      defaultCategory: isNewsCategory(r["default_category"])
        ? (r["default_category"] as NewsCategory)
        : null,
    });
    report.inputTokens += result.usage.inputTokens;
    report.outputTokens += result.usage.outputTokens;
    report.costUsd += result.usage.costUsd;
    const usageCols =
      "model = ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_usd = cost_usd + ?";
    const usage = [
      result.usage.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.usage.costUsd,
    ];
    if (result.ok) {
      const s = result.summary;
      const slug = `${slugify(s.headline, 70) || "ai-news"}-${id.slice(0, 6)}`;
      const published =
        typeof r["source_published_at"] === "string" ? r["source_published_at"] : at;
      await db
        .prepare(
          `UPDATE news_articles SET status = 'published', slug = ?, title = ?, summary = ?, card_description = ?,
             takeaways = ?, category = ?, tags = ?, companies = ?, products = ?, published_at = ?, last_error = NULL,
             attempts = attempts + 1, ${usageCols}, updated_at = ?
           WHERE id = ? AND status IN ('pending','failed','skipped')`,
        )
        .bind(
          slug,
          s.headline,
          s.summary,
          s.cardDescription,
          JSON.stringify(s.takeaways),
          s.category,
          JSON.stringify(s.tags),
          JSON.stringify(s.companies),
          JSON.stringify(s.products),
          published,
          ...usage,
          at,
          id,
        )
        .run();
      report.published++;
      return null;
    }
    if (result.reason === "deferred") {
      // Not the item's fault (quota, rate limit, outage, key): keep it pending, attempts unchanged.
      report.deferred++;
      failures.push({
        sourceId: String(r["source_id"]),
        articleId: id,
        stage: "summarize",
        message: result.message,
      });
      await db
        .prepare(
          `UPDATE news_articles SET status = 'pending', last_error = ?, updated_at = ?
            WHERE id = ? AND status IN ('pending','failed','skipped')`,
        )
        .bind(`deferred: ${result.message}`.slice(0, 500), at, id)
        .run();
      return result.stopRun ? result.message : null;
    }
    const attempts = Number(r["attempts"] ?? 0) + 1;
    const status = !result.retryable
      ? result.reason === "insufficient"
        ? "skipped"
        : "failed"
      : attempts >= cfg.maxAttempts
        ? "failed"
        : "pending";
    if (status === "skipped") report.skippedItems++;
    else report.failed++;
    failures.push({
      sourceId: String(r["source_id"]),
      articleId: id,
      stage: "summarize",
      message: result.message,
    });
    await db
      .prepare(
        `UPDATE news_articles SET status = ?, attempts = ?, last_error = ?, ${usageCols}, updated_at = ?
          WHERE id = ? AND status IN ('pending','failed','skipped')`,
      )
      .bind(status, attempts, `${result.reason}: ${result.message}`.slice(0, 500), ...usage, at, id)
      .run();
    return null;
  }
}
