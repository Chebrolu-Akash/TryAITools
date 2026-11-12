#!/usr/bin/env bun
// READ-ONLY dry run for the published listings whose official URL was recorded as dead (url_status = 'dead').
// Re-checks each one now and sorts it by evidence; it never writes to any database.
//   bun scripts/seo/dead-listings-check.mjs --snapshot <export.sql> --out <dir>
// Evidence per listing: DNS from two resolvers (system + Cloudflare DNS-over-HTTPS), the listed URL (2 attempts) and,
// when the listed page is missing, the site's homepage. Writes <dir>/dead-listings-dryrun.csv and a summary JSON.
import { Database } from "bun:sqlite";
import { promises as dns } from "node:dns";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const snapshot = arg("--snapshot");
const out = arg("--out");
if (!snapshot || !out) {
  console.error(
    "Usage: bun scripts/seo/dead-listings-check.mjs --snapshot <export.sql> --out <dir>",
  );
  process.exit(2);
}
const db = new Database(":memory:");
db.exec(readFileSync(snapshot, "utf8"));
const rows = db
  .query(
    `SELECT t.slug, t.name, t.url, t.url_status, t.review_notes, c.slug AS category
       FROM tools t JOIN categories c ON c.id = t.category_id
      WHERE t.status = 'published' AND t.url_status = 'dead' ORDER BY t.slug`,
  )
  .all();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TryAITools-link-check";
const PARKED =
  /domain (is )?for sale|buy this domain|this domain (may be|is) for sale|parked (free|domain)|hugedomains|afternic|dan\.com\/|domain has expired|account suspended/i;

async function systemDns(host) {
  try {
    const a = await dns.resolve(host).catch(() => []);
    const aaaa = a.length ? [] : await dns.resolve6(host).catch(() => []);
    if (a.length || aaaa.length) return "resolves";
    await dns.resolve(host); // re-throw for the code
    return "no address";
  } catch (e) {
    return e?.code === "ENOTFOUND" || e?.code === "ENODATA"
      ? `not found (${e.code})`
      : `error (${e?.code ?? "?"})`;
  }
}
async function dohDns(host) {
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const j = await r.json();
    if (j.Status === 3) return "NXDOMAIN";
    if (j.Status === 0)
      return j.Answer?.some((a) => a.type === 1 || a.type === 5) ? "resolves" : "no A record";
    return `status ${j.Status}`;
  } catch {
    return "lookup failed";
  }
}
async function get(url) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      const body = (r.headers.get("content-type") ?? "").includes("html")
        ? (await r.text()).slice(0, 40_000)
        : "";
      const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
      return {
        status: r.status,
        final: r.url,
        title,
        parked: PARKED.test(title + " " + body.slice(0, 20_000)),
      };
    } catch (e) {
      last = { status: "ERR", error: String(e?.cause?.code ?? e?.name ?? "error") };
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return last;
}

const results = [];
let i = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (i < rows.length) {
      const t = rows[i++];
      const ev = { slug: t.slug, name: t.name, category: t.category, url: t.url ?? "" };
      let u = null;
      try {
        u = new URL(t.url);
      } catch {
        // no usable URL
      }
      if (!u) {
        results.push({
          ...ev,
          group: "missing or invalid URL",
          recommendation:
            "keep published only if a person finds the official site; otherwise unpublish to draft",
          dns_system: "",
          dns_doh: "",
          page: "",
          homepage: "",
        });
        continue;
      }
      const host = u.hostname;
      const [sys, doh] = await Promise.all([systemDns(host), dohDns(host)]);
      let page = "";
      let home = "";
      let group;
      let rec;
      if (doh === "NXDOMAIN" && sys.startsWith("not found")) {
        group = "confirmed dead domain (NXDOMAIN on both resolvers)";
        rec = "unpublish to draft";
      } else {
        const p = await get(t.url);
        page =
          p.status === "ERR"
            ? `ERR ${p.error}`
            : `${p.status}${p.final && new URL(p.final).hostname !== host ? ` -> ${p.final}` : ""}${p.title ? ` "${p.title}"` : ""}${p.parked ? " [parked]" : ""}`;
        const ok = (s) => typeof s === "number" && s >= 200 && s < 300;
        if (ok(p.status) && !p.parked) {
          group = "reachable now (earlier failure was temporary or path-specific)";
          rec = "keep; re-verify, then review normally";
        } else if (ok(p.status) && p.parked) {
          group = "confirmed gone (domain parked or for sale)";
          rec = "unpublish to draft";
        } else if (p.status === 404 || p.status === 410) {
          // the homepage of the listed site, and of the site it now redirects to (a moved brand), if different
          const origins = [u.origin];
          try {
            if (p.final && new URL(p.final).origin !== u.origin)
              origins.push(new URL(p.final).origin);
          } catch {
            // no final URL
          }
          const homes = [];
          for (const o of origins) homes.push({ o, ...(await get(o + "/")) });
          home = homes
            .map(
              (h) =>
                `${h.o}: ${h.status === "ERR" ? `ERR ${h.error}` : `${h.status}${h.title ? ` "${h.title}"` : ""}${h.parked ? " [parked]" : ""}`}`,
            )
            .join(" | ");
          if (homes.some((h) => ok(h.status) && !h.parked)) {
            group = "page moved, site alive (homepage works)";
            rec = "keep; fix the URL to the current product page (manual check)";
          } else if (homes.some((h) => [401, 403, 429].includes(h.status))) {
            group = "page missing, homepage blocks automated checks (site may be live)";
            rec = "keep; manual check in a browser";
          } else if (origins.length > 1) {
            group = "redirects to another domain whose pages are missing (brand may have moved)";
            rec = "manual check before deciding";
          } else {
            group = "confirmed gone (page and homepage missing)";
            rec = "unpublish to draft";
          }
        } else if (p.status === 401 || p.status === 403 || p.status === 429) {
          group = "blocked automated request (product may be live)";
          rec = "keep; manual check in a browser";
        } else if (p.status === "ERR" && /CERT|TLS|SSL|LEAF|ISSUER|ALTNAME/i.test(p.error)) {
          group = "TLS/certificate failure";
          rec = "manual check (certificate problems can be temporary or mean an abandoned site)";
        } else if (p.status === "ERR" && /ENOTFOUND|EAI_AGAIN/.test(p.error)) {
          group = "DNS uncertain (resolvers disagree)";
          rec = "manual check";
        } else if (p.status === "ERR") {
          group = "connection failure or timeout (possibly temporary)";
          rec = "re-check later before deciding";
        } else {
          group = `uncertain (HTTP ${p.status})`;
          rec = "manual check";
        }
      }
      results.push({
        ...ev,
        group,
        recommendation: rec,
        dns_system: sys,
        dns_doh: doh,
        page,
        homepage: home,
      });
    }
  }),
);
results.sort((a, b) => a.group.localeCompare(b.group) || a.slug.localeCompare(b.slug));
mkdirSync(out, { recursive: true });
const cols = [
  "group",
  "recommendation",
  "slug",
  "name",
  "category",
  "url",
  "dns_system",
  "dns_doh",
  "page",
  "homepage",
];
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
writeFileSync(
  join(out, "dead-listings-dryrun.csv"),
  [cols.join(","), ...results.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n",
);
const byGroup = {};
for (const r of results) byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;
const unpublish = results
  .filter((r) => r.recommendation === "unpublish to draft")
  .map((r) => r.slug);
const summary = {
  checkedAt: new Date().toISOString(),
  snapshot,
  total: results.length,
  byGroup,
  recommendUnpublish: unpublish.length,
  unpublishSlugs: unpublish,
};
writeFileSync(join(out, "dead-listings-dryrun-summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
