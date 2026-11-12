#!/usr/bin/env bun
// Writes db/metadata/content-imports.json: the record of scripted content imports that changed what tool pages show but
// left no per-tool audit row (the 2026-11-01 metadata imports: tags and pricing badges). The sitemap uses it for lastmod
// (src/static/sitemap.ts, `ContentImport`), so a page's lastmod is the import's own timestamp, never a refreshed date.
//
// The slugs come from the import SQL itself. Both files are guarded (a field is written only where none was recorded), so:
//   import 1: tags for every tool listed (all were empty), pricing for the tools it lists
//   import 2: re-runs import 1's statements (no-ops) and adds pricing for the tools import 1 did not price
// --verify <export.sql> checks the result against a database that ran both imports with nothing written since
// (production): every tool's updated_at must be the timestamp of the last import that changed it.
//   bun scripts/db/content-imports.mjs [--verify <export.sql>]
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["db/metadata/metadata-import-1.sql", "db/metadata/metadata-import-2.sql"];
const OUT = "db/metadata/content-imports.json";
const parse = (file) => {
  const sql = readFileSync(file, "utf8");
  const at = /generated (\S+Z) by/.exec(sql)?.[1];
  if (!at) throw new Error(`${file}: no generated timestamp`);
  const fields = new Map(); // field -> Set(slug)
  for (const m of sql.matchAll(/^UPDATE tools SET (\w+) = .* WHERE slug = '((?:[^']|'')+)'/gm)) {
    if (!fields.has(m[1])) fields.set(m[1], new Set());
    fields.get(m[1]).add(m[2].replace(/''/g, "'"));
  }
  return { file, at, fields };
};
const [one, two] = FILES.map(parse);
const already = (f) => one.fields.get(f) ?? new Set();
const imports = [
  {
    at: one.at,
    source: one.file,
    changed: "tags and pricing badge",
    slugs: [...new Set([...one.fields.values()].flatMap((s) => [...s]))].sort(),
  },
  {
    at: two.at,
    source: two.file,
    changed: "pricing badge",
    // only statements import 1 had not already applied (the rest match nothing)
    slugs: [...(two.fields.get("pricing_model") ?? [])]
      .filter((s) => !already("pricing_model").has(s))
      .sort(),
  },
];

const v = process.argv.indexOf("--verify");
if (v > 0) {
  const { Database } = await import("bun:sqlite");
  const db = new Database(":memory:");
  db.exec(readFileSync(process.argv[v + 1], "utf8"));
  const last = new Map();
  for (const i of imports) for (const s of i.slugs) last.set(s, i.at);
  const rows = db.query("SELECT slug, updated_at FROM tools").all();
  const wrong = rows.filter((r) => last.get(r.slug) !== r.updated_at);
  console.log(
    JSON.stringify({
      tools: rows.length,
      matching: rows.length - wrong.length,
      wrong: wrong.slice(0, 10),
    }),
  );
  if (wrong.length) process.exit(1);
}
writeFileSync(OUT, JSON.stringify(imports, null, 1) + "\n");
console.log(
  imports.map((i) => `${i.at} ${i.source}: ${i.slugs.length} tools (${i.changed})`).join("\n"),
);
