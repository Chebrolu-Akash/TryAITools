// Pure functions (no file or network access) for the preview-database layout. Imported by the CLI scripts and by
// src/test/db-config.test.ts.
//
// Layout, from Cloudflare's "Worker Previews > Resources and isolation" documentation:
//   wrangler.jsonc                    top level = PRODUCTION  -> d1_databases: only DB -> tryaitools-production
//                                     previews.d1_databases   -> binding DB -> the PREVIEW database
//   wrangler.preview-migrations.jsonc top level d1_databases  -> binding PREVIEW_DB -> the SAME preview database;
//                                     used ONLY by `wrangler d1 migrations/execute` commands, never deployed
//   wrangler.production-migrations.jsonc  binding PRODUCTION_DB -> the production database; same rules, never deployed
// Previews do not inherit production settings, so a binding left at the top level is a production binding: it must be
// exactly the production database, and never the preview one.
import { PREVIEW_NAME, UUID } from "./guard.mjs";

export const MIGRATIONS_CONFIG_FILE = "wrangler.preview-migrations.jsonc";
export const PRODUCTION_MIGRATIONS_CONFIG_FILE = "wrangler.production-migrations.jsonc";
export const PRODUCTION_DB_NAME = "tryaitools-production";
const sameD1 = (a = [], b = []) =>
  JSON.stringify(a.map((d) => [d.binding, d.database_name, d.database_id])) ===
  JSON.stringify(b.map((d) => [d.binding, d.database_name, d.database_id]));

/** Removes // and /* *\/ comments without touching comment-like text inside strings. */
export function stripJsonc(text) {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
}
export const parseJsonc = (text) => JSON.parse(stripJsonc(text));
export const hasComments = (text) => /\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""'));

const isPreviewDb = (d) =>
  d && PREVIEW_NAME.test(String(d.database_name ?? "")) && !/prod/i.test(String(d.database_name));

/**
 * Returns the new wrangler.jsonc and migrations config for the given preview database.
 * - Any top-level D1 entry that is a preview database is MOVED under `previews` (it never belongs at top level).
 * - Any other top-level D1 entry is left alone and reported: we never touch something that might be production.
 */
export function planPreviewBinding(cfg, { databaseName, databaseId }) {
  if (!PREVIEW_NAME.test(databaseName) || /prod/i.test(databaseName))
    throw new Error(`"${databaseName}" is not a preview database name`);
  if (!UUID.test(databaseId)) throw new Error("database_id must be a UUID");
  if (cfg.name !== "pixel-perfect")
    throw new Error(
      `wrangler.jsonc name is "${cfg.name}", expected "pixel-perfect"; not touching it`,
    );
  const notes = [];
  const next = structuredClone(cfg);
  const top = Array.isArray(next.d1_databases) ? next.d1_databases : [];
  const kept = [];
  for (const d of top) {
    if (isPreviewDb(d))
      notes.push(`moved top-level D1 binding "${d.binding}" (${d.database_name}) under previews`);
    else {
      kept.push(d);
      notes.push(
        `WARNING: top-level D1 binding "${d.binding}" (${d.database_name}) is not a preview database; left unchanged. Review it by hand.`,
      );
    }
  }
  if (kept.length) next.d1_databases = kept;
  else delete next.d1_databases;
  next.previews = {
    ...(next.previews ?? {}),
    d1_databases: [{ binding: "DB", database_name: databaseName, database_id: databaseId }],
  };
  const migrations = {
    d1_databases: [
      {
        binding: "PREVIEW_DB",
        database_name: databaseName,
        database_id: databaseId,
        migrations_dir: "migrations",
      },
    ],
  };
  return { config: next, migrations, notes };
}

const row = (name, ok, detail = "") => ({ name, ok: !!ok, detail });

/**
 * Checks the committed config files for production isolation. Without `production` (the parsed
 * wrangler.production-migrations.jsonc) production must have no D1 at all; with it, the top level binds exactly
 * DB -> that production database, which is never the preview database.
 */
export function validateRepoConfig(cfg, migrations, production) {
  const out = [];
  const top = cfg.d1_databases;
  const pv = cfg.previews?.d1_databases?.find((d) => d.binding === "DB");
  const prod = production?.d1_databases?.find((d) => d.binding === "PRODUCTION_DB");
  if (!prod)
    out.push(
      row(
        "wrangler.jsonc (production) has NO top-level d1_databases",
        !top || top.length === 0,
        top?.length ? JSON.stringify(top.map((d) => d.database_name)) : "",
      ),
    );
  else {
    out.push(
      row(
        `${PRODUCTION_MIGRATIONS_CONFIG_FILE} declares PRODUCTION_DB = ${PRODUCTION_DB_NAME} (UUID, not the preview database, not deployable)`,
        prod.database_name === PRODUCTION_DB_NAME &&
          !PREVIEW_NAME.test(prod.database_name) &&
          UUID.test(prod.database_id ?? "") &&
          prod.database_id !== pv?.database_id &&
          production.d1_databases.length === 1 &&
          !production.name &&
          !production.main,
        prod.database_name,
      ),
    );
    out.push(
      row(
        "wrangler.jsonc (production) top level binds only DB -> the production database",
        sameD1(top, [{ ...prod, binding: "DB" }]),
        top?.length ? JSON.stringify(top.map((d) => `${d.binding}=${d.database_name}`)) : "none",
      ),
    );
  }
  out.push(row("previews.d1_databases binds DB", !!pv));
  out.push(
    row(
      "preview binding is a preview database (name ends in -preview, UUID id)",
      !!pv && isPreviewDb(pv) && UUID.test(pv.database_id),
      pv?.database_name,
    ),
  );
  const m = migrations?.d1_databases?.find((d) => d.binding === "PREVIEW_DB");
  out.push(row(`${MIGRATIONS_CONFIG_FILE} declares PREVIEW_DB`, !!m));
  out.push(
    row(
      "migrations config points at the SAME database as previews",
      !!m && !!pv && m.database_id === pv.database_id && m.database_name === pv.database_name,
    ),
  );
  out.push(
    row(
      "migrations config is not deployable (no name/main)",
      !!migrations && !migrations.name && !migrations.main,
    ),
  );
  out.push(row("no custom domain or routes in wrangler.jsonc", !cfg.routes && !cfg.route));
  out.push(...mediaRows(cfg, "wrangler.jsonc"));
  return out;
}

const isPreviewBucket = (b) =>
  /^[a-z0-9-]+-preview$/.test(String(b?.bucket_name ?? "")) && !/prod/i.test(String(b.bucket_name));
/**
 * Image storage (R2) is optional: without a MEDIA binding the admin refuses uploads ("not configured") and everything
 * else works. When present it is only ever a preview bucket, only under previews; production has no bucket.
 */
function mediaRows(cfg, label) {
  const top = cfg.r2_buckets;
  const all = cfg.previews?.r2_buckets ?? [];
  const media = all.filter((b) => b.binding === "MEDIA");
  return [
    row(
      `${label} (production) has NO top-level r2_buckets`,
      !top || top.length === 0,
      top?.length ? JSON.stringify(top.map((b) => b.bucket_name)) : "",
    ),
    row(
      `${label} previews.r2_buckets: none (image uploads off), or MEDIA bound to one preview bucket`,
      media.length <= 1 && all.every(isPreviewBucket),
      all.length ? all.map((b) => b.bucket_name).join(", ") : "not configured: image uploads off",
    ),
  ];
}

/** Checks the Nitro-generated Worker config (the file Wrangler actually deploys/previews). */
export function validateGeneratedConfig(gen, repoCfg) {
  const out = [];
  const expected = repoCfg.previews?.d1_databases?.find((d) => d.binding === "DB");
  const pv = gen.previews?.d1_databases?.filter((d) => d.binding === "DB") ?? [];
  out.push(
    row(
      "generated config carries previews.d1_databases (Nitro kept the previews block)",
      pv.length === 1,
      pv.length === 1
        ? ""
        : "NOT FOUND: Nitro did not copy previews into the generated config; see docs/preview-d1-isolation.md fallback",
    ),
  );
  out.push(
    row(
      "generated previews binding equals the one in wrangler.jsonc",
      !!expected && pv[0]?.database_id === expected.database_id,
    ),
  );
  out.push(
    row(
      "generated production (top-level) d1_databases equal wrangler.jsonc's (none, or only DB -> production)",
      sameD1(gen.d1_databases, repoCfg.d1_databases) &&
        !(gen.d1_databases ?? []).some((d) => d.database_id === expected?.database_id),
      gen.d1_databases ? JSON.stringify(gen.d1_databases.map((d) => d.database_name)) : "none",
    ),
  );
  out.push(row("Worker name is still pixel-perfect", gen.name === "pixel-perfect", gen.name));
  out.push(row("no custom domain or routes in generated config", !gen.routes && !gen.route));
  out.push(...mediaRows(gen, "generated config"));
  const want = repoCfg.previews?.r2_buckets?.find((b) => b.binding === "MEDIA")?.bucket_name;
  out.push(
    row(
      "generated MEDIA bucket equals the one in wrangler.jsonc (or both have none)",
      gen.previews?.r2_buckets?.find((b) => b.binding === "MEDIA")?.bucket_name === want,
    ),
  );
  // Static build (scripts/static/build-gate.mjs): the gate is the entry and runs first for pages, never for /assets.
  if (gen.main === "gate.mjs") {
    const rwf = gen.assets?.run_worker_first;
    out.push(
      row(
        "static build: gate runs first for page routes but not for /assets/*",
        Array.isArray(rwf) &&
          rwf.includes("/*") &&
          rwf.includes("!/assets/*") &&
          // uploaded images (/media/<id>.<ext>) are answered by the gate: no wildcard file-type exclusion may hide them
          !rwf.some((r) => /^!\/\*/.test(r)),
        JSON.stringify(rwf ?? null),
      ),
    );
  }
  return out;
}

/** Reads the target from wrangler.preview-migrations.jsonc and refuses anything that is not the preview DB. */
export function resolveTarget(migrations) {
  const d = migrations?.d1_databases?.find((x) => x.binding === "PREVIEW_DB");
  if (!d) throw new Error(`${MIGRATIONS_CONFIG_FILE} has no PREVIEW_DB binding`);
  if (!isPreviewDb(d) || !UUID.test(d.database_id))
    throw new Error(`"${d.database_name}" is not a preview database`);
  return d;
}

/** Wrangler argument lists (run as `bunx wrangler ...args`). Always --remote, always the migrations config. */
export function wranglerArgs(kind, target, extra = {}) {
  const cfg = ["--config", MIGRATIONS_CONFIG_FILE, "--remote"];
  const base = ["d1"];
  switch (kind) {
    case "migrate":
      return [...base, "migrations", "apply", "PREVIEW_DB", ...cfg];
    case "list":
      return [...base, "migrations", "list", "PREVIEW_DB", ...cfg];
    case "file":
      return [...base, "execute", "PREVIEW_DB", ...cfg, "--yes", "--file", extra.file];
    case "query":
      return [...base, "execute", "PREVIEW_DB", ...cfg, "--json", "--command", extra.sql];
    case "export":
      return [...base, "export", "PREVIEW_DB", ...cfg, "--output", extra.file];
    default:
      throw new Error(`unknown command ${kind}`);
  }
}

/** Rollback allowed only for the newest applied migration whose down-script exists. */
export function pickRollback(appliedNames, downFiles) {
  const newest = [...appliedNames].sort().at(-1);
  if (!newest) throw new Error("no applied migrations to roll back");
  const down = newest.replace(/\.sql$/, ".down.sql");
  if (!downFiles.includes(down)) throw new Error(`no rollback script ${down}`);
  return { migration: newest, down };
}
