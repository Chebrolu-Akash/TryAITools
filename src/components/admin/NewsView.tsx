// Admin: AI News. Overview (totals, cost, recent runs and failures, "Run now"), Sources (enable/disable, priority) and
// Articles (filter by status; unpublish, republish, feature, retry, delete). Every action goes through /api/admin/news,
// which re-checks Access, CSRF and the allowed state transitions on the server.
import { useState } from "react";
import { ExternalLink, Play, RefreshCw } from "lucide-react";
import { api, qs } from "./client";
import {
  Banner,
  btnDanger,
  btnGhost,
  btnPrimary,
  card,
  ConfirmDialog,
  EmptyState,
  errorMessage,
  fmtDate,
  inputCls,
  LoadingBlock,
  PageHeader,
  useAsync,
  useDebounced,
  useToast,
} from "./ui";

type Key =
  | "at"
  | "canonical_url"
  | "category"
  | "collected_at"
  | "consecutive_failures"
  | "cost_usd"
  | "coverage_count"
  | "duplicates"
  | "enabled"
  | "error"
  | "failed"
  | "failing"
  | "featured"
  | "feed_url"
  | "id"
  | "input_tokens"
  | "items_new"
  | "kind"
  | "last_error"
  | "last_success_at"
  | "message"
  | "name"
  | "notes"
  | "original_title"
  | "output_tokens"
  | "pending"
  | "priority"
  | "published"
  | "robots_status"
  | "runs"
  | "skipped"
  | "slug"
  | "source_id"
  | "source_name"
  | "sources_checked"
  | "stage"
  | "started_at"
  | "status"
  | "title"
  | "total"
  | "trigger"
  | "updated_at";
/** API rows: the columns the screens read (all optional, values unchecked). */
type Row = Partial<Record<Key, unknown>>;
type Stats = {
  articles: Row;
  sources: Row;
  last30Days: Row;
  runs: Row[];
  failures: Row[];
};
type RunReport = {
  status: string;
  skipped?: string;
  sourcesChecked: number;
  itemsNew: number;
  duplicates: number;
  published: number;
  failed: number;
  skippedItems: number;
  costUsd: number;
  notes: string[];
};
type Tab = "overview" | "sources" | "articles";
type ArticleAction = "unpublish" | "republish" | "feature" | "unfeature" | "retry" | "delete";

const n = (v: unknown) => Number(v ?? 0);
const usd = (v: unknown) => `$${n(v).toFixed(n(v) < 1 ? 4 : 2)}`;
const STATUS_TONE: Record<string, string> = {
  published: "bg-green-600/15 text-green-700 dark:text-green-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-destructive/10 text-destructive",
  skipped: "bg-muted text-muted-foreground",
  unpublished: "bg-muted text-muted-foreground",
  ok: "bg-green-600/15 text-green-700 dark:text-green-300",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  running: "bg-primary/10 text-primary",
};
const Badge = ({ s }: { s: string }) => (
  <span
    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_TONE[s] ?? STATUS_TONE["skipped"]}`}
  >
    {s}
  </span>
);

export function NewsView() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI News"
        description="Collected from the sources below every 3 hours, deduplicated and summarised by Google Gemini (free tier). Published articles appear on /news."
      />
      <div role="tablist" aria-label="AI News sections" className="flex gap-2">
        {(["overview", "sources", "articles"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "border border-primary/20 hover:text-primary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "sources" && <Sources />}
      {tab === "articles" && <Articles />}
    </div>
  );
}

function Overview() {
  const stats = useAsync(() => api.get<Stats>("news/stats"), []);
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.post<{ report: RunReport }>("news/run", {});
      setLast(r.report);
      toast.success(`Run finished: ${r.report.published} published`);
      stats.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  if (stats.loading && !stats.data) return <LoadingBlock label="Loading AI News statistics" />;
  if (stats.error || !stats.data) return <Banner kind="error">{errorMessage(stats.error)}</Banner>;
  const { articles: a, sources: s, last30Days: c, runs, failures } = stats.data;
  const tiles: [string, string][] = [
    ["Published", String(n(a.published))],
    ["Pending", String(n(a.pending))],
    ["Failed", String(n(a.failed))],
    ["Skipped", String(n(a.skipped))],
    ["Sources enabled", `${n(s.enabled)} / ${n(s.total)}`],
    ["Cost (30 days)", usd(c.cost_usd)],
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} onClick={runNow} disabled={running}>
          <Play className="h-4 w-4" /> {running ? "Running… (up to a few minutes)" : "Run now"}
        </button>
        <button type="button" className={btnGhost} onClick={stats.reload}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        {n(s.failing) > 0 && (
          <span className="text-sm font-semibold text-destructive">
            {n(s.failing)} source(s) failing 3+ times in a row
          </span>
        )}
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {last && (
        <Banner
          kind={last.skipped || last.status === "failed" ? "error" : "success"}
          onClose={() => setLast(null)}
        >
          {last.skipped ??
            `Run ${last.status}: ${last.sourcesChecked} sources checked, ${last.itemsNew} new, ${last.duplicates} duplicates, ${last.published} published, ${last.failed} failed, ${last.skippedItems} skipped, cost ${usd(last.costUsd)}.`}
          {last.notes.length > 0 && <div className="mt-1 text-xs">{last.notes.join(" · ")}</div>}
        </Banner>
      )}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className={card}>
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-extrabold">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Last 30 days: {n(c.runs)} runs, {n(c.input_tokens).toLocaleString()} input /{" "}
        {n(c.output_tokens).toLocaleString()} output tokens.
      </p>
      <section className={card}>
        <h2 className="text-lg font-bold">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  {[
                    "Started",
                    "Trigger",
                    "Status",
                    "Sources",
                    "New",
                    "Dupes",
                    "Published",
                    "Failed",
                    "Cost",
                    "Note",
                  ].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={String(r.id)} className="border-t border-primary/10">
                    <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(r.started_at)}</td>
                    <td className="px-2 py-1.5">{String(r.trigger)}</td>
                    <td className="px-2 py-1.5">
                      <Badge s={String(r.status)} />
                    </td>
                    <td className="px-2 py-1.5">{n(r.sources_checked)}</td>
                    <td className="px-2 py-1.5">{n(r.items_new)}</td>
                    <td className="px-2 py-1.5">{n(r.duplicates)}</td>
                    <td className="px-2 py-1.5">{n(r.published)}</td>
                    <td className="px-2 py-1.5">{n(r.failed)}</td>
                    <td className="px-2 py-1.5">{usd(r.cost_usd)}</td>
                    <td
                      className="max-w-xs truncate px-2 py-1.5 text-xs text-muted-foreground"
                      title={String(r.error ?? "")}
                    >
                      {String(r.error ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className={card}>
        <h2 className="text-lg font-bold">Recent failures</h2>
        {failures.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {failures.map((f) => (
              <li key={String(f.id)} className="border-t border-primary/10 pt-2">
                <span className="font-semibold">{String(f.source_id ?? "—")}</span>{" "}
                <span className="rounded bg-muted px-1.5 text-xs">{String(f.stage)}</span>{" "}
                <span className="text-muted-foreground">{fmtDate(f.at)}</span>
                <div className="text-xs text-muted-foreground">{String(f.message)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Sources() {
  const list = useAsync(() => api.get<{ sources: Row[] }>("news/sources"), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const update = async (s: Row, patch: { enabled?: boolean; priority?: number }) => {
    setBusy(String(s.id));
    try {
      await api.put(`news/sources/${String(s.id)}`, { ...patch, updated_at: s.updated_at });
      toast.success("Saved");
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const fetchOne = async (s: Row) => {
    setBusy(String(s.id));
    try {
      const r = await api.post<{ report: RunReport }>("news/run", { source_ids: [String(s.id)] });
      toast.success(
        r.report.skipped ?? `${r.report.itemsNew} new, ${r.report.published} published`,
      );
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (list.loading && !list.data) return <LoadingBlock label="Loading sources" />;
  if (list.error || !list.data) return <Banner kind="error">{errorMessage(list.error)}</Banner>;
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            {[
              "Source",
              "Enabled",
              "Priority",
              "robots.txt",
              "Last success",
              "Published",
              "Last error",
              "",
            ].map((h) => (
              <th key={h} className="px-2 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.data.sources.map((s) => (
            <tr key={String(s.id)} className="border-t border-primary/10 align-top">
              <td className="px-2 py-2">
                <div className="font-semibold">{String(s.name)}</div>
                <a
                  href={String(s.feed_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  feed <ExternalLink className="h-3 w-3" />
                </a>{" "}
                <span className="text-xs text-muted-foreground">{String(s.kind)}</span>
                {s.notes ? (
                  <div className="max-w-xs text-xs text-muted-foreground">{String(s.notes)}</div>
                ) : null}
              </td>
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  aria-label={`Enable ${String(s.name)}`}
                  checked={n(s.enabled) === 1}
                  disabled={busy === s.id}
                  onChange={(e) => update(s, { enabled: e.target.checked })}
                />
              </td>
              <td className="px-2 py-2">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  defaultValue={n(s.priority)}
                  aria-label={`Priority of ${String(s.name)}`}
                  className={`${inputCls} w-20`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isInteger(v) && v !== n(s.priority)) update(s, { priority: v });
                  }}
                />
              </td>
              <td className="px-2 py-2">
                <Badge s={String(s.robots_status)} />
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-xs">{fmtDate(s.last_success_at)}</td>
              <td className="px-2 py-2">{n(s.published)}</td>
              <td className="max-w-xs px-2 py-2 text-xs text-destructive">
                {s.last_error ? `${String(s.last_error)} (${n(s.consecutive_failures)}×)` : ""}
              </td>
              <td className="px-2 py-2">
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy === s.id}
                  onClick={() => fetchOne(s)}
                >
                  Fetch now
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Lower priority numbers are fetched first when several sources are due. robots.txt is
        re-checked daily; a source whose robots.txt disallows automated access (or AI use) is
        skipped automatically.
      </p>
    </div>
  );
}

const ACTION_COPY: Record<
  ArticleAction,
  { label: string; title: string; text: string; destructive?: boolean }
> = {
  unpublish: {
    label: "Unpublish",
    title: "Unpublish this article?",
    text: "It disappears from /news. You can republish it later.",
    destructive: true,
  },
  republish: {
    label: "Republish",
    title: "Republish this article?",
    text: "It appears on /news again.",
  },
  feature: {
    label: "Feature",
    title: "Feature this article?",
    text: "It is marked as an editor's pick and ranked first in Trending.",
  },
  unfeature: { label: "Unfeature", title: "Remove from featured?", text: "It stays published." },
  retry: {
    label: "Retry",
    title: "Retry the summary?",
    text: "Gemini summarises this item again now (one free-tier API call).",
  },
  delete: {
    label: "Delete",
    title: "Delete this article?",
    text: "Its summary is removed for good. Its URL is remembered so the same item is not collected again.",
    destructive: true,
  },
};
const actionsFor = (status: string, featured: boolean): ArticleAction[] =>
  status === "published"
    ? [featured ? "unfeature" : "feature", "unpublish", "delete"]
    : status === "unpublished"
      ? ["republish", "delete"]
      : ["retry", "delete"];

function Articles() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useAsync(
    () =>
      api.get<{ items: Row[]; hasMore: boolean }>(`news/articles${qs({ status, q: dq, page })}`),
    [status, dq, page],
  );
  const toast = useToast();
  const [pending, setPending] = useState<{ row: Row; action: ArticleAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.post<{ report?: RunReport }>(
        `news/articles/${String(pending.row.id)}/action`,
        {
          action: pending.action,
          updated_at: pending.row.updated_at,
        },
      );
      toast.success(
        pending.action === "retry" && r.report
          ? r.report.published
            ? "Summarised and published"
            : `Not published: ${r.report.skipped ?? "see the error column"}`
          : "Done",
      );
      setPending(null);
      list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Status"
          className={`${inputCls} w-44`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {["published", "pending", "failed", "skipped", "unpublished"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search articles"
          placeholder="Search headline or source…"
          className={`${inputCls} max-w-xs`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.loading && !list.data ? (
        <LoadingBlock label="Loading articles" />
      ) : list.error || !list.data ? (
        <Banner kind="error">{errorMessage(list.error)}</Banner>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="No articles"
          text="Nothing matches, or nothing has been collected yet. Use Run now on the Overview tab."
        />
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {["Article", "Status", "Source", "Collected", "Cost", ""].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((r) => {
                const st = String(r.status);
                return (
                  <tr key={String(r.id)} className="border-t border-primary/10 align-top">
                    <td className="max-w-md px-2 py-2">
                      <div className="font-semibold">
                        {st === "published" && r.slug ? (
                          <a
                            href={`/news/${String(r.slug)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary"
                          >
                            {String(r.title)}
                          </a>
                        ) : (
                          String(r.title ?? r.original_title)
                        )}
                        {n(r.featured) === 1 && (
                          <span className="ml-2 text-xs font-bold text-primary">★ featured</span>
                        )}
                      </div>
                      <a
                        href={String(r.canonical_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary"
                      >
                        original ↗
                      </a>
                      {n(r.coverage_count) > 1 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {n(r.coverage_count)} sources
                        </span>
                      )}
                      {r.last_error ? (
                        <div className="mt-1 text-xs text-destructive">{String(r.last_error)}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Badge s={st} />
                      {r.category ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {String(r.category)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs">{String(r.source_name)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs">
                      {fmtDate(r.collected_at)}
                    </td>
                    <td className="px-2 py-2 text-xs">{usd(r.cost_usd)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {actionsFor(st, n(r.featured) === 1).map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={ACTION_COPY[a].destructive ? btnDanger : btnGhost}
                            onClick={() => setPending({ row: r, action: a })}
                          >
                            {ACTION_COPY[a].label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              className={btnGhost}
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Newer
            </button>
            <span className="text-xs text-muted-foreground">Page {page}</span>
            <button
              type="button"
              className={btnGhost}
              disabled={!list.data.hasMore}
              onClick={() => setPage(page + 1)}
            >
              Older
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        title={pending ? ACTION_COPY[pending.action].title : ""}
        description={pending ? ACTION_COPY[pending.action].text : ""}
        confirmLabel={pending ? ACTION_COPY[pending.action].label : ""}
        destructive={pending ? !!ACTION_COPY[pending.action].destructive : false}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
