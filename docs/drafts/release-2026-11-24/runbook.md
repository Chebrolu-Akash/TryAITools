# Production release runbook — 2026-11-24 (commit `ac1958b`)

Approved by the owner (2026-11-23): commit, push to `main`, reviewed production D1 migrations and data changes, deploy to
the production Worker `pixel-perfect`. Not approved: billing changes, deleting production data, unrelated changes.

## Why the site was down (2026-11-23 ~13:30 → 00:00 UTC)
`wrangler d1 execute tryaitools-production … SELECT …` → `code 7500: Your account has exceeded D1's free tier daily row
read limit`. The limit is **account-wide**: a day of preview indexing (G8 gate peer checks, Admin lists, exports, crawls)
used it up, and the production gate answers 503 when D1 cannot be read (by design: it never serves a page it cannot
confirm is still public). No production data was written or lost. Recovery is automatic at 00:00 UTC.

## What is released
- **Code:** everything verified on preview `admin-stage3` (tests 434/434, typecheck at the 218 baseline, changed files
  lint-clean, rehearsal build ALL CHECKS PASSED).
- **Schema:** `0011_review_history` (additive: one table, two indexes). Rollback: `db/rollback/0011_review_history.down.sql`.
- **Data:** `scripts/db/sync-to-production.mjs` (generated SQL, never a database copy):
  - tools: every column that differs from the verified preview, each UPDATE guarded by production's `updated_at`
  - tool_categories → preview set (87 added, 22 removed, 3 updated); tool_redirects: 288 added, 5 re-pointed
  - tool_review_history: 918 rows (G9/G10 evidence, exact revert); audit_events written on preview after the split
    (sitemap lastmod); one `catalog.release_sync` audit row; `catalog_version` bump
  - untouched: news tables, categories, meta (except catalog_version), media, content sections, settings
- Result (rehearsed): published 1,537 (848 index, 689 noindex), draft 53, archived 645; 645 redirects; sitemap 898 URLs.

## Steps (after 00:00 UTC; stop at the first failure)
```bash
W="node node_modules/wrangler/bin/wrangler.js"; TS=$(date -u +%Y%m%dT%H%M%SZ)
# 1. health + one backup of production (and a Time Travel bookmark)
$W d1 execute tryaitools-production --remote --json --command "SELECT value FROM meta WHERE key='catalog_version'"
$W d1 time-travel info tryaitools-production
$W d1 export tryaitools-production --remote --output backup-tryaitools-production-$TS-before-release.sql
#    verify: load locally → PRAGMA integrity_check = ok, foreign_key_check = 0; tools identical to the 2026-11-23 07:26 export
# 2. fresh preview export (read-only) and regenerate + rehearse the sync against the fresh production export
$W d1 export tryaitools-preview --remote --output backup-tryaitools-preview-$TS-release-source.sql
bun scripts/db/sync-to-production.mjs --prod <prod export> --preview <preview export> --since-audit-id 5438 --out <dir>
#    must print REHEARSAL OK
# 3. schema
$W d1 migrations apply tryaitools-production --remote --config wrangler.production-migrations.jsonc
# 4. data
$W d1 execute tryaitools-production --remote --file <dir>/sync.sql --yes
#    then a post-apply export; compare tools / memberships / redirects with the rehearsal (must be equal)
# 5. build from the post-apply export, upload, deploy
bun run static:build -- --snapshot <post-apply export>
$W versions upload --message "Release ac1958b"
$W versions deploy <new version>@100% --name pixel-perfect --yes
```

## Verification (lightweight; ~1 D1 row per page view)
Home, /tools, 5 tool pages, 3 category pages, /news + 2 articles, /api/search, /sitemap.xml (count, only eligible),
robots.txt, canonicals, 10 old slugs → one 301 to a 200 page, 5 draft/held tools → 404 or noindex, /admin → Access,
`PRAGMA`-equivalent checks on the post-apply export. Full sitemap audit only once, after the release.

## Rollback
| Layer | Command |
|---|---|
| Worker | `$W versions deploy d00bd1d1-0620-481f-a961-556ad3462c77@100% --name pixel-perfect --yes` |
| Data (exact) | `$W d1 execute tryaitools-production --remote --file <dir>/sync-rollback.sql --yes` (rehearsed: restores tools, memberships, redirects, audit and meta byte-for-byte) |
| Schema | `$W d1 execute tryaitools-production --remote --file db/rollback/0011_review_history.down.sql --yes` (after the Worker rollback) |
| Everything | `$W d1 time-travel restore tryaitools-production --bookmark=<bookmark from step 1>` or import the step-1 backup |

Order for a full rollback: Worker → data → schema. The old Worker works with 0011 applied (additive).
