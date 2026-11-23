# Production release: final verification and go/no-go — 2026-11-12

Everything here was checked read-only, or on disposable local copies. Production and preview are unchanged: production
still serves Worker version `71862a03` and the database is still at migration 0009.

## 1. All 29 dead-listing decisions

| Disposition | Count | Slugs |
|---|---|---|
| Unpublished to draft | 21 | ai-resume-builder, ai-tutor-pro, airgram, bookmark-aida, campus-management, course-signals, fable-ai, formula-dog, homeworkify, magicvox, minethedata, paraphraser-tool, phrase, snatchbot, supervoicechanger, voice-craftr, voicemodulator-ai, amz-listing-optimizer, blackbox-ai, coqui-studio, tome |
| URL updated | 2 | codegeex → codegeex.cn, docsgpt → www.docsgpt.cloud |
| Merged (archived + 301) | 2 | movio → heygen, seekwell → thoughtspot |
| **Left unchanged (manual review)** | **4** | **audiogen-meta, noisetorch, voice-changer-plus, coqui-tts** |

**The 4 left unchanged.** They are not in the release's action list (the script asserts they are unchanged).
- **Final state of all four:** published, noindex, same category and same URL as today. The clean-up only records
  `url_status = dead` and `review_status = needs_manual`.
- They stay out of the sitemap, and nothing about them changes publicly.
- **Pending your decision:**
  - `audiogen-meta`: move it to the AudioCraft repository, or remove it as a research library?
  - `noisetorch`: list the revived fork?
  - `voice-changer-plus`: list the App Store page?
  - `coqui-tts`: list the official repository or the maintained fork?

## 2. The 28 changed URL-health results

All 28 tools have the same status, indexing, category, URL and redirect as on preview, where the same release was applied.

- **26 tools:** published/noindex before and after. Only `url_status` and `review_status` (`needs_manual` or not) change, and
  both are Admin-only.
- **2 tools change status, both by approved dead-listing actions,** not by the URL check:
  - `seekwell` is merged into thoughtspot.
  - `ai-resume-builder` is unpublished; its domain now serves a parking page.
- **No unintended changes:** no publishing, archiving, redirect or indexing change. The 27 indexed tools are the same slugs.

## 3. Rollback, rehearsed in full on a disposable copy

**Sequence run on the final rehearsed database:**
1. Real Admin undo of dead listings: 25 restored.
2. Real Admin undo of the clean-up: 840 restored, 0 conflicts.
3. Targeted restore from the pre-release export, for what undo doesn't cover:
   - 14 official URLs
   - the 357 redirect rows
   - the category SEO title and description
   - meta and the release's audit rows
   - tools' `updated_at`
4. Migration 0010 down.

**Result against the pre-release production export:**
- **Matches exactly:**
  - integrity ok, 0 foreign-key violations
  - schema and migrations list
  - 2,235 tools: 2,225 published, 10 draft, 27 indexed, every field including `updated_at`
  - categories (except their `updated_at`)
  - redirects (0) and memberships (table removed)
  - meta, audit rows (0), news and the other tables
- **Finding: undo alone is not a full rollback.** It restores status, indexing, category, review fields, pricing, tags and
  memberships, but **not URLs, redirect rows or category copy**.
  - The generated restore file covers the rest: 2,256 statements, in the scratchpad at `rehearsal/restore-after-undo.sql`.
  - The simplest exact restore is still **D1 Time Travel**. It is available on production; the current bookmark is
    `00000762-00000000-00005121-e74107597e44ef843ef95c0c06a681ec`.

## 4. Backup and build ordering

**Finding: there is no automated release script.** The release is the manual checklist, run one command at a time. It
guarantees the following, and I'll follow it exactly:

1. **Pre-write backup:** `wrangler d1 export tryaitools-production` plus a note of the Time Travel bookmark, **immediately
   before the first production write** (migration 0010). Integrity is checked on a local copy before continuing.
2. **Each data step is generated from a fresh production export taken right after the previous step.** Every UPDATE is
   guarded by the `updated_at` in that export, so nothing written in between (for example by Admin) can be overwritten.
3. **The build uses only a production export taken after the last write.** It is never built from preview data, and never
   from the pre-write backup. `build-site.mjs --snapshot <that export>` reads nothing else.
4. Then upload a new version, deploy it, and verify.

If you'd prefer, I can turn this into a guarded runner script before the release. It would stop at each step and refuse to
continue if a backup, integrity check or count differs from this rehearsal. Writing it is a code change, so it needs your go-ahead.

## 5. Final production change list

| # | Change | Exact effect |
|---|---|---|
| 1 | Backup | Export + Time Travel bookmark (no change) |
| 2 | Migration `0010_tool_review_bulk` | Adds to `tools`: review_status, reviewed_at, review_sources, review_notes, review_draft, url_status, url_checked_at. New tables: `tool_categories`, `bulk_operations`, `bulk_operation_items`. Adds category `intro` and `faqs`. Sets 27 indexed tools to `reviewed`. |
| 3 | Duplicate clean-up (1 bulk op, 840 items) | 355 copies archived (noindex) with 355 × 301 redirects. 353 memberships. 9 indexed tools moved to the approved category. 12 URLs updated to the same brand's new domain. `url_status` set for 1,880. 255 marked `needs_manual`. All 2,235 get an audit row. |
| 4 | Dead listings (1 bulk op, 25 items) | 21 published → draft. 2 URL updates. 2 merges (archive + 301). 4 untouched. |
| 5 | Category landing copy | 15 categories: seo_title, seo_description, intro, FAQs |
| 6 | Worker `pixel-perfect`: new version | Indexing gate, Admin bulk/undo/review drafts, `/how-we-review`, About and footer, category landing (intro, top picks, FAQs), technical SEO titles and structured data, news breadcrumbs, lastmod fix, static build from the final export |
| 7 | Not changed | Indexing (still 27), deletions (none), the news Worker, DNS, Cloudflare, secrets |

**Database totals:** 2,225 published / 10 draft / 0 archived → **1,847 / 31 / 357**. Indexed **27 → 27**.
Redirect rows **0 → 357** (356 resolve; the Blackbox one points at a draft and answers 404 by design).

**Sitemap: 76 → 77 URLs.**
- **Added:** `/how-we-review`. **Removed:** none.
- **lastmod:**
  - 27 news URLs: unchanged.
  - 18 tools: 26 Oct → 1 Nov (metadata import).
  - 9 moved tools, 15 categories, `/`, `/tools` and `/categories`: the actual apply time.
- All URLs return 200 and are self-canonical, as checked on the built files.

## 6. Rollback targets

| Layer | Procedure |
|---|---|
| Worker | `wrangler versions deploy 71862a03-a709-4308-8bce-9b5316a0a56d@100% --name pixel-perfect`. That is today's live version; the older fallback is `5743ed7e-982a-44bc-bb05-12b5f468bb25`. The old code works with 0010 applied. |
| Database, exact (preferred) | `wrangler d1 time-travel restore tryaitools-production --bookmark=<bookmark noted at step 1>`. Alternatively, import the step-1 export into a fresh database. |
| Database, selective | Admin undo (dead listings, then clean-up) → restore SQL regenerated from the step-1 export → 0010 down. The order is rehearsed above. |

## Go / no-go

**GO** for the release as rehearsed. The data, migration, build, sitemap and rollback all verify. The release goes ahead under
these conditions:
- I run the checklist manually, step by step, with the backup and fresh-export rules in section 4 (or with a guarded
  runner, if you approve writing one).
- The release commit is made first, and only with your approval.
- The rollback plan is Time Travel, or Worker rollback plus the selective restore. Admin undo alone is not a full rollback.

**Not included, for you to do separately:** the Gemini key, the Cloudflare HTTPS/www redirects, and the decisions on the 4
manual-review tools.
