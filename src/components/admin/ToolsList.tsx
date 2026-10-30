import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, qs } from "./client";
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
  updated_at: string;
};
type List = { items: Row[]; total: number; page: number; pageSize: number };
type Cats = { items: { id: string; name: string }[] };

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
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, status, review, category, indexing]);
  const cats = useAsync(() => api.get<Cats>("categories"), []);
  const list = useAsync(
    () =>
      api.get<List>(
        `tools${qs({ q: dq, status, review: review && "1", category, indexing, page, pageSize: 25 })}`,
      ),
    [dq, status, review, category, indexing, page],
  );
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const filtered = !!(q || status || review || category || indexing);
  const clear = () => {
    setQ("");
    setStatus("");
    setReview(false);
    setCategory("");
    setIndexing("");
  };
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
                  <tr key={r.id}>
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
                    <td className="px-4 py-3">{r.indexing === "index" ? "Yes" : "No"}</td>
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
