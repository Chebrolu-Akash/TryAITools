import { FileText, FolderTree, Plus, ShieldAlert, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { api } from "./client";
import {
  Banner,
  btnGhost,
  btnPrimary,
  card,
  errorMessage,
  fmtDate,
  LoadingBlock,
  PageHeader,
  useAsync,
} from "./ui";
import type { Nav } from "./AdminApp";

type Stats = {
  tools: {
    total: number;
    published: number;
    draft: number;
    review: number;
    archived: number;
    needs_review: number;
    indexable: number;
  };
  categories: { total: number };
  blog: {
    available: boolean;
    total?: number;
    published?: number;
    draft?: number;
    archived?: number;
  };
  recent: {
    at: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string;
    summary: string;
  }[];
};

function BigStat({
  label,
  value,
  detail,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: number | string;
  detail?: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${card} flex items-start justify-between gap-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <span>
        <span className="block text-sm font-semibold text-muted-foreground">{label}</span>
        <span className="mt-1 block text-4xl font-extrabold tracking-tight text-foreground">
          {value}
        </span>
        {detail && <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className="rounded-2xl bg-primary/10 p-2.5 text-primary">
        <Icon className="h-5 w-5" />
      </span>
    </button>
  );
}

function MiniStat({
  label,
  value,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  onClick?: () => void;
  tone?: string;
}) {
  const inner = (
    <>
      <span className={`block text-2xl font-extrabold ${tone ?? "text-foreground"}`}>{value}</span>
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-primary/10 bg-background px-4 py-3 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {inner}
    </button>
  ) : (
    <div className="rounded-2xl border border-primary/10 bg-background px-4 py-3">{inner}</div>
  );
}

/** Where an audit entry points to, if the record can still be opened. */
const linkFor = (r: Stats["recent"][number]) =>
  r.action.endsWith(".delete")
    ? null
    : r.entity_type === "tool"
      ? { view: "tools" as const, slug: r.entity_id }
      : r.entity_type === "post"
        ? { view: "blog" as const, slug: r.entity_id }
        : r.entity_type === "category"
          ? { view: "categories" as const }
          : null;

export function Dashboard({ nav }: { nav: Nav }) {
  const { data, error, loading, reload } = useAsync(() => api.get<Stats>("stats"), []);
  const header = (
    <PageHeader
      title="Dashboard"
      description="Live counts from the admin database. The public website reads the same database: publishing, unpublishing or archiving a tool or category shows up on the site on the next page load."
    />
  );
  if (loading && !data)
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock label="Loading dashboard…" rows={4} />
      </div>
    );
  if (error || !data)
    return (
      <div className="space-y-6">
        {header}
        <Banner kind="error">
          {errorMessage(error)}{" "}
          <button className="font-bold underline" onClick={reload}>
            Retry
          </button>
        </Banner>
      </div>
    );
  const t = data.tools;
  return (
    <div className="space-y-6">
      {header}

      <section aria-label="Quick actions" className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => nav({ view: "tools", new: "1" })}
        >
          <Plus className="h-4 w-4" /> New tool
        </button>
        {data.blog.available && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => nav({ view: "blog", new: "1" })}
          >
            <Plus className="h-4 w-4" /> New blog post
          </button>
        )}
        <button
          type="button"
          className={btnGhost}
          onClick={() => nav({ view: "categories", new: "1" })}
        >
          <Plus className="h-4 w-4" /> New category
        </button>
        {t.needs_review > 0 && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => nav({ view: "tools", review: "1" })}
          >
            <ShieldAlert className="h-4 w-4 text-amber-600" /> Review {t.needs_review} flagged
          </button>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <BigStat
          label="Tools"
          value={t.total.toLocaleString()}
          detail={`${t.published} published · ${t.draft} drafts`}
          icon={Wrench}
          onClick={() => nav({ view: "tools" })}
        />
        <BigStat
          label="Categories"
          value={data.categories.total}
          icon={FolderTree}
          onClick={() => nav({ view: "categories" })}
        />
        {data.blog.available ? (
          <BigStat
            label="Blog posts"
            value={data.blog.total ?? 0}
            detail={`${data.blog.published ?? 0} published · ${data.blog.draft ?? 0} drafts`}
            icon={FileText}
            onClick={() => nav({ view: "blog" })}
          />
        ) : (
          <div className={card}>
            <div className="text-sm font-semibold text-muted-foreground">Blog posts</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Not available: migration <code>0002_blog.sql</code> has not been applied to this
              database.
            </p>
          </div>
        )}
      </div>

      <section className={card} aria-labelledby="status-h">
        <h2 id="status-h" className="text-lg font-extrabold">
          Tools by status
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat
            label="Published"
            value={t.published}
            tone="text-green-700 dark:text-green-300"
            onClick={() => nav({ view: "tools", status: "published" })}
          />
          <MiniStat
            label="Drafts"
            value={t.draft}
            onClick={() => nav({ view: "tools", status: "draft" })}
          />
          <MiniStat
            label="In review"
            value={t.review}
            onClick={() => nav({ view: "tools", status: "review" })}
          />
          <MiniStat
            label="Flagged"
            value={t.needs_review}
            tone="text-amber-700 dark:text-amber-300"
            onClick={() => nav({ view: "tools", review: "1" })}
          />
          <MiniStat
            label="Archived"
            value={t.archived}
            onClick={() => nav({ view: "tools", status: "archived" })}
          />
          <MiniStat label="Indexable" value={t.indexable} />
        </div>
      </section>

      <section className={card} aria-labelledby="recent-h">
        <h2 id="recent-h" className="text-lg font-extrabold">
          Recent activity
        </h2>
        {data.recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No admin changes recorded yet. Every create, edit, publish and delete will appear here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-primary/10 text-sm">
            {data.recent.map((r, i) => {
              const to = linkFor(r);
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="mr-2 rounded-full bg-accent px-2 py-0.5 font-mono text-xs">
                      {r.action}
                    </span>
                    {to ? (
                      <button
                        type="button"
                        className="text-left font-semibold hover:text-primary hover:underline"
                        onClick={() => nav(to)}
                      >
                        {r.summary}
                      </button>
                    ) : (
                      <span>{r.summary}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.actor_email} · {fmtDate(r.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
