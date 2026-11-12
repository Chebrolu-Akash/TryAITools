#!/usr/bin/env node
// Merges the pricing research (scripts/metadata/research.mjs) with the existing verified data, derives functional tags,
// and writes the review report plus a guarded, idempotent import and its rollback.
//   node scripts/metadata/build.mjs --snapshot <export.sql>
// Precedence for pricing, highest first (a lower source never overwrites a higher one):
//   1. pricing already recorded in the database (owner-verified)  2. manual research (db/pricing/batch-01-research.json,
//   status verified)  3. automated research, status verified.  Anything else stays empty (Unknown / Pending Review).
// Tags come from the fixed vocabulary in src/lib/tags.ts: the tool's catalogued subcategory gives its core tags, and an
// extra tag is added only when the tool's own description or its official homepage description names that function.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const SNAPSHOT = args[args.indexOf("--snapshot") + 1];
const OUT = "db/metadata";
const NOW = new Date().toISOString();
const ACTOR = "metadata-import@local";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(SNAPSHOT, "utf8"));
const tools = db
  .prepare("SELECT slug, name, url, subcategory, category_id, tags, tagline, overview, features, best_for, pricing_model, pricing_source, pricing_checked_at, status FROM tools ORDER BY sort_order, slug")
  .all();
const norm = (u) => String(u || "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

// research per URL
const research = new Map();
for (const f of readdirSync(`${OUT}/batches`)) for (const r of JSON.parse(readFileSync(`${OUT}/batches/${f}`, "utf8"))) research.set(r.slug, r);
const manual = new Map(JSON.parse(readFileSync("db/pricing/batch-01-research.json", "utf8")).filter((r) => r.status === "verified" && r.model).map((r) => [norm(r.url), r]));

// ---------- tags ----------
const VOCAB = (readFileSync("src/lib/tags.ts", "utf8").match(/TOOL_TAGS = \[([\s\S]*?)\] as const/)[1].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
const SUB_RULES = [
  [/writing assistant|grammar|paraphras|copywriting|story|script writing|blog writing|academic writing/i, ["AI Writing"]],
  [/seo writing/i, ["AI Writing", "SEO"]],
  [/email writing/i, ["AI Writing", "Email"]],
  [/social media writing/i, ["AI Writing", "Social Media"]],
  [/academic writing/i, ["Education"]],
  [/image generation|art generation/i, ["Image Generation"]],
  [/avatar generation/i, ["Image Generation", "Avatars"]],
  [/image enhancement|image editing|background removal/i, ["Image Editing"]],
  [/image design|social media image/i, ["Design"]],
  [/social media image/i, ["Social Media"]],
  [/video generation|video animation/i, ["Video Generation"]],
  [/video avatar/i, ["Video Generation", "Avatars"]],
  [/video editing|screen recording|video design|social video/i, ["Video Editing"]],
  [/video voiceover/i, ["Voice Generation", "Video Editing"]],
  [/video translation/i, ["Translation", "Video Editing"]],
  [/video summarization/i, ["Summarization"]],
  [/voice generation|voice cloning|voice changer/i, ["Voice Generation"]],
  [/audio transcription/i, ["Transcription"]],
  [/music generation|sound effects|audio editing|audio enhancement|podcast/i, ["Music & Audio"]],
  [/audio translation|dubbing/i, ["Translation", "Voice Generation"]],
  [/audio summarization/i, ["Transcription", "Summarization"]],
  [/chatbot platforms|business chatbots|no-code chatbot|customer support chatbots|sales & marketing chatbots|voice assistants/i, ["AI Chatbot"]],
  [/no-code chatbot|no-code & low-code/i, ["No-Code"]],
  [/customer support/i, ["Customer Support"]],
  [/sales & marketing chatbots/i, ["Marketing"]],
  [/coding|code review|code generation|devops|backend & api|testing & qa|documentation tools/i, ["AI Coding"]],
  [/research assistants|academic research|ux research/i, ["Research"]],
  [/meeting assistants|meeting & scheduling/i, ["Meetings"]],
  [/personal assistant|productivity assistants|office productivity|note-taking|student productivity/i, ["Productivity"]],
  [/ui design|design system|prototyping|design collaboration|web & app design|brand & graphic design|design automation|ux research/i, ["Design"]],
  [/design automation|office automation|marketing automation|e-commerce automation|social media automation|seo automation/i, ["Automation"]],
  [/product intelligence|pricing & revenue|e-commerce analytics|business intelligence|spreadsheet & data|hr analytics|social media analytics|learning analytics/i, ["Data Analysis"]],
  [/listing & content/i, ["AI Writing"]],
  [/personalization & recommendation|conversion optimization|conversion rate optimization|content marketing|lead generation|influencer marketing|advertising|brand & creative strategy|e-commerce marketing|customer journey|social media ad|social media marketing/i, ["Marketing"]],
  [/lead generation|customer relationship|sales & revenue/i, ["Sales & CRM"]],
  [/presentation/i, ["Presentation"]],
  [/file management|document creation/i, ["Documents"]],
  [/email & communication/i, ["Email"]],
  [/resume|cover letter|job description|interview|ats tools|hiring|employee engagement|hr analytics|resume screening/i, ["HR & Recruiting"]],
  [/influencer|social media/i, ["Social Media"]],
];
const CAT_TAG = { "ai-writing-tools": "AI Writing", "ai-seo-tools": "SEO", "ai-marketing-tools": "Marketing", "ai-social-media-tools": "Social Media", "ai-coding-developer-tools": "AI Coding", "ai-design-ui-ux-tools": "Design", "ai-e-commerce-tools": "E-commerce", "ai-education-learning-tools": "Education", "ai-resume-hr-tools": "HR & Recruiting" };
const TEXT_RULES = [
  ["Image Generation", /\b(text[- ]to[- ]image|ai image generat\w*|generates? (?:ai )?images?)\b/i],
  ["Video Generation", /\b(text[- ]to[- ]video|ai video generat\w*|generates? (?:ai )?videos?)\b/i],
  ["Voice Generation", /\b(text[- ]to[- ]speech|ai voice ?overs?|lifelike (?:ai )?voices)\b/i],
  ["Transcription", /\b(transcri(?:be|bes|ption|ptions)|speech[- ]to[- ]text)\b/i],
  ["Translation", /\b(translat(?:e|es|ion|ions|ing)|dubbing)\b/i],
  ["AI Chatbot", /\b(ai chatbots?|chatbot builder|build (?:a |your own )?chatbots?)\b/i],
  ["AI Coding", /\b(code completion|code generation|coding assistant|pull requests?|write code)\b/i],
  ["SEO", /\bSEO\b/],
  ["Presentation", /\b(presentations?|slide decks?|pitch decks?)\b/i],
  ["Automation", /\b(workflow automation|automates? (?:your )?(?:workflows?|repetitive tasks))\b/i],
  ["Summarization", /\b(summari[sz](?:e|es|ing|ation)|summaries)\b/i],
  ["Meetings", /\b(meeting notes|meeting summar\w+|meeting assistant)\b/i],
  ["Avatars", /\b(ai avatars?|talking avatars?|digital humans?)\b/i],
  ["Image Editing", /\b(background remov\w+|upscal\w+|photo editing|retouch\w*)\b/i],
  ["No-Code", /\bno[- ]code\b/i],
  ["Customer Support", /\b(customer support|help ?desk|support tickets?)\b/i],
  ["Research", /\b(research assistant|literature review|academic papers?|scientific papers?)\b/i],
];
function tagsFor(t, homeDesc) {
  const out = new Set(), why = [];
  const add = (tag, src) => { if (VOCAB.includes(tag) && !out.has(tag)) { out.add(tag); why.push(`${tag} <- ${src}`); } };
  if (CAT_TAG[t.category_id]) add(CAT_TAG[t.category_id], "category");
  for (const [rx, tags] of SUB_RULES) if (rx.test(t.subcategory || "")) for (const g of tags) add(g, `subcategory "${t.subcategory}"`);
  const own = [t.tagline, t.overview, t.best_for, t.features].filter(Boolean).join(" ");
  for (const [tag, rx] of TEXT_RULES) {
    if (out.size >= 5) break;
    const m = own.match(rx) || (homeDesc || "").match(rx);
    if (m) add(tag, `${own.match(rx) ? "tool description" : "official homepage description"}: "${m[0]}"`);
  }
  return { tags: VOCAB.filter((v) => out.has(v)), why: why.join("; ") };
}

// Spot-check corrections to automated results (by product URL): reviewed by hand against the captured evidence.
const OVERRIDES = new Map([
  ["https://bit.dev", "Open-source core plus a paid Bit Cloud; no price captured, so Free vs Freemium is unclear"],
  ["https://www.shipbob.com", "The software is free but ShipBob charges for the fulfilment service itself; label unclear"],
]);

// ---------- merge ----------
const rows = [];
for (const t of tools) {
  const r0 = research.get(t.slug) || {};
  const r = OVERRIDES.has(norm(t.url)) ? { ...r0, status: "unknown", label: null, note: `Manual override: ${OVERRIDES.get(norm(t.url))}` } : r0;
  const m = manual.get(norm(t.url));
  let pricing = { model: null, source: null, checked: null, status: "pending_review", basis: "", evidence: "", note: "" };
  if (t.pricing_model) pricing = { model: t.pricing_model, source: t.pricing_source, checked: t.pricing_checked_at, status: "verified", basis: "existing (owner-verified)", evidence: "", note: "" };
  else if (m) pricing = { model: m.model, source: m.pricing_url, checked: "2026-10-31", status: "verified", basis: "manual research (batch 1)", evidence: m.evidence, note: m.notes || "" };
  else if (r.status === "verified" && r.label) pricing = { model: r.label, source: r.pricing_url, checked: r.checked_at, status: "verified", basis: "automated research of the official page", evidence: r.evidence, note: r.note || "" };
  else pricing = { ...pricing, status: r.status === "failed" ? "failed" : "unknown", basis: r.status ? "automated research" : "not researched", evidence: r.evidence || "", note: r.note || "No research result" };
  const existingTags = JSON.parse(t.tags || "[]");
  const tg = existingTags.length ? { tags: existingTags, why: "existing (kept)" } : tagsFor(t, r.homepage_description);
  rows.push({ slug: t.slug, name: t.name, url: t.url || "", category: t.category_id, subcategory: t.subcategory || "", tool_status: t.status, pricing_model: pricing.model || "", pricing_status: pricing.status, pricing_basis: pricing.basis, pricing_source: pricing.source || "", checked_at: pricing.checked || "", evidence: (pricing.evidence || "").slice(0, 500), notes: pricing.note, tags: tg.tags, tag_basis: tg.why, final_url: r.final_url || "", homepage_description: r.homepage_description || "", _setPricing: !t.pricing_model && !!pricing.model, _setTags: !existingTags.length && tg.tags.length > 0 });
}
writeFileSync(`${OUT}/enrichment.json`, JSON.stringify(rows.map(({ _setPricing, _setTags, ...x }) => x), null, 1));

// ---------- report ----------
const COLS = ["slug", "name", "url", "category", "subcategory", "tool_status", "pricing_model", "pricing_status", "pricing_basis", "pricing_source", "checked_at", "evidence", "notes", "tags", "tag_basis", "final_url"];
const cell = (v) => { const s = Array.isArray(v) ? v.join("; ") : String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(`${OUT}/metadata-review.csv`, "﻿" + [COLS.join(","), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n");

// ---------- import + rollback ----------
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const fwd = [`-- Metadata import (pricing models + functional tags), generated ${NOW} by scripts/metadata/build.mjs.`, "-- Guarded: tags only where none are recorded, pricing only where none is recorded. Re-running changes nothing."];
const back = [`-- Rollback for the metadata import generated ${NOW}.`];
let nP = 0, nT = 0;
for (const r of rows) {
  if (r._setTags) {
    nT++;
    fwd.push(`UPDATE tools SET tags = ${q(JSON.stringify(r.tags))}, updated_at = ${q(NOW)} WHERE slug = ${q(r.slug)} AND tags = '[]';`);
    // Matched on the exact values written (not updated_at, which a later import re-stamps), so a later edit is left alone.
    back.push(`UPDATE tools SET tags = '[]' WHERE slug = ${q(r.slug)} AND tags = ${q(JSON.stringify(r.tags))};`);
  }
  if (r._setPricing) {
    nP++;
    fwd.push(`UPDATE tools SET pricing_model = ${q(r.pricing_model)}, pricing_source = ${q(r.pricing_source)}, pricing_checked_at = ${q(r.checked_at)}, updated_at = ${q(NOW)} WHERE slug = ${q(r.slug)} AND pricing_model IS NULL AND pricing_plans IS NULL;`);
    back.push(`UPDATE tools SET pricing_model = NULL, pricing_source = NULL, pricing_checked_at = NULL WHERE slug = ${q(r.slug)} AND pricing_model = ${q(r.pricing_model)} AND pricing_source = ${q(r.pricing_source)} AND pricing_checked_at = ${q(r.checked_at)};`);
  }
}
const bump = (tag) => `INSERT INTO meta (key, value, updated_at) VALUES ('catalog_version', '${NOW}#${tag}${randomUUID()}', '${NOW}') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`;
fwd.push(`INSERT INTO audit_events (at, actor_email, action, entity_type, entity_id, summary) SELECT ${q(NOW)}, ${q(ACTOR)}, 'tool.bulk_update', 'tool', 'metadata-import', ${q(`Metadata import: pricing for ${nP} tools, tags for ${nT} tools`)} WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE actor_email = ${q(ACTOR)} AND at = ${q(NOW)});`, bump(""));
back.push(`DELETE FROM audit_events WHERE actor_email = ${q(ACTOR)} AND at = ${q(NOW)};`, bump("rollback-"));
writeFileSync(`${OUT}/metadata-import.sql`, fwd.join("\n") + "\n");
writeFileSync(`${OUT}/metadata-import.rollback.sql`, back.join("\n") + "\n");

// ---------- summary ----------
const count = (f) => rows.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {});
const summary = {
  generated_at: NOW,
  tools: rows.length,
  pricing_by_model: count((r) => r.pricing_model || "(none)"),
  pricing_by_status: count((r) => r.pricing_status),
  pricing_by_basis: count((r) => r.pricing_basis),
  review_flagged: rows.filter((r) => /REVIEW/.test(r.notes)).length,
  tools_with_tags: rows.filter((r) => r.tags.length).length,
  tags: count((r) => r.tags.length),
  tag_usage: rows.flatMap((r) => r.tags).reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {}),
  import: { pricing_updates: nP, tag_updates: nT },
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
