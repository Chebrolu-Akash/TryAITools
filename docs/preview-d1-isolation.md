# Preview D1 isolation (how the preview database stays away from production)

Source: Cloudflare documentation, "Worker Previews" — *Resources and isolation*
(https://developers.cloudflare.com/workers/previews/resources/) and *Configuration*
(https://developers.cloudflare.com/workers/previews/configuration/), read while preparing this stage.
Previews require Wrangler 4.135.0 or newer. I could not run Wrangler or Cloudflare from my environment, so the
documented behaviour below is **documented, not tested by me**; the steps at the end let you prove it yourself.

## What the documentation says (as I read it)
* A preview does **not** inherit production settings. A binding that is not declared for previews is absent in the preview.
* Preview resources are declared under the `previews` key of the Wrangler config (for D1: `previews.d1_databases`),
  using the same binding name as production, but pointing at a different database.
* Secrets cannot live in the config file. Preview secrets are set with
  `bunx wrangler preview base-config secret put NAME` (inherited by new previews) or
  `bunx wrangler preview secret put NAME --name <preview>` (one existing preview). They are separate from the
  production Worker's secrets.

## What the earlier Stage 2 scripts did wrong (review finding C2)
They wrote the preview database to the **top-level** `d1_databases`. Top level is the production configuration, so a
deploy from that file would have bound the preview database to the production Worker. This stage fixes it:

| File | Where the preview database is declared | Used by |
|---|---|---|
| `wrangler.jsonc` | `previews.d1_databases` only; **no top-level `d1_databases`** | preview builds/versions |
| `wrangler.preview-migrations.jsonc` | top-level `d1_databases`, binding `PREVIEW_DB` (no `name`, no `main`, never deployed) | only `wrangler d1 migrations/execute/export` commands, via `scripts/db/preview-d1.mjs` |

Why a second file: `wrangler d1 migrations apply` needs the database in the top level of the config it is given. Keeping
that in a separate, non-deployable file means the real `wrangler.jsonc` never carries it at the top level.

## Safeguards in the scripts
* `set-preview-binding.mjs` is a **dry run** unless `--write`; it refuses names that do not end in `-preview`, names
  containing `prod`, non-UUID ids, and a Worker name other than `pixel-perfect`. It moves a legacy top-level *preview*
  binding under `previews`, and leaves any other top-level D1 entry untouched with a WARNING.
* `preview-d1.mjs` reads its target only from `wrangler.preview-migrations.jsonc`, always uses `--remote` with that file, and
  refuses a non-preview database. `rollback` needs `--confirm <database name>` and undoes only the newest migration.
* `check-generated-config.mjs` checks the committed files **and** the Nitro-generated `.output/server/wrangler.json`.

## Unverified: does Nitro carry `previews` into the generated config?
Nitro generates its own Worker config at build time. I could not run the build. `bun run db:check-config` reports
FAIL on "generated config carries previews.d1_databases" if it does not. In that case do **not** work around it by
moving the binding to the top level; stop and send me the output (the fallback is Nitro's `cloudflare.wrangler` option).

## How you prove isolation yourself (after integration, on the feature branch only)
1. `bun run db:check-config` after `bun run build` -> all PASS (especially "generated production config has NO d1_databases").
2. On the preview URL `/api/db-check` -> `"bound":true`. On `https://tryaitools.io/api/db-check` -> 404 (the endpoint is hidden there)
   and the production Worker's Bindings tab in the Cloudflare dashboard lists **no** D1 database.
3. Production Worker "Variables and secrets" does not list `ACCESS_*` / `OWNER_EMAILS`.
