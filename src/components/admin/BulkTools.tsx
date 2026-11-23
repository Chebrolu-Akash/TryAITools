// Bulk editing for the Tools list: choose changes (one value for all, or per row), preview the exact effect (dry run),
// apply in small chunks with progress, see successes / skips / failures, and undo a whole operation.
// Server side: src/lib/admin/bulk.ts. Nothing is written until "Apply" is pressed after a preview.
import { useEffect, useMemo, useState } from "react";
import { TOOL_TAGS } from "@/lib/tags";
import { api, qs } from "./client";
import {
  Banner,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  ConfirmDialog,
  errorMessage,
  fmtDate,
  inputCls,
  useAsync,
} from "./ui";

const CHUNK = 10; // must match src/lib/admin/bulk.ts
/** Undoing more than this many records also asks the editor to type "undo". */
const TYPE_TO_CONFIRM = 50;
const undoDescription = (name: string, count: number) =>
  `This restores the previous values of ${count.toLocaleString()} tool record${count === 1 ? "" : "s"} changed by "${name}". Tools edited since are kept as they are. This cannot be redone automatically.`;
export type Cat = { id: string; name: string; subcategories: string[] };
type Membership = { category_id: string; subcategory: string | null };
type Current = {
  category_id: string;
  subcategory: string | null;
  indexing: string;
  status: string;
  review_status: string;
  needs_review: number;
  pricing_model: string | null;
  tags: string[];
  memberships: Membership[];
};
type PlanItem = {
  slug: string;
  name: string;
  status: "change" | "unchanged" | "invalid" | "missing";
  changes: Record<string, { from: unknown; to: unknown }>;
  reasons: string[];
  current?: Current;
};
type Preview = { items: PlanItem[]; counts: Record<string, number> };
type Result = { slug: string; result: string; reasons?: string[] };
type SetFields = Partial<Omit<Current, "tags" | "memberships">>;
type Edit = {
  set?: SetFields;
  tags?: { mode: "add" | "remove" | "replace"; values: string[] };
  memberships?: { add?: Membership[]; remove?: string[] };
  rows?: { slug: string; set: SetFields }[];
};

const TAGS: readonly string[] = TOOL_TAGS;
const STATUSES = ["draft", "review", "published", "archived"];
const REVIEW = ["unreviewed", "draft_ready", "reviewed", "needs_manual"];
const PRICING = ["free", "freemium", "free_trial", "paid"];
const label = (k: string) => k.replace(/_/g, " ");
const show = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : Array.isArray(v)
      ? v.length
        ? v
            .map((x) => (typeof x === "object" ? (x as Membership).category_id : String(x)))
            .join(", ")
        : "none"
      : String(v);

const QUICK: { label: string; set: SetFields; action: string }[] = [
  { label: "Mark reviewed", set: { review_status: "reviewed" }, action: "mark_reviewed" },
  { label: "Enable indexing", set: { indexing: "index" }, action: "enable_indexing" },
  { label: "Disable indexing", set: { indexing: "noindex" }, action: "disable_indexing" },
  { label: "Publish", set: { status: "published" }, action: "publish" },
  { label: "Unpublish", set: { status: "draft" }, action: "unpublish" },
  { label: "Archive", set: { status: "archived" }, action: "archive" },
];

/** A small labelled select. */
function Pick({
  value,
  onChange,
  options,
  label: l,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
  allowEmpty?: string;
}) {
  return (
    <label className="text-sm font-semibold">
      {l}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} mt-1 font-normal`}
      >
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BulkEditor({
  slugs,
  cats,
  onClose,
  onApplied,
}: {
  slugs: string[];
  cats: Cat[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [mode, setMode] = useState<"same" | "rows">("same");
  const [action, setAction] = useState("edit");
  // "same value" form: a field is written only when its box is ticked
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [set, setSet] = useState<SetFields>({});
  const [tagMode, setTagMode] = useState<"add" | "remove" | "replace">("add");
  const [tagVals, setTagVals] = useState<string[]>([]);
  const [memAdd, setMemAdd] = useState<Membership>({ category_id: "", subcategory: null });
  const [memRemove, setMemRemove] = useState("");
  // per-row table
  const [rows, setRows] = useState<Record<string, SetFields>>({});
  const [current, setCurrent] = useState<PlanItem[] | null>(null);
  // flow
  const [step, setStep] = useState<"edit" | "preview" | "applying" | "done">("edit");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [opId, setOpId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{
    restored: number;
    conflict: number;
    blocked: number;
  } | null>(null);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const perRowAllowed = slugs.length <= 200;

  // the per-row editor starts from each tool's current values (a dry run with no change returns them)
  useEffect(() => {
    if (mode !== "rows" || current) return;
    setBusy(true);
    api
      .post<Preview>("bulk/preview", { slugs, set: {} })
      .then((p) => setCurrent(p.items))
      .catch(setErr)
      .finally(() => setBusy(false));
  }, [mode, current, slugs]);

  const edit = (): Edit => {
    if (mode === "rows")
      return {
        rows: Object.entries(rows)
          .filter(([, s]) => Object.keys(s).length)
          .map(([slug, s]) => ({ slug, set: s })),
      };
    const e: Edit = {};
    const s: SetFields = {};
    for (const k of Object.keys(set) as (keyof SetFields)[])
      if (on[k]) (s as Record<string, unknown>)[k] = set[k] ?? null;
    if (on["category_id"] && !on["subcategory"]) s.subcategory = set.subcategory ?? null;
    if (Object.keys(s).length) e.set = s;
    if (on["tags"] && tagVals.length) e.tags = { mode: tagMode, values: tagVals };
    if (on["memberships"] && (memAdd.category_id || memRemove))
      e.memberships = {
        ...(memAdd.category_id ? { add: [memAdd] } : {}),
        ...(memRemove ? { remove: [memRemove] } : {}),
      };
    return e;
  };

  async function runPreview() {
    setErr(null);
    setBusy(true);
    try {
      const e = edit();
      if (!e.set && !e.tags && !e.memberships && !e.rows?.length)
        throw new Error("Choose at least one change.");
      const parts: Preview[] = [];
      for (let i = 0; i < slugs.length; i += 500)
        parts.push(
          await api.post<Preview>("bulk/preview", {
            slugs: slugs.slice(i, i + 500),
            ...e,
            ...(e.rows
              ? { rows: e.rows.filter((r) => slugs.slice(i, i + 500).includes(r.slug)) }
              : {}),
          }),
        );
      const items = parts.flatMap((p) => p.items);
      const counts: Record<string, number> = {
        selected: items.length,
        change: 0,
        unchanged: 0,
        invalid: 0,
        missing: 0,
      };
      for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
      setPreview({ items, counts });
      setStep("preview");
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    const e = edit();
    const targets = preview.items.filter((i) => i.status === "change").map((i) => i.slug);
    setStep("applying");
    setErr(null);
    setProgress(0);
    const out: Result[] = preview.items
      .filter((i) => i.status !== "change")
      .map((i) => ({
        slug: i.slug,
        result: i.status === "unchanged" ? "unchanged" : "skipped",
        reasons: i.reasons,
      }));
    try {
      const op = await api.post<{ op: { id: string } }>("bulk/operations", {
        action,
        summary: `${action}: ${Object.keys(e.set ?? {})
          .concat(
            e.tags ? ["tags"] : [],
            e.memberships ? ["categories"] : [],
            e.rows ? ["per-row"] : [],
          )
          .join(", ")} on ${targets.length} tools`.slice(0, 200),
        total: Math.max(1, targets.length),
      });
      setOpId(op.op.id);
      for (let i = 0; i < targets.length; i += CHUNK) {
        const part = targets.slice(i, i + CHUNK);
        try {
          const r = await api.post<{ results: Result[] }>(`bulk/operations/${op.op.id}/apply`, {
            slugs: part,
            ...(e.set ? { set: e.set } : {}),
            ...(e.tags ? { tags: e.tags } : {}),
            ...(e.memberships ? { memberships: e.memberships } : {}),
            ...(e.rows ? { rows: e.rows.filter((x) => part.includes(x.slug)) } : {}),
          });
          out.push(...r.results);
        } catch (er) {
          out.push(
            ...part.map((slug) => ({ slug, result: "failed", reasons: [errorMessage(er)] })),
          );
        }
        setProgress(Math.min(targets.length, i + CHUNK));
      }
      await api.post(`bulk/operations/${op.op.id}/finish`, {});
    } catch (er) {
      setErr(er);
    }
    setResults(out);
    setStep("done");
    onApplied();
  }

  const [confirmUndo, setConfirmUndo] = useState(false);
  async function undoAll() {
    setConfirmUndo(false);
    if (!opId) return;
    setBusy(true);
    let restored = 0;
    let conflict = 0;
    let blocked = 0;
    try {
      for (let guard = 0; guard < 1000; guard++) {
        const r = await api.post<{ results: Result[]; remaining: number }>(
          `bulk/operations/${opId}/undo`,
          {},
        );
        restored += r.results.filter((x) => x.result === "restored").length;
        conflict += r.results.filter((x) => x.result === "conflict").length;
        blocked += r.results.filter((x) => x.result === "blocked").length;
        if (r.remaining <= 0 || r.results.length === 0) break;
      }
      setUndo({ restored, conflict, blocked });
      onApplied();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const tick = (k: string) => (
    <input
      type="checkbox"
      aria-label={`Change ${label(k)}`}
      checked={!!on[k]}
      onChange={(e) => setOn({ ...on, [k]: e.target.checked })}
    />
  );
  const subsOf = (id: string | undefined) => (id ? (catById.get(id)?.subcategories ?? []) : []);
  const counts = preview?.counts;
  const summary = (r: string) => results.filter((x) => x.result === r).length;

  return (
    <section className={`${card} space-y-4`} aria-label="Bulk edit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          Bulk edit {slugs.length.toLocaleString()} selected tool{slugs.length === 1 ? "" : "s"}
        </h2>
        <button type="button" className={btnGhost} onClick={onClose} disabled={step === "applying"}>
          Close
        </button>
      </div>
      {!!err && <Banner kind="error">{errorMessage(err)}</Banner>}

      {step === "edit" && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
            {QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                className={btnGhost}
                onClick={() => {
                  setMode("same");
                  setAction(q.action);
                  setSet(q.set);
                  setOn(Object.fromEntries(Object.keys(q.set).map((k) => [k, true])));
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Edit mode">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "same"} onChange={() => setMode("same")} /> Same
              value for every selected tool
            </label>
            <label className={`flex items-center gap-2 ${perRowAllowed ? "" : "opacity-50"}`}>
              <input
                type="radio"
                disabled={!perRowAllowed}
                checked={mode === "rows"}
                onChange={() => setMode("rows")}
              />{" "}
              Edit each row
              {!perRowAllowed && " (up to 200 tools)"}
            </label>
          </div>

          {mode === "same" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-end gap-2">
                {tick("category_id")}
                <Pick
                  label="Main category"
                  value={set.category_id ?? ""}
                  allowEmpty="Choose…"
                  onChange={(v) => {
                    setSet({ ...set, category_id: v, subcategory: null });
                    setOn({ ...on, category_id: true });
                  }}
                  options={cats.map((c) => [c.id, c.name])}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("subcategory")}
                <Pick
                  label="Subcategory"
                  value={set.subcategory ?? ""}
                  allowEmpty="None"
                  onChange={(v) => {
                    setSet({ ...set, subcategory: v || null });
                    setOn({ ...on, subcategory: true });
                  }}
                  options={subsOf(set.category_id).map((s) => [s, s])}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("indexing")}
                <Pick
                  label="Indexing"
                  value={set.indexing ?? ""}
                  allowEmpty="Choose…"
                  onChange={(v) => {
                    setSet({ ...set, indexing: v });
                    setOn({ ...on, indexing: true });
                  }}
                  options={[
                    ["index", "Index"],
                    ["noindex", "Noindex"],
                  ]}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("status")}
                <Pick
                  label="Publication status"
                  value={set.status ?? ""}
                  allowEmpty="Choose…"
                  onChange={(v) => {
                    setSet({ ...set, status: v });
                    setOn({ ...on, status: true });
                  }}
                  options={STATUSES.map((s) => [s, s])}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("review_status")}
                <Pick
                  label="Review status"
                  value={set.review_status ?? ""}
                  allowEmpty="Choose…"
                  onChange={(v) => {
                    setSet({ ...set, review_status: v });
                    setOn({ ...on, review_status: true });
                  }}
                  options={REVIEW.map((s) => [s, label(s)])}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("needs_review")}
                <Pick
                  label="Needs-review flag"
                  value={set.needs_review === undefined ? "" : String(set.needs_review)}
                  allowEmpty="Choose…"
                  onChange={(v) => {
                    setSet({ ...set, needs_review: Number(v) });
                    setOn({ ...on, needs_review: true });
                  }}
                  options={[
                    ["1", "Flagged"],
                    ["0", "Not flagged"],
                  ]}
                />
              </div>
              <div className="flex items-end gap-2">
                {tick("pricing_model")}
                <Pick
                  label="Pricing model"
                  value={set.pricing_model ?? ""}
                  allowEmpty="Not recorded"
                  onChange={(v) => {
                    setSet({ ...set, pricing_model: v || null });
                    setOn({ ...on, pricing_model: true });
                  }}
                  options={PRICING.map((s) => [s, label(s)])}
                />
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="flex items-center gap-2 text-sm font-semibold">
                  {tick("tags")} Tags
                </legend>
                <div className="mt-1 flex gap-3 text-sm">
                  {(["add", "remove", "replace"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1">
                      <input type="radio" checked={tagMode === m} onChange={() => setTagMode(m)} />{" "}
                      {m}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TAGS.map((t) => (
                    <label
                      key={t}
                      className="flex items-center gap-1 rounded-full border border-primary/15 px-2 py-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={tagVals.includes(t)}
                        onChange={(e) => {
                          setTagVals(
                            e.target.checked ? [...tagVals, t] : tagVals.filter((x) => x !== t),
                          );
                          setOn({ ...on, tags: true });
                        }}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="sm:col-span-2">
                <legend className="flex items-center gap-2 text-sm font-semibold">
                  {tick("memberships")} Also show in categories
                </legend>
                <div className="mt-1 grid gap-2 sm:grid-cols-3">
                  <Pick
                    label="Add category"
                    value={memAdd.category_id}
                    allowEmpty="—"
                    onChange={(v) => {
                      setMemAdd({ category_id: v, subcategory: null });
                      setOn({ ...on, memberships: true });
                    }}
                    options={cats.map((c) => [c.id, c.name])}
                  />
                  <Pick
                    label="…with subcategory"
                    value={memAdd.subcategory ?? ""}
                    allowEmpty="None"
                    onChange={(v) => setMemAdd({ ...memAdd, subcategory: v || null })}
                    options={subsOf(memAdd.category_id).map((s) => [s, s])}
                  />
                  <Pick
                    label="Remove category"
                    value={memRemove}
                    allowEmpty="—"
                    onChange={(v) => {
                      setMemRemove(v);
                      setOn({ ...on, memberships: true });
                    }}
                    options={cats.map((c) => [c.id, c.name])}
                  />
                </div>
              </fieldset>
            </div>
          ) : !current ? (
            <p className="text-sm text-muted-foreground">Loading the selected tools…</p>
          ) : (
            <div className="max-h-[28rem] overflow-auto rounded-2xl border border-primary/10">
              <table className="w-full min-w-[56rem] text-left text-xs">
                <thead className="sticky top-0 bg-accent text-muted-foreground">
                  <tr>
                    {[
                      "Tool",
                      "Category",
                      "Subcategory",
                      "Status",
                      "Review",
                      "Indexing",
                      "Pricing",
                    ].map((h) => (
                      <th key={h} scope="col" className="px-2 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current
                    .filter((c) => c.current)
                    .map((c) => {
                      const v = { ...c.current!, ...(rows[c.slug] ?? {}) };
                      const upd = (k: keyof SetFields, val: unknown) =>
                        setRows({
                          ...rows,
                          [c.slug]: {
                            ...(rows[c.slug] ?? {}),
                            [k]: val,
                            ...(k === "category_id" ? { subcategory: null } : {}),
                          },
                        });
                      const sel = (
                        k: keyof SetFields,
                        opts: [string, string][],
                        empty?: string,
                      ) => (
                        <select
                          aria-label={`${label(k)} for ${c.name}`}
                          className="w-full rounded-lg border border-primary/15 bg-background px-1 py-1"
                          value={v[k] === null || v[k] === undefined ? "" : String(v[k])}
                          onChange={(e) => upd(k, e.target.value === "" ? null : e.target.value)}
                        >
                          {empty !== undefined && <option value="">{empty}</option>}
                          {opts.map(([o, t]) => (
                            <option key={o} value={o}>
                              {t}
                            </option>
                          ))}
                        </select>
                      );
                      return (
                        <tr key={c.slug} className={rows[c.slug] ? "bg-primary/5" : ""}>
                          <td className="px-2 py-1 font-semibold">
                            {c.name}
                            <div className="font-normal text-muted-foreground">/{c.slug}</div>
                          </td>
                          <td className="px-2 py-1">
                            {sel(
                              "category_id",
                              cats.map((x) => [x.id, x.name]),
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {sel(
                              "subcategory",
                              subsOf(String(v.category_id)).map((s) => [s, s]),
                              "None",
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {sel(
                              "status",
                              STATUSES.map((s) => [s, s]),
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {sel(
                              "review_status",
                              REVIEW.map((s) => [s, label(s)]),
                            )}
                          </td>
                          <td className="px-2 py-1">
                            {sel("indexing", [
                              ["index", "index"],
                              ["noindex", "noindex"],
                            ])}
                          </td>
                          <td className="px-2 py-1">
                            {sel(
                              "pricing_model",
                              PRICING.map((s) => [s, label(s)]),
                              "—",
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={runPreview} disabled={busy}>
              {busy ? "Checking…" : "Preview changes"}
            </button>
            <span className="self-center text-xs text-muted-foreground">
              Nothing is saved until you apply the previewed changes.
            </span>
          </div>
        </>
      )}

      {step === "preview" && preview && counts && (
        <>
          <p className="text-sm" aria-live="polite">
            <strong>{counts["change"]}</strong> will change · {counts["unchanged"]} already have
            these values · <strong>{counts["invalid"]}</strong> cannot be changed ·{" "}
            {counts["missing"]} not found
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-2xl border border-primary/10">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-accent text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-2">
                    Tool
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Result
                  </th>
                  <th scope="col" className="px-2 py-2">
                    Changes / reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/10">
                {preview.items
                  .filter((i) => i.status !== "unchanged")
                  .slice(0, 500)
                  .map((i) => (
                    <tr key={i.slug}>
                      <td className="px-2 py-1 font-semibold">{i.name}</td>
                      <td
                        className={`px-2 py-1 ${i.status === "change" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
                      >
                        {i.status === "change" ? "will change" : i.status}
                      </td>
                      <td className="px-2 py-1">
                        {i.status === "change"
                          ? Object.entries(i.changes).map(([k, v]) => (
                              <div key={k}>
                                {label(k)}:{" "}
                                <span className="text-muted-foreground line-through">
                                  {show(v.from)}
                                </span>{" "}
                                → {show(v.to)}
                              </div>
                            ))
                          : i.reasons.join("; ")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={() => setStep("edit")}>
              Back
            </button>
            <button
              type="button"
              className={action === "archive" ? btnDanger : btnPrimary}
              onClick={apply}
              disabled={!counts["change"]}
            >
              Apply to {counts["change"]} tool{counts["change"] === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}

      {step === "applying" && (
        <div aria-live="polite">
          <progress
            className="w-full"
            max={Math.max(1, preview?.counts["change"] ?? 1)}
            value={progress}
          />
          <p className="mt-1 text-sm">
            Applying… {progress} of {preview?.counts["change"]} (keep this page open)
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3" aria-live="polite">
          <Banner kind={summary("failed") ? "error" : "success"}>
            {summary("applied")} applied · {summary("unchanged")} unchanged · {summary("skipped")}{" "}
            skipped · {summary("failed")} failed
          </Banner>
          {results.some((r) => r.result === "skipped" || r.result === "failed") && (
            <ul className="max-h-48 overflow-auto text-xs">
              {results
                .filter((r) => r.result === "skipped" || r.result === "failed")
                .map((r) => (
                  <li key={r.slug}>
                    <strong>{r.slug}</strong> — {r.result}: {r.reasons?.join("; ")}
                  </li>
                ))}
            </ul>
          )}
          {opId && !undo && summary("applied") > 0 && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => setConfirmUndo(true)}
              disabled={busy}
            >
              {busy ? "Undoing…" : "Undo this operation"}
            </button>
          )}
          {undo && (
            <p className="text-sm">
              Undo: {undo.restored} restored, {undo.conflict} kept because they were edited since
              {undo.blocked
                ? `, ${undo.blocked} left noindex because they do not pass the indexing gate (G1–G10)`
                : ""}
              .
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmUndo}
        title={`Undo "${action.replace(/_/g, " ")}" on ${summary("applied").toLocaleString()} tools?`}
        description={undoDescription(action.replace(/_/g, " "), summary("applied"))}
        confirmLabel={`Undo ${summary("applied").toLocaleString()} changes`}
        destructive
        busy={busy}
        {...(summary("applied") > TYPE_TO_CONFIRM ? { confirmText: "undo" } : {})}
        onConfirm={undoAll}
        onCancel={() => setConfirmUndo(false)}
      />
    </section>
  );
}

type Op = {
  id: string;
  actor_email: string;
  action: string;
  summary: string;
  applied: number;
  skipped: number;
  failed: number;
  status: string;
  created_at: string;
  undoable: number;
};

/** Recent bulk operations with an Undo button for each one that still has undoable changes. */
export function BulkHistory({ onChanged }: { onChanged: () => void }) {
  const ops = useAsync(() => api.get<{ items: Op[] }>(`bulk/operations${qs({ limit: 20 })}`), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);
  async function undo(id: string) {
    setConfirmOp(null);
    setBusy(id);
    let restored = 0;
    let conflict = 0;
    try {
      for (let g = 0; g < 1000; g++) {
        const r = await api.post<{ results: Result[]; remaining: number }>(
          `bulk/operations/${id}/undo`,
          {},
        );
        restored += r.results.filter((x) => x.result === "restored").length;
        conflict += r.results.filter((x) => x.result === "conflict").length;
        if (r.remaining <= 0 || !r.results.length) break;
      }
      setMsg(`Undone: ${restored} restored, ${conflict} kept (edited since).`);
      ops.reload();
      onChanged();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  if (!ops.data?.items.length) return null;
  return (
    <details className={card}>
      <summary className="cursor-pointer text-sm font-bold">Recent bulk operations</summary>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
      <ul className="mt-3 divide-y divide-primary/10 text-sm">
        {ops.data.items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <div className="font-semibold">{o.summary}</div>
              <div className="text-xs text-muted-foreground">
                {fmtDate(o.created_at)} · {o.actor_email} · {o.applied} applied, {o.skipped}{" "}
                skipped, {o.failed} failed · {o.status}
              </div>
            </div>
            {o.undoable > 0 && o.status !== "running" && (
              <button
                type="button"
                className={btnGhost}
                disabled={busy === o.id}
                onClick={() => setConfirmOp(o)}
              >
                {busy === o.id ? "Undoing…" : `Undo (${o.undoable})`}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirmOp}
        title={confirmOp ? `Undo "${confirmOp.summary}"?` : ""}
        description={
          confirmOp ? undoDescription(confirmOp.summary, Number(confirmOp.undoable)) : ""
        }
        confirmLabel={
          confirmOp ? `Undo ${Number(confirmOp.undoable).toLocaleString()} changes` : "Undo"
        }
        destructive
        busy={!!busy}
        {...(confirmOp && Number(confirmOp.undoable) > TYPE_TO_CONFIRM
          ? { confirmText: "undo" }
          : {})}
        onConfirm={() => confirmOp && void undo(confirmOp.id)}
        onCancel={() => setConfirmOp(null)}
      />
    </details>
  );
}
