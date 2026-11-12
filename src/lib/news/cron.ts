// The AI News Cron Trigger. Bundled on its own into .output/server/news-cron.mjs (scripts/static/build-gate.mjs) and
// loaded by the gate's `scheduled()` only when a cron fires, so page requests never load the ingestion code.
// The same file is a complete Worker entry (default export with `scheduled`), so it can also be deployed as a small
// dedicated cron Worker bound to the preview database (see docs/ai-news.md).
//
// Needs the D1 binding DB. Without GEMINI_API_KEY items are still collected, just not summarised.
// Optional vars: NEWS_MODEL (a free-tier Gemini model, default gemini-3.5-flash-lite), NEWS_MAX_SOURCES_PER_RUN, NEWS_MAX_SUMMARIES_PER_RUN,
// NEWS_CRON_ENABLED = "0" to pause the schedule without removing the trigger.
import type { AdminDb } from "@/lib/admin/db";
import { configFromEnv, runIngestion, type RunReport, type Trigger } from "./ingest";
import { createSummarizer, type Summarizer } from "./summarize";

type Env = Record<string, unknown>;
type Ctx = { waitUntil(p: Promise<unknown>): void };

export function summarizerFromEnv(env: Env): Summarizer | null {
  const key = env["GEMINI_API_KEY"];
  if (typeof key !== "string" || !key.trim()) return null;
  // Only Gemini model names are accepted; anything else falls back to the default free-tier model.
  const model = typeof env["NEWS_MODEL"] === "string" ? env["NEWS_MODEL"].trim() : "";
  return createSummarizer({
    apiKey: key.trim(),
    ...(/^gemini-[a-z0-9.-]+$/.test(model) ? { model } : {}),
  });
}

const isDb = (v: unknown): v is AdminDb =>
  !!v && typeof (v as AdminDb).prepare === "function" && typeof (v as AdminDb).batch === "function";

export async function runNews(env: Env, trigger: Trigger): Promise<RunReport | null> {
  const db = env["DB"];
  if (!isDb(db)) {
    console.log("news: no DB binding, nothing to do");
    return null;
  }
  const report = await runIngestion({
    db,
    summarizer: summarizerFromEnv(env),
    trigger,
    config: configFromEnv(env),
  });
  // One compact line per run (Workers Logs stay off; this is visible in `wrangler tail`).
  console.log(
    `news: run ${report.runId ?? "-"} ${report.status} sources=${report.sourcesChecked} new=${report.itemsNew} ` +
      `dupes=${report.duplicates} published=${report.published} failed=${report.failed} cost=$${report.costUsd.toFixed(4)}` +
      (report.skipped ? ` (${report.skipped})` : ""),
  );
  return report;
}

export async function scheduled(_controller: unknown, env: Env, ctx: Ctx): Promise<void> {
  if (env["NEWS_CRON_ENABLED"] === "0") return;
  ctx.waitUntil(
    runNews(env, "cron").catch((e) =>
      console.error("news: scheduled run failed", e instanceof Error ? e.message : e),
    ),
  );
}

export default { scheduled };
