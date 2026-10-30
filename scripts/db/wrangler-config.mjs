// Pure functions (no file or network access) for the preview-database layout. Imported by the CLI scripts and by
// src/test/db-config.test.ts.
//
// Layout, from Cloudflare's "Worker Previews > Resources and isolation" documentation:
//   wrangler.jsonc                    top level = PRODUCTION  -> NO d1_databases (no production database exists yet)
//                                     previews.d1_databases   -> binding DB -> the PREVIEW database
//   wrangler.preview-migrations.jsonc top level d1_databases  -> binding PREVIEW_DB -> the SAME preview database;
//                                     used ONLY by `wrangler d1 migrations/execute` commands, never deployed
// Previews do not inherit production settings, so a binding left at the top level is a production binding.
import { PREVIEW_NAME, UUID } from "./guard.mjs";

export const MIGRATIONS_CONFIG_FILE = "wrangler.preview-migrations.jsonc";

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

/** Checks the two committed config files for production isolation. */
export function validateRepoConfig(cfg, migrations) {
  const out = [];
  const top = cfg.d1_databases;
  out.push(
    row(
      "wrangler.jsonc (production) has NO top-level d1_databases",
      !top || top.length === 0,
      top?.length ? JSON.stringify(top.map((d) => d.database_name)) : "",
    ),
  );
  const pv = cfg.previews?.d1_databases?.find((d) => d.binding === "DB");
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
  return out;
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
      "generated production (top-level) config has NO d1_databases",
      !gen.d1_databases || gen.d1_databases.length === 0,
      gen.d1_databases ? JSON.stringify(gen.d1_databases.map((d) => d.database_name)) : "",
    ),
  );
  out.push(row("Worker name is still pixel-perfect", gen.name === "pixel-perfect", gen.name));
  out.push(row("no custom domain or routes in generated config", !gen.routes && !gen.route));
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
