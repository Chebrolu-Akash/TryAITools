# Production release log — 2026-11-12

Approved by the owner: "Approve, manual steps". Each step was checked before the next one started. Nothing failed.

| Time (UTC) | Step | Result |
|---|---|---|
| — | 0. Commit | `c9e309b` on `feature/website-updates`: 204 files of code, migrations, scripts, tests and docs. Not pushed or merged. Before committing: tests 394/394, `db:check-config` all passed. |
| 09:56 | 1. Backup | `backup-tryaitools-production-20261112T095626Z-before-release.sql` (integrity ok, FK 0). **Time Travel bookmark `0000076d-00000000-00005121-f07660b517dc3a62f3cdf06e760155ff`** |
| 09:57 | 2. Re-check | tools, categories, redirects and meta are byte-identical to the rehearsal base |
| 09:57 | 3. Migration 0010 | Applied (the only pending migration). 27 reviewed, 2,208 unreviewed, FK 0. The site stayed up. |
| 09:57–09:58 | 4. Clean-up | Generated from `…095741Z-after-0010.sql`, rehearsal OK. Applied: 355 archived, 355 × 301, 353 memberships, 9 moves, 12 URLs. Production then matched the rehearsal exactly. |
| 09:58 | 5. Dead listings | Generated from `…095837Z-after-cleanup.sql`, rehearsal OK. Applied: 21 → draft, 2 URLs, 2 merges. |
| 09:59 | 6. Category copy | Generated from `…095917Z-after-dead-listings.sql`. Applied to 15 categories: intro, FAQs, SEO title, description. |
| 10:00 | 7. Build | From `…095959Z-final-build.sql` (taken after the last write): 1,909 pages, 77 sitemap URLs, 356 redirects, all checks passed. The dry run confirmed `pixel-perfect` and `env.DB = tryaitools-production`. |
| 10:01 | 7. Upload | Version `a3ab25d1-bf91-4bd1-8125-59a5c64af966` |
| 10:01 | 8. Deploy | `a3ab25d1…` at 100%, replacing `71862a03…` |
| 10:02 | 9. Verify | See below |

The audit labels in the generated SQL were changed from "approved preview …" to "approved production release". That was the
only edit, checked by diff.

## Production now

- **Tools:** 2,235: 1,847 published (27 index, 1,820 noindex), 31 draft, 357 archived. None deleted.
- **Redirects and memberships:** 357 redirect rows, 356 of them resolving to published pages. 353 memberships.
- **Review status:** 27 reviewed, 1,955 unreviewed, 253 needs_manual.
- **Undo history:** 2 undoable bulk operations (clean-up 840 items, dead listings 25 items).

## Verification

**Sitemap audit** on `https://tryaitools.io` with `--check`:
- 77 URLs = 77 eligible: 27 tools, 15 categories, 22 news articles plus the hub and 4 categories, and 9 fixed pages
  including `/how-we-review`.
- All return 200 with a self canonical and no noindex. 0 problems.

**Crawl** of 2,635 URLs (every tool slug, every old slug and every article): 2,247 × 200, 356 × 301, 32 × 404 (drafts and
the Blackbox redirect).
- No broken internal links, no internal links to redirects, no redirect chains or loops.
- Exactly one H1 per page. No missing titles, no duplicate canonical titles, no invalid JSON-LD.

**Spot checks:**
- `/tools/movio` → 301 `/tools/heygen`; `/tools/360learning-education-learning` → 301 `/tools/360learning`.
- `/tools/tome` → 404 noindex.
- `/admin` → Cloudflare Access login.

**Robots headers:**
- Production pages send no `X-Robots-Tag`.
- Preview still sends `X-Robots-Tag: noindex`.

## Rollback (if ever needed)

- **Worker:** `wrangler versions deploy 71862a03-a709-4308-8bce-9b5316a0a56d@100% --name pixel-perfect`
- **Database, exact:** `wrangler d1 time-travel restore tryaitools-production --bookmark=0000076d-00000000-00005121-f07660b517dc3a62f3cdf06e760155ff`
  (or import `backup-tryaitools-production-20261112T095626Z-before-release.sql`)
- **Database, selective:** Admin undo (dead listings, then clean-up) → restore SQL from the pre-release backup → 0010 down,
  as rehearsed in go-no-go.md §3.

## Still open (separate decisions)

1. **Search Console:** remove `sitemap_index.xml` and resubmit `sitemap.xml`.
2. **Gemini key** for `tryaitools-news-cron` (news-gemini-key.md).
3. **Cloudflare:** HTTPS and www redirects (cloudflare-https-www.md).
4. **Push or merge** `c9e309b`.
5. **The 4 manual-review tools.**
6. **Pilot drafts and indexing waves.**
7. **Build output:** `.output` currently holds this production build. Rebuild from a preview snapshot before the next
   `wrangler preview`.
