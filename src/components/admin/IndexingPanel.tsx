// The indexing gate for one tool: every check of G1–G10 with its result, and the only per-tool switch that turns
// indexing on. The server runs the same checks again on every request; there is no override.
import { useState } from "react";
import { api } from "./client";
import { Banner, btnGhost, btnPrimary, card, errorMessage, useAsync } from "./ui";

type Gate = {
  indexing: string;
  passes: boolean;
  checks: { id: string; ok: boolean; reasons: string[] }[];
};
const LABEL: Record<string, string> = {
  base: "Published, not flagged, valid official URL",
  G1: "G1 Overview (45–110 words) and tagline (3–12 words)",
  G2: "G2 At least 3 features, each with its official-page quote",
  G3: "G3 2–4 tool-specific use cases, each quoted",
  G4: "G4 Pricing verified with evidence, or unknown and checked ≤ 90 days",
  G5: "G5 Pricing summary supported by its quote",
  G6: "G6 URL ok (checked ≤ 30 days), identity confirmed, no outdated-product signals",
  G7: "G7 One indexed page per product and site; not a feature variant",
  G8: "G8 ≥ 120 words of own text, ≤ 50% overlap with its subcategory",
  G9: "G9 Approved by an editor (recorded)",
  G10: "G10 Category confirmed by the editor",
};

export function IndexingPanel({
  slug,
  updatedAt,
  onChanged,
}: {
  slug: string;
  updatedAt: string;
  onChanged: () => void;
}) {
  const gate = useAsync(
    () => api.get<Gate>(`tools/${encodeURIComponent(slug)}/gate`),
    [slug, updatedAt],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const g = gate.data && Array.isArray(gate.data.checks) ? gate.data : null;
  const set = async (indexing: "index" | "noindex") => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`tools/${encodeURIComponent(slug)}/indexing`, {
        indexing,
        updated_at: updatedAt,
      });
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${card} space-y-3`} aria-labelledby="indexing-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="indexing-h" className="text-lg font-extrabold">
            Indexing gate
          </h3>
          <p className="text-sm text-muted-foreground">
            Search indexing: <strong>{g?.indexing === "index" ? "on" : "off"}</strong>
            {g && g.indexing !== "index"
              ? g.passes
                ? " · every check passes"
                : ` · ${g.checks.filter((c) => !c.ok).length} check(s) failing`
              : ""}
          </p>
        </div>
        {g &&
          (g.indexing === "index" ? (
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => set("noindex")}
            >
              Disable indexing
            </button>
          ) : (
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !g.passes}
              onClick={() => set("index")}
              title={g.passes ? "Adds the page to the sitemap" : "Every check must pass first"}
            >
              {busy ? "Checking…" : "Enable indexing"}
            </button>
          ))}
      </div>
      {!!err && <Banner kind="error">{errorMessage(err)}</Banner>}
      {!!gate.error && <Banner kind="error">{errorMessage(gate.error)}</Banner>}
      {g && (
        <ul className="space-y-1 text-sm">
          {g.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span aria-hidden="true" className={c.ok ? "text-emerald-600" : "text-destructive"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span>
                <span className={c.ok ? "" : "font-semibold"}>{LABEL[c.id] ?? c.id}</span>
                {!c.ok && (
                  <span className="block text-xs text-muted-foreground">
                    {c.reasons.map((r) => r.replace(/^G\d+: |^base: /, "")).join("; ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
