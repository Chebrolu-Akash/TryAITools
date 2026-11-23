// Loads what the indexing gate needs beyond the tool row itself: indexed listings of the same product or site, feature
// variants, the own text of the other published tools in the same subcategory, and the latest (unreverted) approval.
// Server only. A few small queries per call, whatever the number of tools.
import { templateAudience } from "@/lib/tool-content";
import type { AdminDb } from "./db";
import type { Approval, GateContext } from "./index-gate";
import type { Row } from "./repo";
import { ownText } from "./similarity";

const parseJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export const hostOf = (u: unknown) => {
  try {
    return new URL(String(u)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
export const productKey = (name: string) =>
  name
    .replace(/\s*\(.+\)\s*$/, "")
    .trim()
    .toLowerCase();

/** One context per given tool (keyed by slug). `tools` need id, slug, name, url, category_id, subcategory. */
export async function loadGateContexts(
  d: AdminDb,
  tools: Row[],
  now: string,
): Promise<Map<string, GateContext>> {
  const out = new Map<string, GateContext>();
  if (!tools.length) return out;
  const subs = [...new Set(tools.map((t) => String(t["subcategory"] ?? "")).filter(Boolean))];
  const ids = tools.map((t) => String(t["id"]));
  const [published, peers, approvals, cats] = await Promise.all([
    d.prepare("SELECT slug, name, url, indexing FROM tools WHERE status = 'published'").all<Row>(),
    subs.length
      ? d
          .prepare(
            `SELECT slug, subcategory, tagline, overview, best_for, features, pros, limits FROM tools
              WHERE status = 'published' AND subcategory IN (SELECT value FROM json_each(?))
                AND (overview IS NOT NULL OR features IS NOT NULL OR tagline IS NOT NULL)`,
          )
          .bind(JSON.stringify(subs))
          .all<Row>()
      : Promise.resolve({ results: [] as Row[] }),
    d
      .prepare(
        `SELECT tool_id, actor_email, at, checklist FROM tool_review_history
          WHERE action = 'approve' AND reverted_at IS NULL AND tool_id IN (SELECT value FROM json_each(?))
          ORDER BY id`,
      )
      .bind(JSON.stringify(ids))
      .all<Row>(),
    d.prepare("SELECT id, name FROM categories").all<Row>(),
  ]);
  const catName = new Map(cats.results.map((c) => [String(c["id"]), String(c["name"])]));
  const latest = new Map<string, Approval>();
  for (const a of approvals.results)
    latest.set(String(a["tool_id"]), {
      actor_email: String(a["actor_email"]),
      at: String(a["at"]),
      checklist: (parseJson(a["checklist"]) as Approval["checklist"]) ?? null,
    });
  for (const t of tools) {
    const slug = String(t["slug"]);
    const host = hostOf(t["url"]);
    const key = productKey(String(t["name"] ?? ""));
    const name = String(t["name"] ?? "").toLowerCase();
    const others = published.results.filter((x) => x["slug"] !== slug);
    const sameProduct = others.find(
      (x) => x["indexing"] === "index" && productKey(String(x["name"])) === key,
    );
    const sameSite = host
      ? others.find((x) => x["indexing"] === "index" && hostOf(x["url"]) === host)
      : undefined;
    const variant = host
      ? others.find((x) => {
          if (hostOf(x["url"]) !== host) return false;
          const n = productKey(String(x["name"]));
          const base = n.replace(/\s+ai$/, "");
          return (
            n !== key &&
            (name.startsWith(`${n} `) || (base.length >= 3 && name.startsWith(`${base} `)))
          );
        })
      : undefined;
    out.set(slug, {
      now,
      templateAudience: templateAudience(catName.get(String(t["category_id"])) ?? ""),
      sameProductIndexed: sameProduct ? String(sameProduct["slug"]) : null,
      sameSiteIndexed: sameSite ? String(sameSite["slug"]) : null,
      variantOf: variant ? String(variant["slug"]) : null,
      peers: peers.results
        .filter((p) => p["slug"] !== slug && p["subcategory"] === t["subcategory"])
        .map((p) => ({ slug: String(p["slug"]), text: ownText(p) })),
      approval: latest.get(String(t["id"])) ?? null,
    });
  }
  return out;
}
