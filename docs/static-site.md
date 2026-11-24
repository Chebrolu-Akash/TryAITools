# Static public site + gate Worker (Workers Free CPU and D1 quota)

## Why
On Workers Free each request gets **10 ms of CPU** and D1 Free allows **5 million rows read per day**.
* CPU: measured with the built Worker in Node/V8 (not Cloudflare), server-rendering a listing page costs 13–21 ms warm, and
  the first request in a fresh isolate 80–160 ms. That cannot fit in 10 ms, so public pages are rendered **once, at build
  time**, and served as static assets.
* D1: `wrangler d1 insights` (30 Oct 2026) showed the quota was exhausted by the earlier full-catalogue builds during load
  tests (one query reading 6,675 rows, run 368 times; a `count(*)` reading 2,234 rows, run 486 times), plus a public
  `/api/db-check` that read every tool on each call. While the quota was exhausted every D1-backed page **and the Admin**
  failed (the root loader read the public catalogue on `/admin` too).

A stale static file must never show a tool that has since been hidden, so a small Worker (the **gate**) runs first.

## How a request is served
`assets.run_worker_first` sends every path except `/assets/*` and the build's own root files (icons, `robots.txt`,
the manifest, listed by name) to the gate. Uploaded images (`/media/<id>.<ext>`) reach the gate, which reads them from R2.
Content sections (`/courses`, `/gadgets`, `/guest-articles`, `/blog`) are served static while `meta.content_version`
equals the build and rendered fresh after any content change. The gate is `src/static/gate.ts` (bundled to
`.output/server/gate.mjs`, ~19 KB; the app's renderer is only loaded when something must be rendered).

| Request | Result | D1 rows read (measured locally, see below) |
|---|---|---|
| `/assets/*`, images, `robots.txt` | static asset, **the Worker is not run** (no request counted) | 0 |
| public page (`/`, `/tools`, `/categories`, `/tools/x`, `/categories/x`, `/about`, legal pages) | static HTML if still accurate (below) | 1 |
| `GET /api/search?q=&category=&page=` | gate searches the build's index in memory (`src/static/search.ts`) | 1 |
| `GET /sitemap.xml` (`/sitemaps/<n>.xml` once it is an index) | the build's sitemap, kept current by the gate (`src/static/sitemap.ts`) | 1 |
| `/_static/*`, `*.html`, any unknown path, non-GET to a non-app path | static 404 page, no React | 0 |
| `/x/` (trailing slash) | 301 to `/x`; SEO rules: [seo.md](seo.md) | 0 |
| `/admin*`, `/api/admin/*`, `/_serverFn/*` | the app (Admin behind Cloudflare Access + JWT check) | see Admin |

### Visibility (pages)
The gate reads `meta.catalog_version` (Admin bumps it on every change):
* **Same version as the build** → the static file.
* **Different** → once per version per isolate it works out what changed since the build (`changesSince` in
  `src/static/freshness.ts`, indexed queries only), then:
  * tool or category now hidden (unpublished, flagged, archived, draft, deleted, category hidden) → **404**;
  * tool edited or new, or the **old slug of a renamed tool** (`tool_redirects` created since the build) → **rendered live**
    (the app answers the 301 for an old slug);
  * a listing page that links to a hidden item (reverse index `/_static/refs/{t,c}/<slug>.json`) → **rendered live**;
  * any other pre-built **tool page** is served only after one indexed lookup confirms the tool is still public, so even a
    change the detection missed (e.g. direct SQL that bumped the version) cannot serve a stale tool page;
  * otherwise → the static file.
* **D1 unreachable or over quota** → pages: 503 `retry-after: 5`, except within 60 s of the last successful check.
  Search and sitemap: always 503 (they list many tools at once; clients retry).

### Search
The build writes every public tool (display order) to `/_static/search.json` (~324 KB). The gate loads it once per isolate.
When the catalogue changed it removes hidden tools, replaces changed ones (by tool id, so a rename does not leave the old
slug) and drops tools of unpublished categories, reading only the changed rows (~57 rows the first time per version, then
1). Results are identical to the old D1 query (tested for 10 query shapes before and after every kind of change).

### Sitemap
Only published, `indexing = 'index'` tools (one page per product), published categories and the fixed pages. No blog
URLs (no public blog pages yet). `lastmod` = last meaningful change, from `audit_events`:
* tool: creation or last content edit (publish/unpublish/flag are not content changes of the tool page);
* category: its own edits and any change to a tool it lists; `/`, `/tools`, `/categories`: newest of those;
* legal/about pages: none (their content is not in D1); a URL that reappears between builds: when it became public.
Between builds the gate starts from the build's `/_static/sitemap.json` and drops any listed tool or category whose row is
gone or no longer public/indexable (deletions and renames are caught without their rows), and adds newly public ones.
Above 45,000 URLs `/sitemap.xml` becomes a sitemap index of `/sitemaps/<n>.xml`. `robots.txt` already points to it.

Admin rule worth knowing: **unpublish, archive and flag also set a tool to `noindex`**, and only published tools can be set to
`index`. A republished tool is public again but stays out of the sitemap until "index" is chosen in the editor.

## Admin
* `/admin` no longer runs the public catalogue loader, and the session check needs no D1, so the shell always loads.
* D1 problems are explained instead of "Something went wrong": `503 d1_quota_exceeded` ("…daily read limit… resets at
  00:00 UTC. Nothing was saved.") or `503 database_unavailable`. SQL bugs stay `500` with no details.
* The D1 diagnostic moved from the public `/api/db-check` (removed) to `/api/admin/db-check` (Access + owner allowlist).
* Category list counts come from one pass over `tools` (was three); the tool list joins categories for the page only.

## D1 usage (measured locally with workerd's own `rows_read`, local copy of the catalogue: 2,234 tools)
| Request | Rows read | Rows written |
|---|---|---|
| any static page, search, sitemap (catalogue unchanged since the build) | 1 | 0 |
| tool page after a change (version + "still public" check) | 3 | 0 |
| first search / sitemap per isolate after a change, then | 57 / 138, then 1 | 0 |
| first page per isolate after a change (gate change detection) | ~50 | 0 |
| a listing page rendered live because it lists a hidden tool: category page | ~160 | 0 |
| the same for home / `/tools` / `/categories` (app reads summary + counts, first time per isolate per version) | ~16,000 | 0 |
| Admin: stats / categories / tool list (p1) / tool list search / one tool | 2,260 / 4,498 / 6,727 / 4,563 / 2 | 0 |
| Admin write (e.g. archive): batch incl. audit row and version bump | 10 | 9 |
| removed public `/api/db-check` (was ~2,250 per call) | 0 | 0 |

Rough budget: 100,000 page views/day ≈ 100,000 rows (2% of the quota). The expensive case is **many Admin edits while
traffic is spread over many isolates**: each edit that hides a tool makes home/`/tools`/`/categories` render live, ≈16,000
rows per isolate per version (e.g. 30 hiding edits × 5 isolates ≈ 2.4 M rows). Rebuilding after an editing session returns
everything to 1 row per view.

## Publishing workflow
1. Edit in Admin. Visibility changes apply **immediately** (hidden → 404 and gone from search and sitemap; new/edited tools
   render live and appear in search and, if indexable, in the sitemap).
2. Rebuild to return to all-static (cheapest in CPU and D1): `bun run static:build -- --snapshot <export.sql | d1.sqlite>`
   (snapshot from `bun scripts/db/preview-d1.mjs backup`). It regenerates every page, counts, the sitemap, the search index
   and the reverse index from that one snapshot.
3. Deploy the result (separate, explicitly approved step: `wrangler preview --name <preview>` for previews).

### Failure handling
`scripts/static/build-site.mjs` runs build → gate bundle → pre-render → config checks and stops at the first failure.
The pre-render writes to `.output/static-staging` and validates every page (status 200, HTML, canonical URL, `<title>`, no
link to a non-public tool or category), the 404 page, the sitemap (no duplicates, every URL a page of this build, valid
`lastmod`, complete XML, absolute URLs, escaping) and the search index (exactly the public tools). Only when **all** pass are
the old files replaced in `.output/public`. On failure nothing changes and nothing is deployed. Each deploy uploads HTML,
sitemap, index and `build.json` together as one Worker version, so a version never mixes two builds.

## Automatic builds (Cloudflare Workers Builds)
`pixel-perfect` is connected to GitHub. A plain `bun run build` + `wrangler deploy` ships the **full app as the Worker
entry, with no pre-rendered pages**: every page is server-rendered from D1 (thousands of rows per view). That happened on
2026-11-24 (version `0ec08829`) and used most of the day's D1 read quota. So:

| Setting (Workers & Pages → pixel-perfect → Settings → Builds) | Value |
|---|---|
| Build command | `bun run build:static` |
| Deploy command | `bun run deploy:static` |
| Builds for non-production branches | **off** (a `versions upload` would pair preview HTML with the production binding) |
| Build variable | `NODE_VERSION=22` (the pre-render needs Node ≥ 22.5) |

* `bun run build:static` (`scripts/static/ci-build.mjs`): read-only `wrangler d1 export --remote` of the target database
  (in Workers Builds `main` → `tryaitools-production`, any other branch → `tryaitools-preview`; locally
  `STATIC_TARGET=…` or `--snapshot <file>`), then `build-site.mjs`, then the output check below. The snapshot is deleted.
* `bun run deploy:static` / `upload:static`: `scripts/static/verify-static-output.mjs` must pass (Worker entry is
  `gate.mjs`, `run_worker_first` set, `build.json` from a snapshot with ≥ 100 pages, every listed page present, sitemap
  only on `https://tryaitools.io`), then `wrangler deploy` / `wrangler versions upload`.
* Fail closed: in Workers Builds (`WORKERS_CI` set) `vite.config.ts` refuses a `vite build` that the static pipeline did
  not start, so a build command left at `bun run build` fails and deploys nothing. A failed export (e.g. a build token
  without D1 read access) also stops the build.
* Tests: `src/test/static-pipeline.test.ts`.

## Size
2,250 pages, 62.3 MB of HTML (was ~95 MB); identical computed styles to the previous build (checked element by element).
Limits: 20,000 files per version, 25 MiB per file.

## Limitations
* Every page view, search and sitemap request invokes the gate: **100,000 Worker requests/day** on Free (assets do not
  count). Gate CPU must still be measured on Cloudflare (Node estimate: 1–3 ms warm).
* Live-rendered listing pages (after hiding a tool, until a rebuild) cost the old SSR CPU and the D1 reads above.
* Changes made by direct SQL that do not bump `catalog_version` are not seen until the next build.
* Admin list queries read every tool once or twice (no index on display order); an index on `tools(sort_order, id)` would
  make the unfiltered list ~25 rows but needs a D1 migration (not applied).
* `wrangler.jsonc` sets no `compatibility_date`, so Nitro writes the build date into the generated config: each build may
  change the runtime's behaviour date. Pinning it is a Cloudflare configuration change (not made).
