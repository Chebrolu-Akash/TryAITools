# Production release checklist (for approval; nothing here has been run)

This releases the preview work to `tryaitools.io` (Worker `pixel-perfect`, database `tryaitools-production`). **Every step
that changes production needs your explicit go-ahead.** Stop at the first failure.

**Current production state:**
- Worker version `71862a03-a709-4308-8bce-9b5316a0a56d`; the previous known-good version is `5743ed7e…`.
- Database migrations applied up to `0009_ai_news`.
- 2,235 tools, 27 indexed, 0 redirects, no audit rows.

## What the release brings

| Item | Kind | Notes |
|---|---|---|
| Migration `0010_tool_review_bulk` | schema | Review fields, URL status, `tool_categories`, bulk operations, category `intro`/`faqs`. Marks the 27 indexed tools `reviewed` (no lastmod change). |
| Indexing gate, Admin bulk management with undo, review drafts | code | The gate applies when a tool is indexed; nothing is indexed automatically |
| Duplicate consolidation | data | 357 archived copies, 356 working 301s, 353 category memberships. **Must be regenerated against production** (see step 4). |
| Category corrections (the 9 misfiled indexed tools) | data | Part of the clean-up |
| Dead-listing actions (21 unpublished, 2 URL updates, 2 merges) | data | Regenerate against production; skip any tool whose state differs |
| Category landing content (SEO title, description, intro, FAQs × 15) | data | `scripts/db/category-landing.mjs` |
| `/how-we-review`, About page, footer link | code | Owner facts for About are still pending from you |
| Technical SEO | code | Titles, BreadcrumbList on `/tools` and `/categories`, absolute images, JSON-LD escaping |
| AI News breadcrumbs | code | Hub and category pages |
| Sitemap lastmod fix | code | Genuine content dates (1 November imports, approved drafts, visible bulk edits); invisible events ignored |

**Not part of this release, each with its own decision:**
- the Gemini key ([news-gemini-key.md](news-gemini-key.md))
- the Cloudflare redirects ([cloudflare-https-www.md](cloudflare-https-www.md))
- approving pilot drafts and indexing waves. Drafts exist only on preview, so they would be regenerated or re-approved on
  production.
- the 4 manual-review tools and the 217 dead or redirecting URLs

## Steps

**0. Code.** Review the diff, then commit to `feature/website-updates`. Whether to merge into `main` is your call, and I
won't commit until you say so. Run the tests, typecheck baseline and `db:check-config` on the committed tree.

**1. Fresh production backup.**
- `wrangler d1 export tryaitools-production --remote --output backup-tryaitools-production-<ts>-before-release.sql`
- Note D1 Time Travel's bookmark/timestamp too, as a second restore point.
- Verify the file: `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on a local copy.

**2. Rehearse everything on a local copy of that backup.**
- Apply `0010`.
- Run steps 4–6.
- Run the build, the sitemap audit and the reconciliation.
- Record before and after counts: tools by status and indexing, redirects, memberships, indexed tools.
- **Only the expected rows may change.** The 27 indexed tools must stay indexed.

**3. Apply migration 0010 to production.** This must happen before the new code goes live, because the new code reads its tables:

```bash
node node_modules/wrangler/bin/wrangler.js d1 migrations apply tryaitools-production --remote --config wrangler.production-migrations.jsonc
```

**Rollback:** `db/rollback/0010_tool_review_bulk.down.sql`. The old Worker version keeps working with 0010 applied, since it
only adds columns and tables.

**4. Duplicate consolidation, regenerated against production.** Don't reuse the preview SQL: every UPDATE is guarded by
each tool's `updated_at` in the snapshot it was generated from.
- **URL check:** run a fresh one (read-only).
- **Generate against the fresh production export:**
  `scripts/db/cleanup-duplicates.mjs --snapshot <prod export> --urls <check> --history <prod export> --out <dir>`
  - Use the production export itself as `--history`: production URLs were never updated, so they are the original hosts.
- **Compare with preview:** 357 copies archived, 353 memberships. Explain any difference before applying.
- **Apply:** with `wrangler d1 execute tryaitools-production --remote --file …`. It is recorded as one bulk operation and
  can be undone from the Admin.

**5. Dead-listing actions.** Regenerate `scripts/db/apply-dead-listings.mjs` against the post-step-4 export. Each of the
25 tools must be in the state the approval assumed; skip and report any that isn't.

**6. Category landing content.** Run `scripts/db/category-landing.mjs` against the post-step-5 export. Only the 4 category
columns change.

**7. Build from the final production export, then upload a new version without deploying it.**

```bash
bun scripts/static/build-site.mjs --snapshot <final prod export>
```

Check the build summary (pages, sitemap URLs, ~356 redirects, all checks passed). Then upload with
`wrangler versions upload`, using the production config the previous release used.

**8. Deploy the version.**
- Run `wrangler versions deploy <new version>@100%`.
- **Rollback is immediate:** `wrangler versions deploy 71862a03-a709-4308-8bce-9b5316a0a56d@100%`. The database changes
  stay; they are compatible with the old code.

**9. Verify production (read-only).**
- **Sitemap audit:** `scripts/seo/sitemap-audit.mjs --sitemap https://tryaitools.io --check`. Expect 0 problems, every
  URL 200 with a self canonical and no noindex.
- **Sitemap contents:** `/how-we-review` is now listed. lastmod values match the rehearsal.
- **Crawl:** 0 broken internal links, 0 redirect chains or loops.
- **Old slugs:** a sample of old duplicate slugs 301 to their primary page.
- **Category pages:** show the intro, top picks and FAQs.
- **News:** the hub and category pages carry BreadcrumbList.
- **No `X-Robots-Tag`** on production pages. Preview still sends `noindex`.
- `robots.txt` lists `https://tryaitools.io/sitemap.xml`.
- **Admin:** reachable only through Access.

**10. Search Console.**
- Remove `sitemap_index.xml` and resubmit `sitemap.xml`.
- Request indexing for `/how-we-review` and a few category pages.

## Rollback summary

| Layer | How |
|---|---|
| Worker | `wrangler versions deploy 71862a03-…@100%` |
| Data steps 4–6 | Admin → Bulk history → Undo (dead listings, then clean-up). Undo does **not** restore URLs, redirect rows or category copy, so then run a restore SQL generated from the step-1 export (rehearsed: see go-no-go.md §3). Simplest exact path: D1 Time Travel. |
| Schema | `db/rollback/0010_tool_review_bulk.down.sql`, after rolling back the Worker |
| Everything | Restore the step-1 export, or D1 Time Travel to the noted time |

## Rules kept throughout

- Nothing is deleted.
- No tool is bulk-indexed, and the indexing gate is not weakened.
- No secrets go in files or logs.
- DNS isn't changed.
- Preview keeps `X-Robots-Tag: noindex`.
