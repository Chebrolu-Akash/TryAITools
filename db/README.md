# D1 database — Stage 2 runbook (PREVIEW ONLY)

Nothing here touches production. Every script refuses any database whose name does not end in
`-preview` (see `scripts/db/guard.mjs`). The production database is not created, bound or written
until it is explicitly approved as its own stage.

## What exists

| Path | Purpose |
|---|---|
| `migrations/0001_core.sql` | Versioned schema: `categories`, `tools`, `tool_redirects`, `admin_users`, `audit_events`, `site_settings`, `meta`. Applied with `wrangler d1 migrations apply`. |
| `db/rollback/0001_core.down.sql` | Manual rollback. Kept **outside** `migrations/` so Wrangler can never apply it by accident. Destroys data in the target DB. |
| `scripts/db/build-import.mjs` | Generates idempotent SQL from `src/data/tools.json` (+ the 27 hand-reviewed tools' content). Writes only to `db/import/out/` (git-ignored). Never contacts Cloudflare. |
| `scripts/db/verify-local.mjs` | Applies migration + import to an in-memory SQLite DB and runs 29 checks (counts, slugs, constraints, idempotency, rollback). |
| `scripts/db/set-preview-binding.mjs` | Writes the preview `DB` binding into `wrangler.jsonc` after you create the database. |
| `scripts/db/check-generated-config.mjs` | After `bun run build`, proves the Nitro-generated Worker config contains the preview binding. |
| `scripts/db/preview-db.mjs` | `migrate` / `import` / `verify` against the preview DB only. |
| `src/lib/db/*` | Runtime helpers: binding lookup, JSON fallback (`loadTools`), confirmed-write helper (`dbWrite`), temporary `/api/db-check`. |

## Source-of-truth rules
* `src/data/tools.json` is never modified or deleted. It remains the import source and the fallback.
* Public pages **do not read D1 yet**. They switch only after the preview import is verified and you approve.
* Imported tools keep today's slugs exactly (a test compares them with `tool-pages.ts`).
* The 9 placeholder/incomplete rows are imported as `status='draft'`, `needs_review=1`, `import_issue=…`
  and are never public. Nothing is deleted or invented.
* Re-running the import is safe: every insert is `ON CONFLICT DO NOTHING`, and curated content only fills
  rows an admin has not touched.

## Manual steps (you), PowerShell, from the repo folder on `feature/website-updates`

```powershell
git pull

# 1. Local checks (no Cloudflare involved)
bun install --frozen-lockfile
bun run db:verify-local        # expect: 29/29 checks passed  (needs Node >= 22.5)
bun run test                   # includes src/test/db.test.ts

# 2. Create the PREVIEW database (the only database created in this stage)
npx wrangler d1 create tryaitools-preview
#   copy the database_id (a UUID) it prints

# 3. Add the binding locally, then review the diff
node scripts/db/set-preview-binding.mjs <database_id>
git diff wrangler.jsonc

# 4. Prove the generated Worker config received the binding
bun run build
bun run db:check-config        # all PASS, or tell me which FAIL

# 5. Migrate + import + verify the preview database
bun run db:build-import
node scripts/db/preview-db.mjs migrate
node scripts/db/preview-db.mjs import
node scripts/db/preview-db.mjs verify
```

Do **not** commit `wrangler.jsonc` with the binding until step 4 passes. Committing it to
`feature/website-updates` only affects branch preview versions of the Worker; production is
unaffected until a version is deployed from `main`. Before anything is ever merged to `main`, the
binding must be reviewed deliberately, because the same file would otherwise carry the preview
database into a production deploy.

## Preview runtime check
After the feature branch preview is built on Cloudflare, open
`https://<preview-host>.workers.dev/api/db-check`. Expected:
`{"bound":true,"environment":"preview","canRead":true,"tools":2234,"categories":15,…}`.
The endpoint returns 404 on `tryaitools.io`, `www.tryaitools.io` and any non-`workers.dev` host. It is
temporary and is replaced by an Access-protected health page in Stage 3.

## Backup, recovery, rollback
* Backup before any change: `npx wrangler d1 export tryaitools-preview --remote --output backup-preview.sql`
* Point-in-time recovery: D1 Time Travel (retention is 7 days on the Free plan and 30 days on Workers Paid,
  per Cloudflare's D1 limits page).
* Roll back the schema: run `db/rollback/0001_core.down.sql` against the **preview** DB only
  (`npx wrangler d1 execute tryaitools-preview --remote --file db/rollback/0001_core.down.sql`).

## D1 limits that matter here (Cloudflare docs)
100 bound parameters per query; 100 KB per SQL statement (the largest generated statement is ~1.4 KB);
Free plan: 10 databases, 500 MB per database, 100,000 rows written per day, 5 million rows read per day.

## Local vs preview differences
* `verify-local` uses SQLite, which D1 is based on, but it is not Cloudflare. Real D1 behaviour is only
  proven by steps 4–5 and the runtime check.
* `wrangler dev` uses a local D1 copy unless `--remote` is passed. The runtime check reads the real preview DB.

## If the generated config does NOT contain the binding
`check-generated-config` will say so. The fallback is declaring the binding through Nitro's
`cloudflare.wrangler` option (its documentation describes it merging with the nearest Wrangler config);
that is a code change I will make and you will re-test. Nothing is deployed in the meantime.

## R2 (media) — deferred
Not set up in Stage 2. Before Stage 9 I will ask you to confirm R2 pricing and account requirements in
your Cloudflare dashboard (I could not retrieve R2's pricing page from here, so I am not quoting figures).
