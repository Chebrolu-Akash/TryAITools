import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Page } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { fetchToolsPage } from "@/lib/catalog/api";
import type { PublicTool } from "@/lib/catalog/model";
import { pageHead } from "@/lib/seo";
import { shortName } from "@/lib/tool-utils";

type ToolsSearch = { q?: string | undefined; category?: string | undefined };

// Search, filtering and paging run on the server (src/lib/catalog/reader.ts): the browser receives 48 tools at a time.
export const Route = createFileRoute("/tools/")({
  validateSearch: (s: Record<string, unknown>): ToolsSearch => ({
    ...(typeof s["q"] === "string" && s["q"] ? { q: s["q"].slice(0, 100) } : {}),
    ...(typeof s["category"] === "string" && s["category"]
      ? { category: s["category"].slice(0, 80) }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ q: search.q ?? "", category: search.category ?? "" }),
  loader: ({ deps }) => fetchToolsPage({ data: { ...deps, page: 1 } }),
  head: () =>
    pageHead({
      title: "All AI Tools — Search & Filter | TryAITools",
      description: "Search and filter more than 2,000 AI tools across 15 categories.",
      path: "/tools",
    }),
  component: ToolsPage,
});

function ToolsPage() {
  const search = Route.useSearch();
  const first = Route.useLoaderData();
  const navigate = useNavigate({ from: "/tools/" });
  const [q, setQ] = useState(search.q ?? "");
  const [items, setItems] = useState<PublicTool[]>(first.items);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  // A new first page (new search or category) replaces what "Load more" appended.
  useEffect(() => {
    setItems(first.items);
    setPage(1);
    setMoreError(false);
  }, [first]);
  useEffect(() => setQ(search.q ?? ""), [search.q]);

  // Typing updates the URL (and so the server query) after a short pause.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => {
      const next = q.trim();
      void navigate({
        search: (s: ToolsSearch) => ({ ...s, q: next || undefined }),
        replace: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, navigate]);

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(false);
    try {
      const next = await fetchToolsPage({
        data: { q: first.q, category: first.category, page: page + 1 },
      });
      setItems((prev) => [...prev, ...next.items]);
      setPage(next.page);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h1 className="text-4xl font-bold">All AI Tools</h1>
          <p className="mt-2 text-foreground/70" aria-live="polite">
            {first.total.toLocaleString()} tools found
          </p>
          <div className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-background p-2 shadow-soft">
            <Search className="ml-3 h-5 w-5 text-muted-foreground" />
            <input
              value={q}
              maxLength={100}
              onChange={(e) => {
                typed.current = true;
                setQ(e.target.value);
              }}
              placeholder="Search by name or use case…"
              aria-label="Search AI tools"
              className="flex-1 bg-transparent px-2 py-2 outline-none"
            />
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {[
            { slug: "", label: "All" },
            ...first.categories.map((c) => ({ slug: c.slug, label: shortName(c.name) })),
          ].map((c) => (
            <button
              key={c.label}
              onClick={() =>
                void navigate({
                  search: (s: ToolsSearch) => ({ ...s, category: c.slug || undefined }),
                })
              }
              aria-pressed={first.category === c.slug}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                first.category === c.slug
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((t) => (
            <ToolCard key={t.slug} tool={t} />
          ))}
        </div>
        {first.total === 0 && (
          <p className="py-20 text-center text-muted-foreground">No tools match your search.</p>
        )}
        {items.length < first.total && (
          <div className="mt-10 text-center">
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
            {moreError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Could not load more tools. Please try again.
              </p>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
