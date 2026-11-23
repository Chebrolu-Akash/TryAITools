#!/usr/bin/env bun
// Batch report for the review workflow (read-only). For each tool of a batch it reports, from a database export:
//   approved        an editor approved its draft (tool_review_history)
//   draft_ready     a grounded draft is waiting for an editor
//   needs_manual    the draft (or the tool) needs manual research, with the reasons
//   failed          drafting failed (fetch, robots.txt, identity, model); the tool is unchanged
//   not attempted   no draft was generated since --since
// plus the indexing gate (G1–G10) for every tool, exactly as the admin evaluates it. Writes nothing to any database.
//
//   bun scripts/tools/batch-report.mjs --snapshot <export.sql> (--slugs a,b,c | --batch 1) [--since <iso>] --out <dir>
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadGateContexts } from "../../src/lib/admin/gate-context.ts";
import { gateFailures } from "../../src/lib/admin/index-gate.ts";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = arg("--out");
const since = arg("--since") ?? "1970-01-01T00:00:00.000Z";
let slugs = (arg("--slugs") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const batch = arg("--batch");
if (batch) {
  const rows = readFileSync("docs/drafts/audit/index-readiness-2026-11-12/batch-plan.csv", "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1);
  slugs = rows
    .map((l) => l.split(","))
    .filter((c) => c[0] === String(batch))
    .map((c) => c[2]);
}
if (!snapshot || !out || !slugs.length) {
  console.error(
    "Usage: bun scripts/tools/batch-report.mjs --snapshot <export.sql> (--slugs a,b | --batch N) [--since iso] --out <dir>",
  );
  process.exit(2);
}

const raw = new Database(":memory:");
raw.exec(readFileSync(snapshot, "utf8").replace(/^PRAGMA.*$/gm, ""));
// an export from before migration 0011 has no approval history yet (in this in-memory copy only)
if (!raw.query("SELECT 1 FROM sqlite_master WHERE name = 'tool_review_history'").get())
  raw.exec(readFileSync("migrations/0011_review_history.sql", "utf8"));
// a read-only AdminDb over the export (the same queries the admin runs)
const stmt = (sql, params = []) => ({
  bind: (...p) => stmt(sql, p),
  all: async () => ({ results: raw.query(sql).all(...params) }),
  first: async () => raw.query(sql).get(...params) ?? null,
});
const db = { prepare: (sql) => stmt(sql) };
const now = new Date().toISOString();

const tools = raw
  .query(
    `SELECT t.*, c.status AS category_status FROM tools t JOIN categories c ON c.id = t.category_id
      WHERE t.slug IN (SELECT value FROM json_each(?))`,
  )
  .all(JSON.stringify(slugs));
const bySlug = new Map(tools.map((t) => [t.slug, t]));
const gates = await loadGateContexts(db, tools, now);
const lastDraftEvent = (slug) =>
  raw
    .query(
      "SELECT at, summary FROM audit_events WHERE entity_id = ? AND action = 'tool.review_draft' AND at >= ? ORDER BY at DESC LIMIT 1",
    )
    .get(slug, since);
const approval = (id) =>
  raw
    .query(
      "SELECT at, actor_email FROM tool_review_history WHERE tool_id = ? AND action = 'approve' AND reverted_at IS NULL AND at >= ? ORDER BY id DESC LIMIT 1",
    )
    .get(id, since);

const rows = [];
for (const slug of slugs) {
  const t = bySlug.get(slug);
  if (!t) {
    rows.push({ slug, result: "missing", reasons: "tool not found", gate: "", gate_failures: "" });
    continue;
  }
  const draft = t.review_draft ? JSON.parse(t.review_draft) : null;
  const ev = lastDraftEvent(slug);
  const ap = approval(t.id);
  let result;
  let reasons = "";
  if (ap) result = "approved";
  else if (draft) {
    result = draft.quality.status;
    reasons = draft.quality.reasons.join("; ");
  } else if (ev && /failed/.test(ev.summary)) {
    result = "failed";
    reasons = (t.review_notes ?? ev.summary).replace(/^automated review failed: /, "");
  } else if (ev) {
    result = t.review_status === "needs_manual" ? "needs_manual" : "rejected";
    reasons = t.review_notes ?? "";
  } else result = "not attempted";
  const f = gateFailures(t, gates.get(slug));
  rows.push({
    slug,
    name: t.name,
    category: t.category_id,
    result,
    reasons,
    features: draft ? draft.features.length : JSON.parse(t.features ?? "[]").length,
    use_cases: draft ? (draft.best_for ?? []).length : "",
    pricing: draft
      ? (draft.pricing.model ?? (t.pricing_model ? `kept ${t.pricing_model}` : "unknown"))
      : (t.pricing_model ?? "unknown"),
    review_status: t.review_status,
    indexing: t.indexing,
    gate: f.length ? "fails" : "passes",
    gate_failures: [...new Set(f.map((x) => x.id))].join(" "),
    gate_detail: f.map((x) => x.reason).join("; "),
  });
}

mkdirSync(out, { recursive: true });
const cols = [
  "slug",
  "name",
  "category",
  "result",
  "reasons",
  "features",
  "use_cases",
  "pricing",
  "review_status",
  "indexing",
  "gate",
  "gate_failures",
  "gate_detail",
];
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
writeFileSync(
  join(out, "batch-report.csv"),
  [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n",
);
const count = (k) => rows.filter((r) => r.result === k).length;
const md = [
  `# Batch report${batch ? ` — batch ${batch}` : ""}`,
  "",
  `Generated ${now} from \`${snapshot}\`. Read-only.`,
  "",
  "| Result | Tools |",
  "|---|---|",
  ...[
    "approved",
    "draft_ready",
    "needs_manual",
    "failed",
    "rejected",
    "not attempted",
    "missing",
  ].map((k) => `| ${k} | ${count(k)} |`),
  `| **indexable now (passes G1–G10)** | ${rows.filter((r) => r.gate === "passes").length} |`,
  "",
  "| Tool | Result | Reasons / manual research needed | Features | Use cases | Pricing | Indexing | Gate |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.slug} | ${r.result} | ${(r.reasons || "—").replace(/\|/g, "/")} | ${r.features ?? ""} | ${r.use_cases ?? ""} | ${r.pricing ?? ""} | ${r.indexing ?? ""} | ${r.gate === "passes" ? "passes" : `fails ${r.gate_failures}`} |`,
  ),
  "",
].join("\n");
writeFileSync(join(out, "batch-report.md"), md);
console.log(md);
