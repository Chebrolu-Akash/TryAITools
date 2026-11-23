# Production release rehearsal — 2026-11-12 (local copy only)

**Nothing was written to production.** The production Worker is still version `71862a03-a709-4308-8bce-9b5316a0a56d`
(deployed 2026-11-07). Nothing was committed. The rehearsal ran entirely on local in-memory copies of a fresh,
read-only production export.

- **Base export:** `backup-tryaitools-production-20261112T092549Z-rehearsal-base.sql` (integrity ok, 0 foreign-key violations).
- **Fresh URL check:** a read-only fetch of all 2,235 official URLs.
- **Generated SQL:** in the session scratchpad `rehearsal/` folder (`cleanup/cleanup.sql`, `dead/dead-listings.sql`,
  `category-landing.sql`). **It is not for reuse.** Each UPDATE is guarded by the snapshot's `updated_at`, so the real
  release regenerates it from a new export taken just before applying.

## Stages and exact counts

| Measure | Before (prod now) | After 0010 | After clean-up | After dead listings | Final (after category copy) | Preview today |
|---|---|---|---|---|---|---|
| Tools | 2,235 | 2,235 | 2,235 | 2,235 | **2,235** | 2,235 |
| Published | 2,225 | 2,225 | 1,870 | 1,847 | **1,847** | 1,847 |
| Draft | 10 | 10 | 10 | 31 | **31** | 31 |
| Archived | 0 | 0 | 355 | 357 | **357** | 357 |
| Indexed (`index`) | 27 | 27 | 27 | 27 | **27** (same 27 slugs) | 27 (same) |
| Published noindex | 2,198 | 2,198 | 1,843 | 1,820 | **1,820** | 1,820 |
| Review status: reviewed / unreviewed / needs_manual | — | 27 / 2,208 / 0 | 27 / 1,953 / 255 | 27 / 1,955 / 253 | **27 / 1,955 / 253** | 27 / 1,940 / 255 (+13 draft_ready) |
| Redirect rows / to a published page | 0 / 0 | 0 / 0 | 355 / 355 | 357 / 356 | **357 / 356** | 357 / 356 |
| Category memberships | — | 0 | 353 | 353 | **353** | 353 |
| Categories with landing copy | — | 0 | 0 | 0 | **15** | 15 |
| Bulk operations (undoable) | — | — | clean-up (840 items) | + dead listings (25) | **2** | 3 (one is the earlier undone run) |
| Audit rows | 0 | 0 | 2,235 | 2,260 | **2,275** | 5,429 |
| Integrity / FK violations | ok / 0 | ok / 0 | ok / 0 | ok / 0 | **ok / 0** | ok / 0 |

**Final copy compared with preview, record by record:**
- **Identical:** every public tool field (status, indexing, category, subcategory, URL, name, tags, pricing, overview,
  tagline, features), the full redirect map, all 353 memberships, and all 15 categories' landing copy.
- **Expected differences (not public):**
  - Preview holds the 13 pilot drafts (`draft_ready`), which are preview-only.
  - Preview has more audit history.
  - Preview has 30 news articles; production has 22, and the news job is stalled.
  - A few URL-check results differ (below).
- **Unchanged against production before:** news (articles, sources, runs, failures), admin users, site settings, media,
  blog, guest articles, courses, tutorials and gadgets. The same goes for every category field except the 4 landing columns
  and `updated_at`, and every tool ID, slug and creation date. No record was deleted.

## Differences from the preview run (fresh URL check)

The duplicate groups, the 9 category moves, the 355 archived copies and the 12 URL updates are the same as on preview. The
12 updated URLs equal the URLs preview has today. 28 tools differ only in their URL-check note:
- **25 changes in URL health:** temporary blocks, timeouts, a few new off-site redirects, a few recoveries. All of these tools
  are noindex. A URL check never unpublishes anything; it only sets `url_status` and, if needed, `needs_manual`.
- **3 changes in wording only.**

**One dead-listing target re-checked.** `airesumebuilder.io` resolves again, but only to a domain-parking page (it loads
`/lander` with a `parking-lander` script). The "product gone" decision still holds, and the other 24 targets are unchanged.

## Sitemap from the rehearsed production build

`build-site.mjs` passed all checks: 1,909 pages, 1,847 tool pages (27 indexable, 1,820 noindex), 356 redirects.

| Section | URLs | lastmod |
|---|---|---|
| Fixed pages (adds `/how-we-review`) | 9 | `/`, `/tools`, `/categories` = time of the category-copy step. Legal and editorial pages: none. |
| Categories | 15 | Time the category copy is applied (a genuine content change) |
| Tools | 27 | 18 at 2026-11-01T07:32:36Z (metadata import). 9 at the clean-up time (their approved category moves). |
| News categories / articles | 4 / 22 | Their own `updated_at`, unchanged |
| **Total** | **77** (today: 76) | |

**Checks on the built files:**
- Every sitemap URL has a built page with a self-referencing canonical and no noindex.
- All 356 redirects are single-hop. Each old slug has no page of its own, and each target is a built published page
  (46 indexable, 310 published-but-noindex).
- The excluded pages are correct:
  - drafts such as `blackbox-ai`, `tome` and `ai-resume-builder` have no page
  - `movio` → `heygen`
  - `codegeex` now links `codegeex.cn`
- **Category pages:** intro, FAQPage and BreadcrumbList present.
- **News hub:** BreadcrumbList present.
- **`/how-we-review`:** present, titled "How We Review AI Tools | TryAITools".

**`X-Robots-Tag`:** production pages send none. The gate tests assert it, and only 404s and private endpoints carry
noindex. Preview's noindex comes from Cloudflare's preview URL, and it stays.

## Tests

| Check | Result |
|---|---|
| Unit and integration tests | 394/394 pass |
| Typecheck | 218 errors, the same as the existing baseline |
| Script rehearsals | "REHEARSAL OK" from `cleanup-duplicates.mjs` and `apply-dead-listings.mjs`. Category landing: "OK: 15 categories". |
| Build | ALL CHECKS PASSED |
| Afterwards | `.output` was rebuilt from the preview snapshot (86 sitemap URLs), so no production-data build is left there |

## Rollback (rehearsed where possible)

| Layer | How | Rehearsed |
|---|---|---|
| Worker | `wrangler versions deploy 71862a03-a709-4308-8bce-9b5316a0a56d@100%`, immediate. The new schema is compatible with the old code. | version confirmed live today |
| Category copy | Restore the 4 columns from the pre-release export (15 rows) | — |
| Dead listings, clean-up | Admin → Bulk history → Undo, newest first (dead listings, then clean-up). This must happen **before** any schema rollback, because the undo history lives in the 0010 tables. | Undo was exercised on preview (840 items, 2026-11-08) and is covered by tests |
| Schema | `db/rollback/0010_tool_review_bulk.down.sql`, after the Worker rollback | **Yes:** on the post-0010 copy and on the final copy, schema and columns return exactly to the pre-0010 state (integrity ok). Archived copies and redirect rows survive a schema-only rollback, so undo them first if wanted. |
| Everything | Restore the pre-release export, or D1 Time Travel to the time noted before the release | — |

**Note:** the 0010 down-migration file is labelled "PREVIEW database only". Using it on production needs the same
explicit approval as the release itself.

## Release-day order (unchanged from the checklist)

1. Commit the code (once you approve).
2. Take a fresh production export and note the Time Travel time.
3. Rehearse again on that export; the counts must match this report.
4. Apply migration 0010.
5. Regenerate and apply, in order: the clean-up, then the dead listings, then the category copy.
6. Build from the final export.
7. `versions upload`, then `versions deploy`.
8. Run the sitemap audit and crawl on `tryaitools.io`.
9. In Search Console, remove `sitemap_index.xml` and resubmit `sitemap.xml`.
