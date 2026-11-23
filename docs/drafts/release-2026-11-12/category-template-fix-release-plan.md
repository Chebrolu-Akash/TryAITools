# Production release plan: category template fix (for approval; nothing deployed)

Prepared 2026-11-12. **Production is unchanged.** It serves Worker version `a3ab25d1-bf91-4bd1-8125-59a5c64af966`
(commit `c9e309b`). Nothing is committed, pushed or merged.

## 1. What changes

Uncommitted changes, inspected with `git status` and `git diff`. Only these two files:

| File | Change |
|---|---|
| `src/lib/tool-content.ts` | +4 −2. `catSlug()` no longer turns `&` into `and`. It is now exported for the test, with a 2-line comment. |
| `src/test/category-template.test.ts` | New, 8 regression tests. All 8 fail on the old code and pass on the new. |

The diff:

```diff
-const catSlug = (category: string) =>
-  category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
+export const catSlug = (category: string) =>
+  category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
```

No other source, config, migration or script changed. The untracked files in the repo are the existing data, review and
backup files, and are not part of this release.

## 2. Fresh production export

- **File:** `backup-tryaitools-production-20261112T115440Z-template-fix-build.sql`, read-only export.
- **Integrity:** `PRAGMA integrity_check` ok, 0 foreign-key violations, migrations up to `0010_tool_review_bulk`.
- **Unchanged since the release:** it is **byte-identical** to the post-release export
  `…20261112T095959Z-final-build.sql`.
  - 1,847 published (27 index, 1,820 noindex), 31 draft, 357 archived.
  - 357 redirect rows, 2,275 audit rows, 15 categories.

## 3. Build from that export (not the preview `.output`)

```bash
bun scripts/static/build-site.mjs --snapshot backup-tryaitools-production-20261112T115440Z-template-fix-build.sql
```

**Result: ALL CHECKS PASSED.**
- 1,909 pages, 1,847 tool pages.
- 77 sitemap URLs and 356 redirects, the same as live.
- Snapshot version `2026-11-12T09:59:23.637Z#category-landing`.

**Proof that only the fix changes.** A baseline was built from the same export with the old `catSlug` line, then compared
with this build. Each build's build ID, generation time and router render timestamp were ignored.

| | Result |
|---|---|
| Files compared | 3,864 |
| **Pages changed** | **726: all tool pages in the 5 `&` categories.** Audio & Voice 135, Coding 125, Design 110, Education 191, Resume & HR 165. That is 720 noindex + 6 indexed. |
| Other tool pages, category pages, home, news, legal and other pages | Unchanged |
| JS, CSS and other assets | Unchanged (same file names and contents) |
| `sitemap.xml`, `robots.txt` | Byte-identical |
| robots meta, canonical, `<title>`, meta description, H1 | Unchanged on all 726 pages |

The baseline itself reproduces the live release: 77 sitemap URLs, 356 redirects, 1,909 pages.

**What the 726 pages now show:**
- the category's own "Best for", description sentence, starter prompt, steps and tips, instead of the Chatbots text
- curated overview and features: unchanged

**Checked in the built files:**

| Page | Best for | Robots |
|---|---|---|
| elevenlabs, murf-ai, otter-ai, suno-ai (indexed) | "Podcasters, video creators, educators and teams that work with audio." | none (indexable) |
| cursor-ai (indexed) | "Developers, students and technical teams." | none |
| figma (indexed) | "Designers, product teams and founders." | none |
| ispeech-voice-cloning, accelq, abstract, adaptiveu, 15five (noindex) | Their own categories' audience | `noindex, follow` |

## 4. Tests and checks (on the working tree being released)

| Check | Result |
|---|---|
| Full test suite | **402/402 pass** (30 files) |
| New regression tests | 8/8 pass. Covers the 5 `&` names, all 15 names mapping to their IDs, Chatbots being the only category on the Chatbots template, and a curated `&` tool. |
| Typecheck | 218 errors, the existing baseline. None in the changed files. |
| `db:check-config` | ALL CHECKS PASSED. The production config binds `tryaitools-production`, never preview. |
| Static build checks | ALL CHECKS PASSED |
| Preview (`admin-stage3`) | Verified earlier today: 20 pages and the browser look all correct, sitemap unchanged, preview still noindex |

## 5. Deployment target (dry run, nothing uploaded)

`wrangler versions upload --dry-run` reads `wrangler.jsonc`, redirected to `.output/server/wrangler.json`:
- **Worker:** `pixel-perfect`
- **Bindings:** `env.DB (tryaitools-production)`, `env.ASSETS`. There are no other bindings.

`wrangler deployments status --name pixel-perfect` shows the live deployment:
- **Version:** `a3ab25d1-bf91-4bd1-8125-59a5c64af966` at 100%
- **Deployed:** 2026-11-12T10:01:42Z
- **Message:** "Release c9e309b"

## 6. Release steps (each one waits for your approval)

**Rule:** `.output` must be the build from step 3. If anything has run `wrangler preview` or rebuilt since, rebuild with
the step-3 command first. No other command writes to production: there are no database, sitemap, DNS or secret changes.

**0. Commit (optional, your call).** Commit the two files to `feature/website-updates`, so the deployed code matches a
commit. Not done. Deploying without a commit is possible, but the live version would then not match any commit.

**1. Re-confirm production is unchanged.** Read-only. If the export differs, stop: rebuild and re-compare.

```bash
node node_modules/wrangler/bin/wrangler.js d1 export tryaitools-production --remote --output backup-tryaitools-production-<ts>-pre-template-fix.sql
cmp backup-tryaitools-production-<ts>-pre-template-fix.sql backup-tryaitools-production-20261112T115440Z-template-fix-build.sql
```

**2. Upload the new version** (not deployed yet):

```bash
node node_modules/wrangler/bin/wrangler.js versions upload --message "Category template fix: & categories use their own template"
```

Note the `Worker Version ID` it prints, `<NEW_VERSION_ID>`.

**3. Deploy it at 100%:**

```bash
node node_modules/wrangler/bin/wrangler.js versions deploy <NEW_VERSION_ID>@100% --name pixel-perfect --message "Category template fix" --yes
```

## 7. Rollback (immediate, code only)

There is no data to roll back. To return to the current live version:

```bash
node node_modules/wrangler/bin/wrangler.js versions deploy a3ab25d1-bf91-4bd1-8125-59a5c64af966@100% --name pixel-perfect --message "Rollback category template fix" --yes
```

## 8. Verification after deployment (read-only)

**The 6 indexed pages:** each must return 200, show its category's "Best for" and no chat wording, have no robots noindex,
and keep a self canonical.

```bash
for s in elevenlabs murf-ai otter-ai suno-ai cursor-ai figma; do
  h=$(curl -s https://tryaitools.io/tools/$s)
  echo "$s $(curl -s -o /dev/null -w '%{http_code}' https://tryaitools.io/tools/$s) | $(echo "$h" | grep -ao 'Podcasters[^<]*\|Developers, students and technical teams\.\|Designers, product teams and founders\.\|Almost anyone[^<]*' | head -1) | chat=$(echo "$h" | grep -ac 'start a new conversation') | robots=$(echo "$h" | grep -ao '<meta name="robots"[^>]*>')"
done
```

**Expected results:**
- **Indexed pages:** audio ×4, coding, design; `chat=0`; no robots meta.
- **Noindex samples**, one per category (`ispeech-voice-cloning`, `accelq`, `abstract`, `adaptiveu`, `15five`): their own
  audience, still `noindex, follow`.
- **Unchanged controls:**
  - Chatbots pages (`ada-cx`) still show the Chatbots text, as intended.
  - A writing page (`chatgpt`) is unchanged.
- **Category pages:** `/categories/ai-audio-voice-tools`, `/categories/ai-coding-developer-tools`,
  `/categories/ai-design-ui-ux-tools`, `/categories/ai-education-learning-tools` and `/categories/ai-resume-hr-tools`
  return 200, with intro, FAQs and BreadcrumbList unchanged, self canonical, no noindex.
- **Sitemap audit:** `bun scripts/seo/sitemap-audit.mjs --sitemap https://tryaitools.io --check` gives 77 URLs and
  0 problems. `sitemap.xml` is byte-identical to the build.
- **Headers:** no `X-Robots-Tag` on production pages; preview still sends `noindex`.
- **Admin:** `/admin` still goes to the Cloudflare Access login.
- **Live version:** `wrangler deployments status --name pixel-perfect` shows `<NEW_VERSION_ID>` at 100%.

**If any check fails, roll back with §7 and report.**

## Release attempt log, 2026-11-12

**Done:**
- **Commit:** `c36c367` (local only), containing the two files.

**Stopped at step 1:**
- **What differed:** `backup-tryaitools-production-20261112T120538Z-pre-template-fix.sql` differed from the plan export.
- **Cause:** the scheduled news cron run at 12:00 UTC. It added one `news_runs` row (`partial`, 0 published, "GEMINI_API_KEY is
  not configured"), one `news_failures` row, and the `sqlite_sequence` counter.
- **Nothing else changed:** no tool, category, redirect, article or indexing data.
- **Rebuild check:** a rebuild from the new export is identical to the verified candidate. 0 of 3,864 files differ once the
  build ID and timestamps are ignored.

**Not done:** no upload and no deploy. Production still serves `a3ab25d1`.

**Second attempt (approved with exclusions for `news_runs`, `news_failures` and their sequence counter only). Stopped
again.**
- **Export:** `backup-tryaitools-production-20261112T121312Z-pre-template-fix.sql`.
- **Unexpected difference:** with the approved exclusions applied, the **4 `news_sources` rows** still differ. The 12:00 cron
  updated their fetch state:
  - `last_fetched_at`, `last_success_at`, `updated_at`
  - Microsoft Research: `etag`, `last_modified`, `last_error` cleared, `consecutive_failures` 1 → 0
  - Ars Technica: `robots_checked_at`, `consecutive_failures` 15 → 16
- The first attempt missed this because its comparison looked only at the first 300 characters of each line.
- **Identical row for row:** tools, categories, tool_redirects, tool_categories, news_articles, site_settings, meta,
  audit_events, bulk_operations, admin_users.
- **Build:** the 12:05 export, which already held these `news_sources` changes, rebuilt identically to the verified
  candidate.
- **Not done:** no upload and no deploy.

**Third attempt: released.** This run had the approved exclusions:
- `news_runs` and `news_failures`, and their sequence counter
- these `news_sources` columns: `last_fetched_at`, `last_success_at`, `etag`, `last_modified`, `last_error`,
  `consecutive_failures`, `robots_checked_at`, `updated_at`

| Time (UTC) | Step | Result |
|---|---|---|
| 12:15 | Export | `backup-tryaitools-production-20261112T121535Z-pre-template-fix.sql` |
| 12:16 | Full comparison | Schema and every row and column of every table, apart from the exclusions. **No unexpected differences.** All 18 `news_sources` rows match on their other columns. `news_runs` 39 → 40, `news_failures` 20 → 21 (excluded). Comparator self-test: it flags the known category-copy differences in an older export. |
| 12:17 | Rebuild | ALL CHECKS PASSED: 1,909 pages, 77 sitemap URLs, 356 redirects. **0 of 3,864 files differ** from the verified candidate, ignoring only build ID, generation time and render timestamp. Source tree clean at `c36c367`. |
| 12:19 | Upload | Version **`db4a84f1-474c-441f-b37c-daf8f6d0031a`**. Bindings: `env.DB (tryaitools-production)`, `env.ASSETS`. |
| 12:20 | Deploy | `db4a84f1…` at 100% on `pixel-perfect`, replacing `a3ab25d1…`, which is kept for rollback |
| 12:21 | Verify | All checks passed (below) |

**Verification on `https://tryaitools.io`:**
- **Indexed pages:** elevenlabs, murf-ai, otter-ai, suno-ai (audio), cursor-ai (coding), figma (design).
  - All 200, self canonical, no robots meta.
  - Their own category's "Best for", with no chat wording.
- **Noindex samples:** ispeech-voice-cloning, accelq, abstract, adaptiveu, 15five.
  - All 200 with their own category text, still `noindex, follow`, self canonical.
- **Controls:**
  - ada-cx (Chatbots) still shows the Chatbots text, as intended.
  - chatgpt (Writing) is unchanged and indexable.
- **Category pages** for the 5 `&` categories:
  - 200, FAQPage and BreadcrumbList present, no robots noindex, self canonical.
  - The audio and resume pages match the build exactly.
- **Live pages vs build:** `/`, elevenlabs, figma, ispeech-voice-cloning and 2 category pages match the built files exactly,
  ignoring the render timestamp.
- **Sitemap and robots:** `sitemap.xml` is byte-identical to the build (77 URLs), and so is `robots.txt`.
- **Sitemap audit** (`--check`): 77 URLs, 27 of 27 eligible tools listed, 15 categories, 77 HTTP checks, **0 failures,
  0 problems**.
- **Headers:** no `X-Robots-Tag` on production. Preview still sends `noindex`.
- **Other spot checks:**
  - `/admin` → 302 to the Cloudflare Access login.
  - `/tools/movio` → 301 to `/tools/heygen`.
- **Database:** unchanged, 1,847 published (27 index, 1,820 noindex), 31 draft, 357 archived.

**Rollback:** `wrangler versions deploy a3ab25d1-bf91-4bd1-8125-59a5c64af966@100% --name pixel-perfect --yes`.

## Not part of this release

- Indexing changes
- Sitemap logic
- Database records
- The news Worker
- DNS and secrets
- Cloudflare settings
