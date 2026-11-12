#!/usr/bin/env node
// Pricing research for every product URL in a D1 snapshot, in batches of 100 tools, resumable.
//   node scripts/metadata/research.mjs --snapshot <export.sql> [--batches N] [--concurrency 6]
// Reads only public pages: the product's homepage and its pricing page. robots.txt is respected, nothing is retried
// around a block (403/429/challenge -> "failed"). Classification follows db/pricing/RULES.md and only uses what the
// page text states; anything unclear is "unknown". Results are cached per normalised URL in db/metadata/research/.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SNAPSHOT = opt("--snapshot");
const MAX_BATCHES = Number(opt("--batches", 1e9));
const CONCURRENCY = Number(opt("--concurrency", 6));
const OUT = "db/metadata";
const CACHE = `${OUT}/research`;
const UA = "Mozilla/5.0 (compatible; TryAIToolsResearch/1.0; +https://tryaitools.io)";
const TODAY = new Date().toISOString().slice(0, 10);
mkdirSync(CACHE, { recursive: true });
mkdirSync(`${OUT}/batches`, { recursive: true });

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(SNAPSHOT, "utf8"));
const tools = db.prepare("SELECT slug, name, url FROM tools ORDER BY sort_order, slug").all();
export const normUrl = (u) => String(u || "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const cacheFile = (u) => `${CACHE}/${Buffer.from(normUrl(u)).toString("base64url").slice(0, 120)}.json`;

// ---------- fetching ----------
const robotsCache = new Map();
async function get(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*;q=0.5", "accept-language": "en-US,en;q=0.8" }, redirect: "follow", signal: ctl.signal });
    const type = r.headers.get("content-type") || "";
    let body = "";
    if (/html|text/.test(type)) body = (await r.text()).slice(0, 2_000_000);
    else await r.body?.cancel();
    return { status: r.status, url: r.url, body, type };
  } catch (e) {
    return { status: 0, url, body: "", error: e.name === "AbortError" ? "timeout" : String(e.cause?.code || e.message).slice(0, 80) };
  } finally {
    clearTimeout(t);
  }
}
async function allowed(url) {
  let o;
  try { o = new URL(url).origin; } catch { return false; }
  if (!robotsCache.has(o)) {
    robotsCache.set(o, (async () => {
      const r = await get(`${o}/robots.txt`, 8000);
      if (r.status !== 200) return [];
      const rules = [];
      let applies = false;
      for (const raw of r.body.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, "").trim();
        const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === "user-agent") applies = v === "*" || /tryaitools/i.test(v);
        else if (applies && v) rules.push([k, v]);
      }
      return rules;
    })());
  }
  const rules = await robotsCache.get(o);
  const u = new URL(url);
  const path = u.pathname + u.search;
  // Robots patterns: "*" matches any characters and a trailing "$" anchors the end (RFC 9309); longest match wins.
  const matches = (v) => new RegExp("^" + v.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")).test(path);
  let best = null;
  for (const [k, v] of rules) if (matches(v) && (!best || v.length > best[1].length || (v.length === best[1].length && k === "allow"))) best = [k, v];
  return !best || best[0] === "allow";
}
const text = (html) => html
  .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|th|section|article|span|a|button)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$").replace(/&euro;/g, "€").replace(/&pound;/g, "£").replace(/&#8377;/g, "₹")
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const meta = (html) => (html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']{10,400})/i) || html.match(/<meta[^>]+content=["']([^"']{10,400})["'][^>]+(?:name|property)=["'](?:og:)?description/i) || [])[1] || "";
const challenge = (r) => [401, 403, 429, 503].includes(r.status) || /<title>[^<]*(just a moment|attention required|access denied|security check|captcha|verify you are human)/i.test(r.body.slice(0, 20000)) || (r.body.length < 30000 && /cf-chl-|challenge-platform\/h\//i.test(r.body));

function pricingLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1], label = m[2].replace(/<[^>]+>/g, " ").trim();
    if (/pricing|\/plans?\b|\/price|\/premium|\/upgrade|\/subscribe|\/billing/i.test(href) || /^(pricing|plans|plans & pricing|plans and pricing|price|upgrade|go pro|premium)$/i.test(label)) {
      try {
        const u = new URL(href, base);
        if (/^https?:$/.test(u.protocol)) out.push(u.href);
      } catch {}
    }
  }
  return [...new Set(out)];
}

// ---------- classification (RULES.md) ----------
const RX = {
  price: /(?:[$€£₹]\s{0,6}(\d{1,5}(?:[.,]\d{1,2})?)|(\d{1,5}(?:[.,]\d{1,2})?)\s{0,6}(?:USD|EUR|GBP|INR|€|\$))\s{0,6}(?:\/|per|a|each)?\s{0,6}(?:mo\b|month|monthly|yr\b|year|annual|user|seat|member|week|credit)/gi,
  freePlan: /\b(free plan|free tier|free forever|forever free|always free|free version|basic plan[^\n]{0,20}free|free\s*\n\s*\$\s{0,6}0\b|\$\s{0,6}0(?:\.00)?\s{0,6}(?:\/|per)?\s*(?:mo|month|forever|year)|starter[^\n]{0,15}free|free\s*\n[^\n]{0,60}forever)\b/i,
  // "Is there a free plan? No." / "We don't offer a free plan": the free-plan wording is negated.
  noFreePlan: /\b(?:free (?:forever )?(?:plan|tier|version)\??\s*(?:\n\s*)?no\b|no free (?:forever )?(?:plan|tier|version)|(?:doesn'?t|does not|don'?t|do not) (?:offer|have|provide) (?:a )?free (?:forever )?(?:plan|tier|version))/i,
  trial: /\b(\d{1,3}[- ]day(?:s)? (?:free )?trial|free trial|trial period|try (?:it )?(?:for )?free for \d+ days?)\b/i,
  // "Free" needs an explicit statement that the product itself is free, and no sign of plans to pay for.
  allFree: /\b(100% free|completely free|totally free|entirely free|free and open[- ]source|open[- ]source (?:and|&) free|free forever\. open[- ]source|no paid plans?)\b/i,
  paidHint: /\b(upgrade|premium|subscription|subscribe|pro plan|paid plans?|pricing plans?|per month|\/mo\b|buy now|purchase|credits?|pay (?:only|when|as)|donat(?:e|ion)|in-app purchases?|license fee)\b/i,
  contact: /\b(contact sales|book a demo|request a demo|get a quote|custom pricing|talk to sales)\b/i,
  openSource: /\bopen[- ]source\b/i,
};
const snip = (t, rx) => { const m = t.match(new RegExp(rx.source, rx.flags.replace("g", ""))); if (!m) return null; const i = m.index; return t.slice(Math.max(0, i - 60), i + m[0].length + 60).replace(/\s+/g, " ").trim(); };
function classify(t) {
  const prices = [...t.matchAll(RX.price)].map((m) => Number((m[1] || m[2]).replace(",", "."))).filter((n) => n > 0);
  const paid = prices.length > 0;
  const freePlan = RX.freePlan.test(t) && !RX.noFreePlan.test(t);
  const trial = RX.trial.test(t);
  const ev = [snip(t, RX.freePlan), snip(t, RX.trial), paid ? snip(t, RX.price) : null, snip(t, RX.allFree)].filter(Boolean).slice(0, 3).join(" … ");
  if (freePlan && paid) return { label: "freemium", status: "verified", evidence: ev };
  if (!freePlan && trial && paid) return { label: "free_trial", status: "verified", evidence: ev };
  if (!freePlan && !trial && paid && !/\bfree\b/i.test(t)) return { label: "paid", status: "verified", evidence: ev, note: "REVIEW: paid plans listed and the page never mentions free; inferred no free plan/trial" };
  if (RX.allFree.test(t) && !paid && !trial && !freePlan && !RX.paidHint.test(t)) return { label: "free", status: "verified", evidence: ev, note: "REVIEW: page says free and lists no paid price" };
  if (trial && !freePlan && !paid) return { label: null, status: "unknown", evidence: ev, note: "Trial mentioned but no prices in the page text" };
  if (freePlan && !paid) return { label: null, status: "unknown", evidence: ev, note: "Free plan mentioned but no paid prices in the page text (may be script-rendered)" };
  return { label: null, status: "unknown", evidence: ev, note: paid ? "Prices found but free/trial wording ambiguous" : RX.contact.test(t) ? "Contact-sales only; no self-serve terms stated" : "No pricing terms in the page text" };
}

async function research(url) {
  const res = { url, checked_at: TODAY, final_url: null, pricing_url: null, label: null, status: "failed", evidence: "", note: "", homepage_description: "" };
  if (!/^https?:\/\//i.test(url || "")) return { ...res, note: "No valid product URL" };
  if (!(await allowed(url))) return { ...res, note: "robots.txt disallows the homepage" };
  const home = await get(url);
  if (home.status === 0) return { ...res, note: `Unreachable (${home.error})` };
  if (challenge(home)) return { ...res, final_url: home.url, note: `Blocked or bot challenge (HTTP ${home.status})` };
  if (home.status >= 400) return { ...res, final_url: home.url, note: `HTTP ${home.status}` };
  res.final_url = home.url;
  res.homepage_description = meta(home.body).replace(/\s+/g, " ").trim();
  let candidates = pricingLinks(home.body, home.url).filter((u) => new URL(u).hostname.replace(/^www\./, "").endsWith(new URL(home.url).hostname.replace(/^www\.|^app\./, "").split(".").slice(-2).join(".")));
  if (!candidates.length) candidates = [new URL("/pricing", home.url).href];
  let page = null;
  for (const c of candidates.slice(0, 2)) {
    if (!(await allowed(c))) { res.note = "robots.txt disallows the pricing page"; continue; }
    const p = await get(c);
    if (p.status === 200 && !challenge(p)) { page = p; break; }
    if (challenge(p)) res.note = `Pricing page blocked (HTTP ${p.status})`;
  }
  const homeText = text(home.body);
  res.homepage_text = homeText.slice(0, 20000);
  if (!page) {
    const c = classify(homeText);
    // Only a clear statement on the homepage counts; a missing pricing page is never read as "paid".
    if (c.label && c.label !== "paid") return { ...res, ...c, pricing_url: home.url, note: [c.note, "From the homepage (no readable pricing page)"].filter(Boolean).join("; ") };
    return { ...res, status: "unknown", note: res.note || "No readable pricing page found", evidence: c.evidence };
  }
  res.pricing_url = page.url;
  const t = text(page.body);
  res.pricing_text = t.slice(0, 40000); // kept so the classifier can be re-run without fetching again
  if (t.length < 400) return { ...res, status: "failed", note: "Pricing page is rendered by JavaScript (no readable text)" };
  return { ...res, ...classify(t) };
}

// ---------- batches ----------
async function pool(items, fn, n) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const progressFile = `${OUT}/progress.json`;
const progress = existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, "utf8")) : { batches_done: [], started_at: new Date().toISOString() };
const total = Math.ceil(tools.length / 100);
let ran = 0;
for (let b = 0; b < total && ran < MAX_BATCHES; b++) {
  if (progress.batches_done.includes(b + 1)) continue;
  const batch = tools.slice(b * 100, b * 100 + 100);
  const urls = [...new Set(batch.map((t) => normUrl(t.url)))].filter((u) => !existsSync(cacheFile(u)));
  const t0 = Date.now();
  await pool(urls, async (u) => {
    const original = batch.find((t) => normUrl(t.url) === u).url;
    const r = await research(original);
    writeFileSync(cacheFile(u), JSON.stringify(r, null, 1));
  }, CONCURRENCY);
  const rows = batch.map((t) => {
    const { homepage_text, pricing_text, ...r } = existsSync(cacheFile(t.url)) ? JSON.parse(readFileSync(cacheFile(t.url), "utf8")) : {};
    return { slug: t.slug, name: t.name, url: t.url, ...r };
  });
  writeFileSync(`${OUT}/batches/batch-${String(b + 1).padStart(2, "0")}.json`, JSON.stringify(rows, null, 1));
  progress.batches_done.push(b + 1);
  progress.updated_at = new Date().toISOString();
  writeFileSync(progressFile, JSON.stringify(progress, null, 1));
  const c = rows.reduce((a, r) => ((a[r.label || r.status] = (a[r.label || r.status] || 0) + 1), a), {});
  console.log(`batch ${b + 1}/${total}: ${batch.length} tools, ${urls.length} new URLs, ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(c));
  ran++;
}
console.log("done:", progress.batches_done.length, "of", total, "batches");
