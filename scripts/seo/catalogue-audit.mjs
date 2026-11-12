#!/usr/bin/env bun
// Read-only catalogue audit: one row per tool with its URL health, identity check, duplicate/variant class, content
// completeness, SEO fields, review/indexing state, sitemap eligibility and a recommended outcome (A-F).
//   bun scripts/seo/catalogue-audit.mjs --snapshot <export.sql> --urls <urlcheck.json> --history <pre-cleanup.sql> --out <dir>
// Writes <dir>/catalogue-audit.csv and <dir>/catalogue-audit-summary.json. Nothing is written to any database.
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const [snapshot, urlFile, historyFile, out] = ["--snapshot", "--urls", "--history", "--out"].map(
  arg,
);
if (!snapshot || !urlFile || !out) {
  console.error(
    "Usage: --snapshot <export.sql> --urls <urlcheck.json> [--history <pre-cleanup.sql>] --out <dir>",
  );
  process.exit(2);
}
const load = (f) => {
  const d = new Database(":memory:");
  d.exec(readFileSync(f, "utf8"));
  return d;
};
const db = load(snapshot);
const urls = JSON.parse(readFileSync(urlFile, "utf8"));
const original = new Map();
if (historyFile)
  for (const r of load(historyFile).query("SELECT id, url FROM tools").all())
    original.set(r.id, r.url);

const tools = db
  .query(
    `SELECT t.*, c.slug AS category, c.status AS category_status,
            (SELECT group_concat(m.category_id || COALESCE(' / ' || m.subcategory, ''), '; ') FROM tool_categories m WHERE m.tool_id = t.id) AS memberships,
            (SELECT t2.slug FROM tool_redirects r JOIN tools t2 ON t2.id = r.tool_id WHERE r.old_slug = t.slug) AS redirect_to
       FROM tools t JOIN categories c ON c.id = t.category_id ORDER BY t.sort_order, t.id`,
  )
  .all();
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const base = (n) =>
  n
    .replace(/\s*\(.+\)\s*$/, "")
    .trim()
    .toLowerCase();
const list = (v) => {
  try {
    const x = JSON.parse(v ?? "[]");
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};
const words = (s) => (s && String(s).trim() ? String(s).trim().split(/\s+/).length : 0);
const tokens = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(ai|the|app|io|by|for|and|tool|tools|hq|labs?)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
/** Identity: the product name (or the domain label) appears in the official homepage title. */
function identity(t, r) {
  // a grounded review draft confirms identity from the official pages themselves
  try {
    if (JSON.parse(t.review_draft ?? "null")?.quality?.identity?.matches === true)
      return "verified (grounded draft)";
  } catch {
    // no draft
  }
  if (!r || r.status !== 200) return "not checkable";
  const title = String(r.title ?? "").toLowerCase();
  if (!title) return "unverified (no page title)";
  const nameTokens = tokens(t.name);
  const label = host(r.final ?? t.url).split(".")[0] ?? "";
  if (
    nameTokens.some((w) => title.includes(w)) ||
    (label.length >= 3 && title.replace(/[^a-z0-9]/g, "").includes(label))
  )
    return "verified (homepage title matches)";
  return "unverified (title does not name the product)";
}
// published products per original host, for feature-variant detection
const byHost = new Map();
for (const t of tools.filter((x) => x.status === "published")) {
  const h = host(original.get(t.id) ?? t.url);
  if (!h) continue;
  byHost.set(h, [...(byHost.get(h) ?? []), t]);
}
const DISCONTINUED = new Set(["google-optimize", "google-optimize-ga4-experiments"]);
const PRODUCT_DECISION = new Set(["deepcode", "deepcode-snyk-code"]);

const rows = [];
const tally = (m, k) => (m[k] = (m[k] ?? 0) + 1);
const classCount = {};
const outcomeCount = {};
const notIndexedBreakdown = {};
for (const t of tools) {
  const origUrl = original.get(t.id) ?? t.url;
  const r = urls[t.url] ?? urls[origUrl];
  const finalHost = r?.final ? host(r.final) : "";
  const rebranded = original.has(t.id) && original.get(t.id) !== t.url;
  const sameHost = (byHost.get(host(origUrl)) ?? []).filter((x) => x.id !== t.id);
  // a variant extends another product's name on the same site ("Tidio Lyro" -> "Tidio"); the base product stays unique
  const mine = new Set(tokens(t.name));
  const extendsOther = (x) => {
    const theirs = tokens(x.name);
    return theirs.length > 0 && theirs.length < mine.size && theirs.every((w) => mine.has(w));
  };
  const variant = t.status === "published" && sameHost.some(extendsOther);
  // different, unrelated names on one site (e.g. a rebrand left as two listings): a person must check they are distinct
  const sameSiteOther =
    t.status === "published" &&
    !variant &&
    sameHost.some(
      (x) =>
        base(x.name) !== base(t.name) &&
        !extendsOther(x) &&
        !tokens(x.name).every((w) => mine.has(w)) &&
        !tokens(t.name).every((w) => new Set(tokens(x.name)).has(w)),
    );
  const id = identity(t, r);
  const features = list(t.features).length;
  const pros = list(t.pros).length;
  const limits = list(t.limits).length;
  const overviewWords = words(t.overview);
  const contentReviewed = t.review_status === "reviewed";
  const indexed = t.indexing === "index";
  const sitemapEligible =
    t.status === "published" && !t.needs_review && t.category_status === "published" && indexed;

  // classification (first matching rule wins; the order is the priority)
  let cls;
  if (t.status === "archived" && t.redirect_to) cls = "3 duplicate copy (archived, 301 to primary)";
  else if (DISCONTINUED.has(t.slug)) cls = "5 discontinued product";
  else if (t.status === "draft")
    cls = t.import_issue
      ? `8 unverified identity (import issue: ${t.import_issue})`
      : "8 unverified identity (draft)";
  else if (contentReviewed && indexed) cls = "10 ready for indexing (indexed)";
  else if (t.url_status === "dead" || t.url_status === "error")
    cls = "6 broken or unavailable website";
  else if (t.url_status === "redirect") cls = "7 redirected website (other domain)";
  else if (rebranded) cls = "4 rebranded product (URL updated)";
  else if (PRODUCT_DECISION.has(t.slug)) cls = "8 unverified identity (product decision)";
  else if (t.url_status === "blocked") cls = "8 unverified identity (site blocks automated checks)";
  else if (variant) cls = "2 feature variant of another product";
  else if (sameSiteOther && !id.startsWith("verified (grounded"))
    cls = "2 feature variant (same site, verify distinct product)";
  else if (id.startsWith("verified"))
    cls = contentReviewed ? "10 ready for indexing (reviewed)" : "1 verified unique product";
  else cls = "8 unverified identity (homepage title)";
  tally(classCount, cls.replace(/ \(.*\)$/, ""));

  // outcome A-F
  let outcome;
  if (indexed && contentReviewed) outcome = "A ready to index (already indexed)";
  else if (t.status === "archived") outcome = "D duplicate (consolidated: archived + 301)";
  else if (cls.startsWith("5") || (cls.startsWith("6") && t.url_status === "dead"))
    outcome = "E discontinued or unavailable";
  else if (t.status === "draft") outcome = "F excluded (draft / import issue)";
  else if (t.review_status === "draft_ready" && !cls.startsWith("6") && !cls.startsWith("7"))
    outcome = "B needs editor approval of its grounded draft";
  else if (cls.startsWith("6") || cls.startsWith("7") || cls.startsWith("8"))
    outcome = "C needs manual product or URL verification";
  else if (cls.startsWith("2"))
    outcome = "B needs content (feature variant: own page and content required)";
  else outcome = "B needs content improvement before indexing";
  tally(outcomeCount, outcome.replace(/ \(.*\)$/, ""));
  if (!indexed)
    tally(
      notIndexedBreakdown,
      `${t.status}${t.status === "published" ? ` / ${t.review_status}` : ""}`,
    );

  rows.push({
    slug: t.slug,
    name: t.name,
    official_url: t.url ?? "",
    original_url: rebranded ? origUrl : "",
    http_status: r ? String(r.status === "ERR" ? `ERR ${r.error}` : r.status) : "not checked",
    redirect_to: r?.final && finalHost && finalHost !== host(t.url) ? r.final : "",
    url_status: t.url_status ?? "",
    identity: id,
    classification: cls,
    status: t.status,
    category: t.category,
    subcategory: t.subcategory ?? "",
    memberships: t.memberships ?? "",
    redirects_to_slug: t.redirect_to ?? "",
    overview_words: overviewWords,
    features,
    pros,
    limits,
    pricing_model: t.pricing_model ?? "unknown",
    pricing_checked: t.pricing_checked_at ?? "",
    seo_title: t.seo_title ?? "",
    seo_description: t.seo_description ?? "",
    canonical:
      t.status === "published"
        ? `https://tryaitools.io/tools/${t.slug}`
        : t.redirect_to
          ? `301 -> /tools/${t.redirect_to}`
          : "none (not public)",
    review_status: t.review_status,
    indexing: t.indexing,
    sitemap_eligible: sitemapEligible ? "yes" : "no",
    recommended: outcome,
  });
}
mkdirSync(out, { recursive: true });
const cols = Object.keys(rows[0]);
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
writeFileSync(
  join(out, "catalogue-audit.csv"),
  [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n",
);
const summary = {
  snapshot,
  totalTools: rows.length,
  byStatus: rows.reduce((m, r) => (tally(m, r.status), m), {}),
  indexed: rows.filter((r) => r.indexing === "index").length,
  notIndexed: rows.filter((r) => r.indexing !== "index").length,
  notIndexedBreakdown,
  sitemapEligibleTools: rows.filter((r) => r.sitemap_eligible === "yes").length,
  memberships: db.query("SELECT count(*) n FROM tool_categories").get().n,
  redirects: db.query("SELECT count(*) n FROM tool_redirects").get().n,
  officialUrlVerified: rows.filter(
    (r) => r.status === "published" && r.url_status === "ok" && r.identity.startsWith("verified"),
  ).length,
  classifications: classCount,
  outcomes: outcomeCount,
  withContent: rows.filter((r) => r.overview_words > 0).length,
  withSeoTitle: rows.filter((r) => r.seo_title).length,
};
writeFileSync(join(out, "catalogue-audit-summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
