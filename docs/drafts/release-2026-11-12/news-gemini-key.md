# Production AI News: the Gemini key

## What I found (read-only)

- The production news job is the separate Worker **`tryaitools-news-cron`** (`wrangler.news-cron.production.jsonc`). It runs
  every 3 hours and uses model `gemini-3.5-flash-lite`. Its only binding is the production D1 database.
- **The Worker has no secrets at all.** `wrangler secret list --name tryaitools-news-cron` returns `[]`. The code reads
  `env.GEMINI_API_KEY` (`src/lib/news/cron.ts`). Without it, every run collects new items but doesn't summarise them.
- **The production database shows the result.**
  - 39 runs logged "GEMINI_API_KEY is not configured: items were collected but not summarised" (the latest at 2026-11-12 09:00 UTC).
  - 63 articles are `pending`. 22 are published, the newest from 6 November.
- **Separate and harmless:** some sources block automated access in `robots.txt` (15 notes) or time out (4). Those are
  skipped as designed.

## How to set it (you do this; never paste the key into chat, a file or a commit)

1. **Create a key with no billing.** In Google AI Studio (aistudio.google.com → **Get API key**), create a key in a project
   that has **no billing account linked**, so it can only use the free tier. Then a quota error makes the job stop and
   retry later; it can never run up charges. The pipeline already treats a 429 as "stop and retry later".
2. Open a terminal in the project folder, check you are signed in, then store the secret. Wrangler prompts for the value
   and doesn't echo it:

```bash
node node_modules/wrangler/bin/wrangler.js whoami
```

```bash
node node_modules/wrangler/bin/wrangler.js secret put GEMINI_API_KEY --name tryaitools-news-cron
```

   - Paste the key at the hidden prompt and press Enter.
   - Doing this creates a new version of the news Worker with the same code, plus the secret.
   - Nothing else changes: not the site Worker, the database or the schedule.
3. Confirm the name is now listed. Only names are shown, never values:

```bash
node node_modules/wrangler/bin/wrangler.js secret list --name tryaitools-news-cron
```

4. **Check the next run.** Runs start at 00:00, 03:00, 06:00 … UTC. After the next one, the latest `news_runs` row should no
   longer show the "not configured" error, and `pending` should fall by up to 4 per run (`NEWS_MAX_SUMMARIES_PER_RUN`).
   At that pace the 63-item backlog takes about 16 runs, roughly 2 days. I can run the read-only check for you whenever
   you like.

## Notes

- Items older than 10 days are no longer summarised (`maxAgeDays`). Part of the current backlog may age out instead of
  being published. That's intended: the pipeline doesn't publish stale news.
- New articles join the sitemap automatically, each with its own `updated_at` as lastmod.
- To remove the key later, run `wrangler secret delete GEMINI_API_KEY --name tryaitools-news-cron`. The job then goes back to
  collecting only.
