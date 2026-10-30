# Public catalogue: Admin is the source of truth

Status (2026-10-30): implemented and verified locally against the local D1 database. Not deployed. Production is unchanged
because the production Worker has no D1 binding, so it keeps serving `tools.json` (see "What production does" below).

## How it works
```
Admin (/admin) --writes--> D1 tools / categories  (+ meta.catalog_version bumped in the same batch)
                                   |
public route loader -> server function (src/lib/catalog/api.ts) -> getCatalog() (src/lib/catalog/source.ts)
                                   |                                   |
                           only public fields                 D1 when bound and imported, else tools.json
```
* **Public = ** `tools.status = 'published' AND tools.needs_review = 0 AND categories.status = 'published'`. Drafts, review,
  archived and flagged tools, and every tool in a draft/archived category, are never read by the public code.
* **Pages** `/`, `/tools`, `/categories`, `/categories/<slug>`, `/tools/<slug>`, `/about`, the footer and `/sitemap.xml` all read the
  live catalogue. Browsers no longer download `tools.json` (it was in the shared JS bundle on every page).
* **Same URLs and SEO.** `src/lib/catalog/model.ts` ports the old slug, indexing, alternatives and related-tools rules. The import
  wrote the same slugs to D1. Tests prove identical output for every tool (`src/test/catalog.test.ts`).
* **Content.** The page copy is the old curated/category template, overridden by any tagline, overview, best-for, features, pros,
  limitations, steps, tips, SEO title or meta description stored in D1 (edited in Admin).
* **Old slugs.** If `tool_redirects` has a row for a retired slug, `/tools/<old>` 301s to the current public slug.

## Freshness and caching
* Every admin tool/category write also upserts `meta.catalog_version`. Each request reads that one row; the in-memory
  catalogue is reused only while the version is unchanged (and at most 60 s, to catch imports made outside Admin).
  A publish/unpublish/archive is visible on the **next page load** in every isolate. Locally measured: under 250 ms round trip.
* HTML pages are not cached at the edge (no `Cache-Control` on SSR). `/sitemap.xml` is cached for 5 minutes (was 1 hour).
* Client-side navigation re-runs the route loader; the root summary (counts, footer categories) is reused for 60 s.

## Fallbacks
* No D1 binding, or D1 tables empty (never imported) -> `tools.json`, exactly the old site.
* D1 error -> the last catalogue this isolate read from D1 (so archived tools do not reappear); only if there is none, `tools.json`.

## Data migration (already built; nothing destructive)
`scripts/db/build-import.mjs` turns `tools.json` + the curated snapshot into idempotent SQL (`INSERT ... ON CONFLICT DO NOTHING`;
curated copy only fills rows an admin has not touched). Re-running it never overwrites Admin edits. `tools.json` stays in the repo
as the fallback and is not modified. Rows the import flags (placeholder names, missing/invalid URLs: 9 rows) are imported as
`draft` + `needs_review`, so they are hidden publicly until fixed in Admin. **Visible change:** the D1-backed site lists 2,225
tools instead of 2,234.

## Run it locally
`bun run build`, `bun run admin:setup` (first time), `bun run admin:dev`, then http://127.0.0.1:8787/ (public) and /admin.

## Cloudflare preview runbook (every step marked [APPROVAL] waits for an explicit yes)
Target: Worker `pixel-perfect`, **Preview** only, D1 `tryaitools-preview` (id `ef1942a9-…`). Never production, never DNS.
Every D1 command goes through `scripts/db/preview-d1.mjs`, which reads only `wrangler.preview-migrations.jsonc` and refuses any
database whose name does not end in `-preview`.

| # | Step | Command | Changes anything? |
|---|---|---|---|
| 0 | Local gate | `bun run build`, `bun run db:check-config` (12/12 PASS) | no |
| 1 | [APPROVAL] Confirm Wrangler login / account | `bunx wrangler whoami` | no (remote read) |
| 2 | [APPROVAL] Read current state | `bun scripts/db/preview-d1.mjs status` (applied migrations) and `verify` (row counts) | no (remote read) |
| 3 | [APPROVAL] **Backup** | `bun scripts/db/preview-d1.mjs backup` -> `backup-tryaitools-preview-<time>.sql` (git-ignored, keep it) | no (export) |
| 4 | [APPROVAL] Apply migration 0002 only | `bun scripts/db/preview-d1.mjs migrate` then `status` | adds table `blog_posts` |
| 5 | [APPROVAL] Import catalogue **only if step 2 showed 0 tools** | `bun run db:build-import`, `bun scripts/db/preview-d1.mjs import`, `verify` (expects 15 / 2,234 / 9 flagged) | inserts; `ON CONFLICT DO NOTHING`, never overwrites |
| 6 | [APPROVAL] Create the preview | `bunx wrangler preview --name admin-stage3` -> prints preview URL | new preview deployment only |
| 7 | You, in Zero Trust | Access app for that preview hostname, paths `/admin*` + `/api/admin*`, allow only your email; copy team domain + AUD | Cloudflare Access |
| 8 | [APPROVAL] Preview-only secrets | `bunx wrangler preview secret put ACCESS_TEAM_DOMAIN --name admin-stage3` (then `ACCESS_AUD`, `OWNER_EMAILS`). Never `ADMIN_LOCAL_DEV_EMAIL`. | preview secrets only |

Between steps 6 and 8 the preview admin answers 503 (fails closed); public preview pages are already readable, which is fine
because they only show published catalogue data and their canonical URLs point at tryaitools.io.

Rollback: `bun scripts/db/preview-d1.mjs rollback --confirm tryaitools-preview` undoes only the newest migration (0002); the backup
from step 3 restores data; `bunx wrangler preview delete admin-stage3` removes the preview. None of these touch production.

Known risk: Wrangler warns it does not support the Bun runtime (this machine has no Node). Local `--local` D1 commands worked;
if a remote command fails for that reason, stop. The fix is installing Node.js, which needs your approval.

### Verification on the preview URL
- Without login: `/api/admin/stats` -> 401 or Access redirect; with a forged `Cf-Access-Authenticated-User-Email` -> still 401.
- Signed in as you: `/admin` loads; counts match `verify`; a non-owner -> 403.
- Public: `/` and `/tools` show 2,225 tools (fresh import); `/api/db-check` -> `bound: true`, `environment: "preview"`.
- Publishing: create + publish a tool in Admin -> reload `/tools`, its category, `/tools/<slug>`: visible. Unpublish -> 404 and gone.
  Archive -> gone. Set its category to draft -> category page 404 and its tools hidden. Restore everything afterwards.
- Search: `/tools?q=<name>` finds the new tool; category filter buttons work.
- SEO: re-run the local crawl against the preview URL (every original slug: 200 + same canonical + same index/noindex; the 9
  flagged slugs 404); `/sitemap.xml` has the same 49 URLs as the JSON site.
- Production check: tryaitools.io unchanged; production Worker shows no D1 binding and no `ACCESS_*`/`OWNER_EMAILS`.

## What production does today, and what a production stage needs
* Today: no D1 binding on `pixel-perfect` production -> `getCatalog()` returns `tools.json`. Merging this code alone changes
  nothing visible except smaller page bundles; the site keeps working without a database.
* Production stage (separate approval): create a production D1, import, bind it at the top level of `wrangler.jsonc`, set Access
  secrets for the production admin hostname, deploy. Until then Admin edits only affect the preview site.
