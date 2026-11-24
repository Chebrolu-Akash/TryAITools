# Production release log — 2026-11-24 (commit `ac1958b`)

Approved by the owner on 2026-11-23: commit, push to `main`, reviewed production D1 changes, deploy. Plan: [runbook.md](runbook.md).

| Time (UTC) | Step | Result |
|---|---|---|
| 15:07 | Recovery check | D1 readable again after the account-wide daily read limit reset; `/`, `/tools`, `/sitemap.xml` 200 |
| 15:07 | Time Travel bookmark | `000017b1-00000000-0000512d-87fbf4281444b26071cbeb9ddf1590a7` |
| 15:07 | Backup | `backup-tryaitools-production-20261124T150752Z-before-release.sql` (4.4 MB): integrity ok, FK 0 |
| 15:08 | Drift found | 12 owner edits made in the live Admin on 2026-11-23 09:01–10:28 (11 affiliate URLs, Smart Copy flagged to draft). The sync gained `--prod-base`: columns changed on production since the 07:26 snapshot keep the production value |
| 15:09 | Preview source | `backup-tryaitools-preview-20261124T150752Z-release-source.sql`: synced tables identical to the verified b24 export |
| 15:10 | Rehearsal | REHEARSAL OK: 2,234 tool updates, 12 edits kept, 87/22/3 memberships, 288 + 5 redirects, 918 history rows, 4,233 audit rows; rollback restores everything byte-for-byte |
| 15:10 | Migration | `0011_review_history` applied (only pending migration) |
| 15:11 | Data | `sync.sql`: 7,791 changes = 7,791 statements (rows read 22,051, written 24,182) |
| 15:12 | Post-apply check | `…20261124T151213Z-after-sync.sql`: tools, memberships, redirects, history, categories and news identical to the rehearsal; integrity ok, FK 0 |
| 15:13 | Build | From the post-apply export: 1,598 pages, 898 sitemap URLs, ALL CHECKS PASSED |
| 15:15 | Deploy | Version `0912a6b5-e387-49c5-9162-60a9d6f54a0b` at 100%, replacing `d00bd1d1-0620-481f-a961-556ad3462c77` |

## Production now
- Tools 2,235: published 1,536 (848 index, 688 noindex), draft 54, archived 645. Nothing deleted.
- 645 redirects, 418 category memberships, 918 review-history rows. News tables untouched (22 published articles listed).

## Live verification
- Sitemap audit `--check`: 898 URLs (848 tools = 848 eligible, 15 categories, news, fixed pages), all 200, self-canonical,
  no noindex, 0 problems; 16 excluded tool pages sampled: noindex or not 200.
- Crawl: 0 non-200, 0 bad canonicals, 0 duplicate titles/descriptions, one H1 everywhere, valid JSON-LD, 1,594 internal
  links: 0 broken, 0 to redirects, 0 chains.
- Redirects: 643 of 645 answer one 301 to a 200 page; 2 point at listings taken offline (papercup, blackbox-ai), as before.
- Spot checks: home, /tools, /categories, 3 category pages, 5 tool pages, /news + article (Article + BreadcrumbList),
  /api/search, robots.txt, /about, /how-we-review, /privacy: 200. Drafts 404; held tools `noindex, follow`.
  Affiliate URLs live (e.g. ElevenLabs, Rytr). `/admin` → Cloudflare Access. No `X-Robots-Tag` on production.
- Mobile 375 px: no horizontal overflow on a tool page and /news.

## Known, not changed
- 12 AI News titles over 65 characters; `/tools/claude` description 166 characters; legal pages have no JSON-LD.
- The production Worker has no `GEMINI_API_KEY`: Admin draft generation is unavailable there (public site unaffected);
  the production news cron also has none (accepted earlier).
- When D1's account-wide daily read limit is exhausted, the gate answers 503 by design. Heavy preview work shares that limit.

## Rollback
1. Worker: `wrangler versions deploy d00bd1d1-0620-481f-a961-556ad3462c77@100% --name pixel-perfect --yes`
2. Data: `wrangler d1 execute tryaitools-production --remote --file <sync-final>/sync-rollback.sql --yes`
   (copy kept in this folder as `sync-rollback.sql`)
3. Schema: `wrangler d1 execute tryaitools-production --remote --file db/rollback/0011_review_history.down.sql --yes`
4. Or everything: `wrangler d1 time-travel restore tryaitools-production --bookmark=000017b1-00000000-0000512d-87fbf4281444b26071cbeb9ddf1590a7`
