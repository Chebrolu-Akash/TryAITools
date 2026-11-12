# AI News (automated)

`/news`, `/news/category/<category>` and `/news/<slug>`: AI news collected from official company feeds and reputable
outlets every 3 hours, deduplicated, summarised by Google Gemini (free tier) from the feed's own text, and published with attribution and a
link to the original. Managed in the admin under **AI News**.

## Pieces
| Part | File |
|---|---|
| Schema, seed sources, `meta.news_version` | `migrations/0009_ai_news.sql` (rollback `db/rollback/0009_ai_news.down.sql`) |
| Feed parser (RSS 2.0 / Atom, stops after N items) | `src/lib/news/feed.ts` |
| robots.txt policy | `src/lib/news/robots.ts` |
| Duplicate detection | `src/lib/news/dedupe.ts` |
| Gemini summary (raw HTTP `generateContent`, JSON schema output) | `src/lib/news/summarize.ts` |
| One ingestion run (lock, collect, summarise, log) | `src/lib/news/ingest.ts` |
| Cron entry (bundled alone as `.output/server/news-cron.mjs`) | `src/lib/news/cron.ts` |
| Public reads / server functions / `<head>` | `src/lib/news/reader.ts`, `api.ts`, `seo.ts` |
| Pages | `src/routes/news.index.tsx`, `news.$slug.tsx`, `news.category.$category.tsx`, `src/components/site/NewsViews.tsx` |
| Admin API / screen | `src/lib/news/admin.ts` (routes in `src/lib/admin/api.ts`), `src/components/admin/NewsView.tsx` |
| Static site | `src/static/freshness.ts` (`news` pages), `gate.ts` (`scheduled()`), `sitemap.ts` (`newsEntries`), `scripts/static/prerender.mjs` |

## A run
1. **Lock**: inserts a `news_runs` row with status `running` only if no other run is active (a run older than 15 minutes
   counts as dead and is marked `failed`).
2. **Collect** up to `NEWS_MAX_SOURCES_PER_RUN` (default 4) enabled sources, least recently fetched first, so every
   source comes round. Per source: robots.txt (re-checked daily), then the feed with an 8 s timeout, one retry on 5xx or a
   network error, a 200 KB cap, `If-None-Match` / `If-Modified-Since`. Only the newest `max_items` items are parsed.
   Items older than 10 days are ignored.
3. **Dedupe**: canonical URL (tracking params, `www.`, trailing slash and fragment removed), per-source GUID, normalised
   headline (all three unique in D1), then headline similarity (Jaccard ≥ 0.6 over significant words) against the last 4
   days. A near-duplicate from another source raises the first article's `coverage_count`, which drives **Trending**.
4. **Summarise** up to `NEWS_MAX_SUMMARIES_PER_RUN` (default 4) pending items, one at a time. Feed text under 40 words is
   skipped without a call. The model may also answer "insufficient". Companies and products not literally in the source text
   are dropped. A summary outside the length rules is retried on later runs, at most 3 attempts.
   **Free-tier limits**: a 429 (rate limit or daily quota used up), a 5xx after one retry, or a key/model problem
   (400/401/403/404) is *deferred*: the item stays `pending` with no attempt counted, and on a 429 or key problem the run
   stops calling Gemini until the next run. There is no fallback to any other (paid) API. Blocked answers (`SAFETY`,
   `RECITATION`, ...) mark the item `failed`; an admin can retry it.
5. **Log**: run totals, tokens (cost is always $0 on the free tier), per-source results and up to 60 failure rows.
   `meta.news_version` is bumped when something was published. Failures older than 30 days and runs older than 90 days are
   pruned.

One failing source never stops the others. The caps keep a run within Workers Free limits (10 ms CPU, ~50 subrequests per
invocation): about 4 feed fetches, 4 robots.txt fetches (at most daily), 4 Gemini calls and ~20 D1 statements.

## Sources (seeded; editable in the admin)
Enabled: OpenAI, Google DeepMind, Google AI, Google Research, Microsoft (AI news), Microsoft Research, Meta AI
(Engineering), NVIDIA, Hugging Face, Ars Technica.
Disabled: Anthropic and Perplexity (no public feed: 404/403 on 2026-11-01); NVIDIA Developer and AWS Machine Learning
(high-volume tutorial feeds); WIRED, MIT Technology Review, TechCrunch, The Verge (their robots.txt disallows automated or
AI access, checked 2026-11-01).

**robots.txt policy**: a feed is fetched only when robots.txt allows our agent `TryAITools-NewsBot` (or `*`) **and** does
not disallow `Google-Extended` (Google's AI opt-out token) by name, since the text is sent to Gemini. Only the feed is fetched, never the
article pages. Outlets' images are not shown (`use_images = 0`); official sources' feed images are.

## Configuration
| Name | Kind | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | **secret** | none | Google AI Studio key from a project **without billing** (free tier only). Without it, items are collected but not summarised. Never in frontend code. |
| `NEWS_MODEL` | var | `gemini-3.5-flash-lite` | Must be a `gemini-*` model on the free tier (pricing page, 2026-10-30). |
| `NEWS_MAX_SOURCES_PER_RUN` | var | 4 | 1-12 |
| `NEWS_MAX_SUMMARIES_PER_RUN` | var | 4 | 0-10 |
| `NEWS_CRON_ENABLED` | var | on | `"0"` pauses the cron without removing the trigger |
| Cron Trigger | config | none | `0 */3 * * *` (every 3 hours) |

Cost: $0. At the defaults at most 8 runs × 4 summaries = 32 calls a day, well inside free-tier daily limits (check the
model's limits in Google AI Studio). On the free tier Google may use inputs to improve its products; the inputs here are
public feed text only.

## Where the cron runs
Cloudflare runs Cron Triggers only on a Worker's **deployed** version, never on a preview alias such as `admin-stage3`.
The site Worker `pixel-perfect` has no Cron Trigger; each environment has its own cron Worker.

**Production (launched 2026-11-07):** `tryaitools-news-cron` (`wrangler.news-cron.production.jsonc`), same bundle, only the
production database `tryaitools-production` bound as `DB`, `gemini-3.5-flash-lite`, no public URL, `0 */3 * * *`. Deploy:
`node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.news-cron.production.jsonc`; key:
`node node_modules/wrangler/bin/wrangler.js secret put GEMINI_API_KEY --config wrangler.news-cron.production.jsonc`.
The production database is managed with `wrangler.production-migrations.jsonc` (binding `PRODUCTION_DB`; never deployed):
export a backup (`d1 export PRODUCTION_DB --config wrangler.production-migrations.jsonc --remote --output backup-tryaitools-production-<UTC>.sql`)
before any `d1 migrations apply`. The site deploys with `wrangler versions upload` then `wrangler versions deploy`, which
keeps the dashboard-configured custom domain.

**Preview** (approved 2026-11-01): the dedicated preview Worker `tryaitools-news-cron-preview` (`wrangler.news-cron.jsonc`):
`main = .output/server/news-cron.mjs`, only the preview D1 bound as `DB`, the secret `GEMINI_API_KEY`, no public URL,
`triggers.crons = ["0 */3 * * *"]`. Deploy: `node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.news-cron.jsonc`.
**Run now** on `admin-stage3` is the manual fallback; it uses the preview-only secret `GEMINI_API_KEY`
(`wrangler preview secret put GEMINI_API_KEY --name admin-stage3`), separate from production.

## Static site
News pages follow `meta.news_version`, not `content_version`, so a news run never makes the blog or Learning Hub
re-render. While it equals the build's `newsVersion` (in `/_static/build.json`), the pre-built `/news` pages are served.
After a run that publishes, they are rendered by the app until the next build. A news URL with a query string (search,
`page`) and an article published after the build are always rendered by the app. The sitemap lists `/news`, each category
page that has articles, and every published article.

## Local
```
bun run build && bun scripts/static/build-gate.mjs
bun scripts/db/local-admin.mjs setup     # applies 0009 to the local database
bun scripts/db/local-admin.mjs start     # http://127.0.0.1:8787/admin?view=news -> Run now
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=0+*/3+*+*+*"   # runs the cron path locally
```
Put `GEMINI_API_KEY` in `.dev.vars` (git-ignored) to summarise locally; see `.dev.vars.example`.

## Admin
Overview (totals, 30-day tokens and cost, recent runs and failures, **Run now**), Sources (enable/disable, priority, fetch
one now) and Articles (filter; feature, unpublish, republish, retry, delete). Delete wipes the content but keeps URL, GUID
and headline as a tombstone so the item is never collected again. Every write is audited; visible changes bump
`news_version`.
