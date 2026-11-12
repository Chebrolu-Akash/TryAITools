import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AdminApiError, api, qs } from "./client";
import {
  Banner,
  btnGhost,
  btnPrimary,
  EmptyState,
  errorMessage,
  fmtDate,
  inputCls,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  useAsync,
  useDebounced,
} from "./ui";
import type { Nav } from "./AdminApp";
import { BulkEditor, BulkHistory, type Cat } from "./BulkTools";

const SELECTION_KEY = "tryaitools-admin-tool-selection";

type Row = {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  category_name: string;
  subcategory: string | null;
  status: string;
  indexing: string;
  needs_review: number;
  import_issue: string | null;
  review_status?: string;
  url_status?: string | null;
  updated_at: string;
};
type List = { items: Row[]; total: number; page: number; pageSize: number };
type Cats = { items: Cat[] };

export function ToolsList({
  nav,
  initial,
}: {
  nav: Nav;
  initial: { status?: string | undefined; review?: string | undefined };
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initial.status ?? "");
  const [review, setReview] = useState(initial.review === "1");
  const [category, setCategory] = useState("");
  const [indexing, setIndexing] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [subcategory, setSubcategory] = useState("");
  // the selection survives paging and filter changes; "select all matching" loads every matching slug from the server
  // Kept for this browser tab (sessionStorage), so a refresh does not lose a large selection. Storage may be blocked
  // (private mode, policies): then the selection simply lives in memory.
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const raw =
        typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SELECTION_KEY) : null;
      const list: unknown = raw ? JSON.parse(raw) : [];
      return new Set(
        Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [],
      );
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      if (selected.size) sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...selected]));
      else sessionStorage.removeItem(SELECTION_KEY);
    } catch {
      // storage unavailable: keep the selection in memory only
    }
  }, [selected]);
  const [selecting, setSelecting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selErr, setSelErr] = useState<unknown>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  /** Adds pasted slugs (comma, space or newline separated) to the selection; unknown slugs show up in the preview. */
  const addPasted = () => {
    const slugs = pasted
      .split(/[\s,]+/)
      .map((s) =>
        s
          .trim()
          .replace(/^\/?tools\//, "")
          .toLowerCase(),
      )
      .filter((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s));
    setSelected(new Set([...selected, ...slugs]));
    setPasted("");
    setPasteOpen(false);
  };
  const [drafting, setDrafting] = useState<{
    done: number;
    total: number;
    ready: number;
    manual: number;
    stopped: string | null;
    errors: { slug: string; message: string }[];
  } | null>(null);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status, review, category, indexing, reviewStatus, subcategory]);
  useEffect(() => setSubcategory(""), [category]);
  const cats = useAsync(() => api.get<Cats>("categories"), []);
  const filters = {
    q: dq,
    status,
    review: review && "1",
    category,
    indexing,
    review_status: reviewStatus,
    subcategory,
  };
  const list = useAsync(
    () => api.get<List>(`tools${qs({ ...filters, page, pageSize: 25 })}`),
    [dq, status, review, category, indexing, reviewStatus, subcategory, page],
  );
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = !!(q || status || review || category || indexing || reviewStatus || subcategory);
  const clear = () => {
    setQ("");
    setStatus("");
    setReview(false);
    setCategory("");
    setIndexing("");
    setReviewStatus("");
    setSubcategory("");
  };
  const pageSlugs = d?.items.map((r) => r.slug) ?? [];
  const allOnPage = pageSlugs.length > 0 && pageSlugs.every((s) => selected.has(s));
  const toggle = (slug: string, on: boolean) => {
    const n = new Set(selected);
    if (on) n.add(slug);
    else n.delete(slug);
    setSelected(n);
  };
  const togglePage = (on: boolean) => {
    const n = new Set(selected);
    for (const s of pageSlugs) {
      if (on) n.add(s);
      else n.delete(s);
    }
    setSelected(n);
  };
  /** Generates grounded drafts one tool at a time (Gemini free tier); stops at the first quota or configuration error. */
  async function generateDrafts() {
    const slugs = [...selected];
    const st = {
      done: 0,
      total: slugs.length,
      ready: 0,
      manual: 0,
      stopped: null as string | null,
      errors: [] as { slug: string; message: string }[],
    };
    let lastError = "";
    let repeats = 0;
    setDrafting({ ...st, errors: [] });
    for (const s of slugs) {
      try {
        const r = await api.post<{ status: string }>(`tools/${encodeURIComponent(s)}/draft`, {});
        if (r.status === "draft_ready") st.ready++;
        else st.manual++;
      } catch (e) {
        // nothing was saved for this tool: show the exact error (HTTP status, code, message)
        const msg = (e instanceof AdminApiError ? `${e.status} ${e.code}: ` : "") + errorMessage(e);
        st.errors.push({ slug: s, message: msg });
        repeats = msg === lastError ? repeats + 1 : 1;
        lastError = msg;
        const fatal =
          e instanceof AdminApiError &&
          ["ai_quota", "ai_config", "ai_not_configured"].includes(e.code);
        if (fatal || repeats >= 3) {
          st.done++;
          st.stopped = fatal ? msg : `the same error 3 times in a row: ${msg}`;
          setDrafting({ ...st, errors: [...st.errors] });
          break;
        }
      }
      st.done++;
      setDrafting({ ...st, errors: [...st.errors] });
    }
    list.reload();
  }
  async function selectAllMatching() {
    setSelecting(true);
    setSelErr(null);
    try {
      const r = await api.get<{ slugs: string[]; capped: boolean }>(`bulk/select${qs(filters)}`);
      setSelected(new Set([...selected, ...r.slugs]));
      if (r.capped) setSelErr(new Error("Only the first 5,000 matching tools were selected."));
    } catch (e) {
      setSelErr(e);
    } finally {
      setSelecting(false);
    }
  }
  const subOptions = cats.data?.items.find((c) => c.id === category)?.subcategories ?? [];
  const newTool = (
    <button type="button" className={btnPrimary} onClick={() => nav({ view: "tools", new: "1" })}>
      <Plus className="h-4 w-4" /> New tool
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tools"
        description="Every tool in the admin database. New tools start as drafts."
        actions={newTool}
      />
      <div className="flex flex-wrap items-end gap-3 rounded-3xl border border-primary/10 bg-card p-4 shadow-card">
        <label className="min-w-[14rem] flex-1 text-sm font-semibold">
          Search
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, slug or website"
            className={`${inputCls} mt-1 font-normal`}
            maxLength={100}
          />
        </label>
        <label className="text-sm font-semibold">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${inputCls} mt-1 font-normal`}
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="review">In review</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputCls} mt-1 font-normal`}
          >
            <option value="">All</option>
            {cats.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Indexing
          <select
            value={indexing}
            onChange={(e) => setIndexing(e.target.value)}
            className={`${inputCls} mt-1 font-normal`}
          >
            <option value="">All</option>
            <option value="index">Allowed</option>
            <option value="noindex">Off</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Review
          <select
            value={reviewStatus}
            onChange={(e) => setReviewStatus(e.target.value)}
            className={`${inputCls} mt-1 font-normal`}
          >
            <option value="">All</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="draft_ready">Draft ready</option>
            <option value="reviewed">Reviewed</option>
            <option value="needs_manual">Needs manual check</option>
          </select>
        </label>
        {category && subOptions.length > 0 && (
          <label className="text-sm font-semibold">
            Subcategory
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className={`${inputCls} mt-1 font-normal`}
            >
              <option value="">All</option>
              {subOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />{" "}
          Flagged only
        </label>
        {filtered && (
          <button type="button" className={btnGhost} onClick={clear}>
            Clear filters
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        <span className="font-semibold">{selected.size.toLocaleString()} selected</span>
        {d && d.total > 0 && (
          <button
            type="button"
            className={btnGhost}
            onClick={selectAllMatching}
            disabled={selecting}
          >
            {selecting ? "Selecting…" : `Select all ${d.total.toLocaleString()} matching`}
          </button>
        )}
        <button type="button" className={btnGhost} onClick={() => setPasteOpen((o) => !o)}>
          Select by slugs
        </button>
        {selected.size > 0 && (
          <>
            <button type="button" className={btnGhost} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
            <button type="button" className={btnPrimary} onClick={() => setBulkOpen(true)}>
              Bulk edit
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={!!drafting && drafting.done < drafting.total && !drafting.stopped}
              onClick={generateDrafts}
              title="Reads each tool's official pages and drafts grounded content for review. Nothing is published."
            >
              Generate AI drafts ({selected.size})
            </button>
          </>
        )}
      </div>
      {pasteOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-3xl border border-primary/10 bg-card p-4 shadow-card">
          <label className="min-w-[16rem] flex-1 text-sm font-semibold">
            Paste tool slugs (separated by commas, spaces or new lines)
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={3}
              className={`${inputCls} mt-1 font-normal`}
              placeholder="frase, deepl-write, surfer-seo"
            />
          </label>
          <button
            type="button"
            className={btnPrimary}
            onClick={addPasted}
            disabled={!pasted.trim()}
          >
            Add to selection
          </button>
        </div>
      )}
      {!!selErr && <Banner kind="error">{errorMessage(selErr)}</Banner>}
      {drafting && (
        <Banner kind={drafting.stopped ? "error" : "info"} onClose={() => setDrafting(null)}>
          Drafts: {drafting.done} of {drafting.total} · {drafting.ready} ready for review ·{" "}
          {drafting.manual} need manual work
          {drafting.errors.length ? ` · ${drafting.errors.length} failed (nothing saved)` : ""}
          {drafting.stopped
            ? ` · stopped: ${drafting.stopped}`
            : drafting.done < drafting.total
              ? " · working…"
              : " · done"}
          {drafting.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {drafting.errors.map((x) => (
                <li key={x.slug}>
                  <strong>{x.slug}</strong>: {x.message}
                </li>
              ))}
            </ul>
          )}
        </Banner>
      )}
      {bulkOpen && cats.data && (
        <BulkEditor
          slugs={[...selected]}
          cats={cats.data.items}
          onClose={() => setBulkOpen(false)}
          onApplied={list.reload}
        />
      )}
      <BulkHistory onChanged={list.reload} />

      {list.error ? (
        <Banner kind="error">
          {errorMessage(list.error)}{" "}
          <button className="font-bold underline" onClick={list.reload}>
            Retry
          </button>
        </Banner>
      ) : list.loading && !d ? (
        <LoadingBlock label="Loading tools…" />
      ) : d && d.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No tools match these filters"
            action={
              <button type="button" className={btnGhost} onClick={clear}>
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            title="No tools yet"
            text="Create your first tool, or import the existing catalogue into this database."
            action={newTool}
          />
        )
      ) : d ? (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {d.total.toLocaleString()} tool{d.total === 1 ? "" : "s"}
            {list.loading ? " · updating…" : ""}
          </p>
          <div className="overflow-x-auto rounded-3xl border border-primary/10 bg-card shadow-card">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Tools</caption>
              <thead className="bg-accent/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all tools on this page"
                      checked={allOnPage}
                      onChange={(e) => togglePage(e.target.checked)}
                    />
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Tool
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Index
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Updated
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/10">
                {d.items.map((r) => (
                  <tr key={r.id} className={selected.has(r.slug) ? "bg-primary/5" : ""}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        checked={selected.has(r.slug)}
                        onChange={(e) => toggle(r.slug, e.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{r.name}</div>
                      <div className="text-xs text-muted-foreground">/{r.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.category_name}
                      {r.subcategory ? (
                        <div className="text-xs text-muted-foreground">{r.subcategory}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                      {r.needs_review ? (
                        <div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          Needs review{r.import_issue ? ` (${r.import_issue})` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {r.indexing === "index" ? "Yes" : "No"}
                      {r.review_status && r.review_status !== "unreviewed" ? (
                        <div className="text-xs text-muted-foreground">
                          {r.review_status.replace("_", " ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmtDate(r.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className={btnGhost}
                        onClick={() => nav({ view: "tools", slug: r.slug })}
                        aria-label={`Edit ${r.name}`}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className={btnGhost}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className={btnGhost}
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
