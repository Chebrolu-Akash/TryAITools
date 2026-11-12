# Technical SEO: sitemap, robots, canonicals, structured data

How the sitemap works internally (build-time file, gate updates between builds, `lastmod` rules) is in
[static-site.md](static-site.md). This page lists the SEO rules the code and the build enforce, and the manual Google
Search Console steps.

## What is indexable
* Fixed pages: `/`, `/tools`, `/categories`, `/about`, `/privacy`, `/terms`, `/affiliate-disclosure`.
* Published categories (`/categories/<slug>`).
* Tools that are published, not flagged, in a published category **and** `indexing = 'index'` (one primary listing per
  product; currently 27 of 2,225 public tools). All other public tool pages render with `noindex, follow` and a
  self-canonical: they stay reachable and pass links, but are not offered to search engines.
* Never: `/admin*`, `/api/*` (search JSON included), `/_static/*`, `/_serverFn/*`, query/filter variants, 404s.

Admin rule: unpublish, archive and flag also set a tool to `noindex`; publishing again does **not** switch it back. The
tool editor shows a notice with an "Allow indexing" button for published `noindex` tools.

## Enforced
| Rule | Where |
|---|---|
| Sitemap = exactly the indexable pages (no `noindex` page in it, no indexable page missing), unique URLs, all `https://tryaitools.io/...`, valid `lastmod`, complete XML | `scripts/static/prerender.mjs` (the build fails otherwise) and the gate tests |
| Every pre-built page: one `<title>`, one meta description, one canonical equal to its own production URL, no `workers.dev`/localhost, valid JSON-LD without ratings/reviews | `prerender.mjs` |
| `/x/` → **301** `/x` (query kept); the target is a final 200 | gate (`src/static/gate.ts`) |
| Old tool slugs → **301** to the current slug: static from `/_static/redirects.json` while nothing changed since the build, by the app (live `tool_redirects`) after a change | gate / app |
| Unknown URLs, `*.html`, case variants (`/TOOLS/x`) → 404 `noindex`, no canonical, no `og:url` | gate, `404.html`, `pageHead({ canonical: false })` |
| Query variants (`/tools?q=`, `/categories/x?sub=`) render the same page with the clean canonical | routes |
| `robots.txt`: `Allow: /`, `Disallow: /admin`, `Disallow: /api/`, `Sitemap: https://tryaitools.io/sitemap.xml`; assets not blocked | `public/robots.txt`, test |
| Public responses carry no `X-Robots-Tag` (only Admin, API and 404 do) | gate test |
| JSON-LD: `WebSite` + `Organization` (home), `SoftwareApplication` + `BreadcrumbList` (tool pages); no prices, ratings or reviews | routes |

Tool and category **slugs cannot be changed in the Admin** (Stage 3). If one is changed outside the Admin, the gate stops
serving the old pre-built page as soon as the catalogue version changes (one-row check), the old URL leaves the sitemap
and the new one appears. Categories have no redirect table: an old category URL becomes 404.

## Preview vs production
Cloudflare adds `X-Robots-Tag: noindex` to every response on the `*.workers.dev` preview (assets included); the code does
not. That header will not be present on `tryaitools.io`. Sitemap, canonicals and Open Graph already use the production
host, so nothing preview-specific is ever emitted.

## Google Search Console (manual, after production goes live on the new build)
1. Search Console → Add property → **Domain** `tryaitools.io` (verified with a DNS TXT record), or URL-prefix
   `https://tryaitools.io/`.
2. Cloudflare dashboard for the zone: confirm **Always Use HTTPS** is on (the code sends HSTS, but the http→https
   redirect is a zone setting) and that `www.tryaitools.io` (if used) redirects to `https://tryaitools.io`.
3. Check in a browser: `https://tryaitools.io/robots.txt`, `https://tryaitools.io/sitemap.xml` (49 URLs today,
   `application/xml`, no `X-Robots-Tag`).
4. Search Console → **Sitemaps** → submit `https://tryaitools.io/sitemap.xml`. It stays the same URL forever (it becomes
   a sitemap index by itself above 45,000 URLs).
5. **URL Inspection** on `/`, one category and one tool → "Test live URL": indexable, canonical = the URL itself.
6. After a few days: **Pages** report. Expected "Excluded by noindex" for the secondary tool listings — intended.
7. Never submit or link the `workers.dev` preview URL.
