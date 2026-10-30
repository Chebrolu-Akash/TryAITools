# Admin CMS (Stage 3, corrected) — setup, security model, verification

Status: implemented for the PREVIEW database only. Public pages still read `src/data/tools.json`; nothing edited in the
admin changes public pages. Nothing here is deployed. Access is NOT active until you complete and verify the Cloudflare
steps below. All commands use Bun (`bun` / `bunx`); none need `node` or `npx`.

## How requests are protected (every layer fails closed)
1. **Cloudflare Access** (edge) asks visitors to sign in before the Worker is reached.
2. **`src/server.ts` -> `guardAdminPage`** re-verifies the Access token for every `/admin` page request (case-insensitive,
   percent-decoding aware, `\` and `//` normalised). No valid owner token = no admin HTML.
3. **`/api/admin/*` -> `handleAdminApi`** authenticates + authorizes BEFORE routing, on every method and path, including
   paths that do not exist. Then CSRF checks, then validation.
4. **Token verification** (`src/lib/admin/jwt.ts`): RS256 only; signature via WebCrypto against the team's JWKS key chosen by
   `kid`; `iss` = `https://<team>.cloudflareaccess.com`; `aud` contains the configured AUD; `exp` in the future;
   `nbf`/`iat` not in the future (60 s skew); `email` required. JWKS unreachable => 503, never a pass.
5. **Owner allowlist** (`OWNER_EMAILS`): valid identity not on the list => 403. `Cf-Access-Authenticated-User-Email` is never trusted.
6. **Writes**: JSON only, `X-Requested-With: tryaitools-admin`, same-origin, 200 KB cap, strict zod validation, parameterized
   SQL, optimistic concurrency (`updated_at`), idempotent create (`client_id`). A save is reported only if D1 confirms every
   statement in the batch and the **exact row count of each**. The audit row is inserted by `INSERT ... SELECT ... WHERE EXISTS`
   against the just-updated row, so a stale/failed edit cannot leave an audit row behind (review finding H1; this replaces
   reliance on SQLite `changes()`, whose behaviour inside a D1 batch Cloudflare does not document).
7. Permanent deletes (`DELETE /api/admin/{tools|categories|blog}/<slug>`) require the typed slug (`confirm`) and the current
   `updated_at`, and are refused unless the record is deletable: tools must be archived, posts must not be published, categories
   must have no tools. Guard, audit row and DELETE run as one batch. No registration, no password, no secret in browser code.
8. `/admin` and `/api/` are `Disallow`ed in `robots.txt`, admin pages are served `no-store` + `noindex`, and GA4 skips `/admin`.

## Required configuration (Worker secrets; never in Git)
| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | Application Audience (AUD) tag of the Access application |
| `OWNER_EMAILS` | your email (comma-separated if more than one) |
The runtime reads them from whichever of the server-entry `env` or `cloudflare:workers` env actually contains them (finding H2).

## Manual Cloudflare steps (you), preview only
1. Follow `docs/preview-d1-isolation.md` to create/bind the preview database. Then apply migrations to the PREVIEW DB:
   `bun scripts/db/preview-d1.mjs backup`, then `bun scripts/db/preview-d1.mjs migrate`, then `bun scripts/db/preview-d1.mjs status`.
2. **Zero Trust > Access > Applications > Add > Self-hosted** for the preview hostname only, paths `/admin*` and `/api/admin*`.
   Policy: Allow, only your email. Do NOT add `tryaitools.io`.
3. Copy the application's AUD tag and your team domain.
4. Set the three settings for **previews only** (not the dashboard's production "Variables and secrets"):
   `bunx wrangler preview base-config secret put ACCESS_TEAM_DOMAIN` (then `ACCESS_AUD`, `OWNER_EMAILS`); for an existing preview
   `bunx wrangler preview secret put NAME --name <preview>`.
5. Create the preview from the feature branch: `bun run build`, `bun run db:check-config` (all PASS), then
   `bunx wrangler preview --name admin-stage3`. It prints the preview URL; production is not changed.
   Do not pass `ADMIN_LOCAL_DEV_EMAIL` to any preview (it is ignored there anyway, but must never be set).
6. Verify (below). Until all three settings exist the admin answers 503.

## Local admin (no Cloudflare involved)
1. `.dev.vars` (git-ignored, copy from `.dev.vars.example`): `OWNER_EMAILS=<you>` and `ADMIN_LOCAL_DEV_EMAIL=<same email>`.
2. `bun run build`, then `bun run admin:setup` (applies migrations and imports `tools.json` into a LOCAL SQLite D1 under
   `.wrangler/state-admin`; every Wrangler call is `--local`).
3. `bun run admin:dev`, open **http://127.0.0.1:8787/admin**. Rebuild and restart after code changes.
   `bun scripts/db/local-admin.mjs reset --confirm` wipes the local data.

The local sign-in (`localDevAuth` in `src/lib/admin/auth.ts`) applies only when `ADMIN_LOCAL_DEV_EMAIL` is set, the host is
`localhost`/`127.0.0.1`/`[::1]`, there is no `Cf-Ray` header (every request through Cloudflare's edge has one), and the email is on
`OWNER_EMAILS`. Otherwise the normal Access check runs. **Never set `ADMIN_LOCAL_DEV_EMAIL` on any Cloudflare environment.**
`admin:dev` serves with Miniflare (bundled with Wrangler) because `wrangler dev` cannot proxy requests under Bun.

## Verification checklist on the preview URL
- `curl -i https://<preview>/api/admin/stats` (no login) -> 401 or Access redirect, never data.
- Same with a forged `Cf-Access-Authenticated-User-Email` header -> still 401.
- Signed in as you: `/admin` loads, counts show. A signed-in non-owner -> 403.
- Create a draft tool, reload: persists. Invalid input: field messages, nothing saved.
- Edit the same tool in two tabs: second save reports a conflict and saves nothing; no extra audit row.
- `/sitemap.xml` and a tool page are unchanged. GA4 DebugView shows no page_view for `/admin`.

## M3 — what changes in PRODUCTION if this branch is ever merged to `main`
Nothing is applied to production by this stage, but a merge would ship code, so you should know exactly what:
* `/admin` and `/api/admin/*` routes exist on `tryaitools.io`. With no `ACCESS_*`/`OWNER_EMAILS` secrets on the production Worker they answer
  **503** (closed), but the URLs are reachable. Do not add production Access/secrets until you approve a production stage.
* `src/server.ts` now runs a path check on every request (cheap; only `/admin` paths take the guard) and sets no-store/noindex on admin pages.
* `robots.txt` gains `Disallow: /admin` and `Disallow: /api/`. `analytics.ts` skips `/admin`.
* Migrations `0002_blog.sql` (and 0001) are files only; **nothing runs them on production**. Public pages still use JSON.
* `wrangler.jsonc` gains `previews.d1_databases` only. It has no top-level D1, so production gets no database binding.
* New dependencies: none are added by these files beyond what the project already uses (zod, radix are already present); `package.json` is not changed by the core patch.

## M4 — rate limiting: not implemented
The admin API has **no application-level rate limiting**. Mitigations: every request needs a valid Access token for an allow-listed
owner, so only you can reach it; bodies are capped at 200 KB; writes are optimistic-concurrency checked. Remaining exposure: a
compromised owner session or buggy client loop could burn D1 write quota (Free plan: 100,000 rows written/day). A Cloudflare WAF rate-limiting
rule on `/api/admin/*` is the recommended later addition; I have not configured it.

## Not built in this stage
Public blog pages/nav, prompts, affiliate links, media library, SEO/site settings, slug-rename redirects, user management,
switching public pages to D1.

## Verified locally (2026-10-30)
Vitest 164/164; `bun run build`; `db:verify-local` 32/32; `db:check-config` 12/12 (Nitro keeps `previews`); lint clean for admin files.
Against the real local D1 runtime: dashboard counts, create/publish/unpublish/delete of a post through the UI, category
create/edit/stale-edit 409/delete, tool archive -> delete (live tool refused, stale token 409, one audit row), CSRF 403/415.

## Still unverified until you run it
The Cloudflare Access flow, Worker Preview secrets and remote D1 binding, and `tsc --noEmit` (the strict tsconfig reports type
errors in the admin files; the build does not type-check).
