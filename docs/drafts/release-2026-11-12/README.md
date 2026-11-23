# Sitemap lastmod fix and release preparation — 2026-11-12

**Changed:** preview only, deployed to `admin-stage3`.
**Unchanged:** production database, production Worker, migrations, secrets, DNS and Cloudflare settings. Nothing was
committed.

## 1. lastmod: what was wrong, and the fix

**Before.** A tool's lastmod was its creation date, or its last `tool.create` / `tool.update` audit row. Category pages and
listings also moved on every other audit row.

**Problems found.**
- **Real changes were ignored.** The two 1 November metadata imports changed the tags and pricing badges on every tool
  page and card. They wrote no per-tool audit row, so production showed 26 October everywhere.
  - Import 1: `2026-11-01T07:32:36.373Z`, tags for all 2,235 tools plus pricing for 623.
  - Import 2: `2026-11-01T07:45:10.189Z`, pricing for 158 more.
- **More real changes were ignored.** Approving a review draft (`tool.review_approve`), Admin bulk edits of category,
  tags or pricing, and approved script changes of category or official URL all change the page, yet none of them moved lastmod.
- **Invisible changes moved dates.** Saving an unpublished review draft and recording URL health checks moved the category
  pages' lastmod, although nothing public changed. That made preview show 9 November.

**Fix.** Changed `src/static/sitemap.ts`, `scripts/static/prerender.mjs`, the new `scripts/db/content-imports.mjs` and
`db/metadata/content-imports.json`.
- **One rule for visible content changes** (`CONTENT_EVENT_SQL` / `isContentEvent`), used both at build time and between
  builds. These count:
  - `tool.create`, `tool.update`, `tool.review_approve`
  - `tool.bulk_update` of `category_id`, `subcategory`, `tags` or `pricing_model`
  - approved scripts' category moves and new official URLs
  - **Never counted:** status, indexing, review state, URL health checks.
- **Invisible events** (stored or rejected drafts, URL-status and "needs manual review" notes) now move no lastmod at all.
  Publish, unpublish, flag, delete, indexing changes and memberships still move the category pages and listings, because
  those pages show them.
- **Recorded content imports.** `db/metadata/content-imports.json` is generated from the import SQL itself. A tool listed
  there takes the import's **own** timestamp, but only if it existed when the import ran.
  - **Checked against the production snapshot:** every one of its 2,235 tools has `updated_at` exactly equal to the
    timestamp of the last import that changed it (`bun scripts/db/content-imports.mjs --verify <export>`).
  - **No audit rows were created and no dates were refreshed.** The new rule only ever picks a date that is recorded as
    a real change, and never anything later.

## 2. Results against both databases

These compare the live sitemap with the sitemap the new code builds. News entries are unchanged (that code wasn't touched),
and no lastmod is later than its evidence.

**Production snapshot** (`backup-tryaitools-production-20261107T181819Z-predeploy.sql`; production tools and categories have
not changed since 1 November):

| Page | Before | After | Why |
|---|---|---|---|
| 27 tool pages | 2026-10-26 | **2026-11-01T07:32:36Z** | Import 1 changed their tags and pricing badges |
| 15 category pages | 2026-10-26 | **2026-11-01T07:45:10Z** | Each lists a tool whose pricing badge changed in import 2 |
| `/`, `/tools`, `/categories` | 2026-10-26 | **2026-11-01T07:45:10Z** | The newest change to anything they list |
| about, privacy, terms, affiliate disclosure | no lastmod | no lastmod | Unchanged |
| news (27 URLs) | — | unchanged | Not affected |

**Preview** (`backup-tryaitools-preview-20261112T091418Z-build.sql`, deployed):
- **Unchanged:** 45 of the 86 URLs, including every news URL.
- **Category pages and listings** move from 9 November back to 8 November (the dead-listing unpublish or the clean-up),
  because stored drafts no longer count.
- **Tool pages** move to 1 November (import 1). Six of them move to 8 November 16:08, when the approved clean-up moved
  them to another category, which is visible as their category and breadcrumb.
- **Spot check:** 8 preview tools had Admin pricing edits before the import. The import still set their tags (their current
  tags equal the import's values), so 07:32 is genuine for them too.

## 3. Verification after the preview deploy

| Check | Result |
|---|---|
| Tests | **394/394** pass, including 8 new lastmod tests (`src/test/sitemap-lastmod.test.ts`). The SQL and JS rules are checked to agree. |
| Typecheck | 218 errors, the same as the existing baseline; none in the changed files |
| Lint | Changed files clean. 342 problems remain, all in older files (`tool-content.ts`, metadata scripts, …). |
| Build | All checks passed: 86 sitemap URLs, 356 redirects |
| Sitemap audit | 86 listed = 86 eligible (27 tools, 15 categories, 30 news), all 200 with a self canonical, 0 problems |
| Crawl (2,703 URLs) | 2,315 × 200, 356 × 301, 32 × 404 (drafts + the kept Blackbox redirect); 0 broken links, 0 chains/loops, one H1 per page |
| Preview headers | `X-Robots-Tag: noindex` on all 2,315 pages that return 200 |
| Production | No `X-Robots-Tag`, unchanged |

## 4. Other documents

- [news-gemini-key.md](news-gemini-key.md): why production AI News stopped, and how to set the key securely.
- [cloudflare-https-www.md](cloudflare-https-www.md): HTTPS and www → root redirects (instructions only).
- [production-release-checklist.md](production-release-checklist.md): the separate release plan for your approval.
