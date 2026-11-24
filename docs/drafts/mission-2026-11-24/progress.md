# Site mission: progress log (started 2026-11-24)

The single progress file for the "complete TryAITools" mission. Newest state first.

## Production now
| | |
|---|---|
| Worker version | `09d86f21-da48-403c-b979-11d7d471dc78` (static pre-rendered build from the 16:18 UTC export) |
| Rollback | `wrangler versions deploy 0ec08829-8b79-4d9b-84df-20ad8d285244@100% --name pixel-perfect --yes` (the Workers Builds deploy of `19e55db`) or `0912a6b5-…` (the 15:15 runbook release) |
| Backup | `backup-tryaitools-production-20261124T161801Z-before-sitemap-fix.sql`: integrity ok, FK 0; D1 Time Travel bookmark `000017c5-00000000-0000512d-daa90fb043261c7a508e982bd2901715` |
| Database | unchanged by this mission (no writes) |

## Inventory (production DB, 2026-11-24 16:18 UTC)
- Tools 2,235: published 1,536 (848 `index`, 688 `noindex`), draft 54, archived 645. 645 tool redirects.
- Categories 15 (all published). Subcategories 133 (filters on category pages, canonical to the category; not separate pages).
- News: 22 published articles, 4 news categories, 155 pending.
- Empty sections (`/agents`, `/blog`, `/learn/*`, `/gadgets`, `/guest-articles`): `noindex, follow`, not in sitemap, by design.

## Live crawl (every URL, no sampling): `docs/drafts/audit/live-2026-11-24/crawl.csv`
2,941 URLs: 1,536 published tool pages 200; 56 draft/held tool URLs 404; 643 archived slugs 301 to a 200 page; 645
old slugs 301 (2 point at listings taken offline → 404, intended); 15 categories, 22 articles, 4 news categories,
fixed pages 200. Canonical self-referencing everywhere, one H1 everywhere, valid JSON-LD, 0 duplicate titles or
descriptions among indexable pages, 0 indexable tools missing from the sitemap, 0 noindex pages in it, every indexed
tool linked from a category page. Tool pages: 392–~900 words (median 550).

Found and fixed: `/how-we-review` was indexable but missing from the live sitemap (the app's sitemap had its own copy
of the fixed-page list). `src/lib/sitemap.ts` now uses `FIXED_PAGES` from `src/static/sitemap.ts`; test added.

## Google Search Console (checked 2026-11-24)
- Domain property verified (DNS TXT). No manual actions, no security issues.
- Sitemap last read **2026-11-19 with 77 URLs** (the pre-release sitemap). Resubmitted 2026-11-24; Google will re-read 898.
- Page indexing report: 1 indexed / 78 not indexed (76 "Discovered – currently not indexed"). The report lags:
  URL Inspection shows `/tools/chatgpt` "URL is on Google", and 44 pages had impressions in the last 3 months.
- Performance (3 months): 6 clicks, 294 impressions, CTR 2%, average position 20.9.
- Not done: per-URL indexing requests (not useful at this scale; Google crawls from the sitemap).

## Cloudflare zone (changed 2026-11-24)
- **Always Use HTTPS** turned on: `http://` → 301 `https://` (was 200 over plain http).
- **Redirect rule** "Redirect from WWW to root": `https://www.*` → `https://${1}`, 301, query kept. `www` used to fail
  with 525 (its CNAME still points at the old Hostinger host). Undo: delete the rule in Rules → Redirect Rules.

## Security audit
- `/admin` → Cloudflare Access; `/api/admin/*` → 401 without a valid Access JWT (RS256, issuer, audience, expiry
  checked, fails closed); CSRF origin check on writes; owner allow-list. `/_serverFn/*` 403. No exposed files
  (`.env`, `.git`, config, backups → 404). Headers: HSTS, CSP, X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy. Search API `no-store`, no CORS.
- Dependencies: `bun audit fix` (in-range) fixed 24 of 36 advisories (vite 8.1.6, seroval, shell-quote, js-yaml,
  nanoid, source-map-js, brace-expansion …). Remaining 12: undici (wrangler/miniflare, local dev only), zod 3 (only
  behind admin auth, body size capped), minimatch (eslint). Accepted.
- Minor: HSTS header is sent twice (code + zone); harmless.

## Performance (mobile 375 px, in-browser)
Home: HTML 32 KB, JS 150 KB, CSS 22 KB, 339 of 341 images lazy, all with dimensions/aspect boxes, no overflow. Tool,
category and news pages: no overflow, no missing alt text, no unlabeled controls. PageSpeed Insights API quota
exhausted today (shared anonymous quota); Core Web Vitals field data: "No data" in Search Console yet (low traffic).

## RISK found: Workers Builds auto-deploys `main` without the static pre-render
`pixel-perfect` is connected to GitHub (Settings → Builds): every push to `main` runs `bun run build` +
`npx wrangler deploy`. That build has no D1 snapshot, so it ships **no pre-rendered pages**: every page view reads D1.
This happened at 15:42 UTC (push of `19e55db` → version `0ec08829`), replacing the static release. D1's free daily
read limit (5 M rows, account-wide) was at 3.5 M by 16:25 UTC; when it runs out, the site answers 503 (as on 11-23).
Fixed for now by deploying the static build (`09d86f21`). **Needs the owner:** turn on "Disable builds" (or change
the build to the snapshot build) before anything else is pushed to `main`. Blocked for Claude by the permission check.

## Pending / not done
- 688 published `noindex` tools need grounded reviews (Gemini daily quota; the review pipeline is in the AI News
  session). Not indexed until reviewed, by design.
- Subcategory landing pages: not built. 133 subcategories, most with few tools; separate pages would be thin.
- 12 AI News titles over 65 characters; legal pages without JSON-LD (known, low impact).
- Push to GitHub `main`: held until builds are disabled (a push would redeploy the non-static build).
