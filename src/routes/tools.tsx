import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Page } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { categories, shortName, tools } from "@/lib/tools";

export const Route = createFileRoute("/tools")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s["q"] === "string" ? { q: s["q"] as string } : {},
  head: () => ({
    meta: [
      { title: "All AI Tools — Search & Filter | TryAITools" },
      { name: "description", content: "Search and filter more than 2,000 AI tools across 15 categories." },
      { property: "og:title", content: "All AI Tools | TryAITools" },
      { property: "og:description", content: "Search and filter more than 2,000 AI tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ToolsPage,
});

const PAGE = 48;

function ToolsPage() {
  const { q: initial } = Route.useSearch();
  const [q, setQ] = useState(initial ?? "");
  const [cat, setCat] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tools.filter(
      (t) =>
        (!cat || t.category === cat) &&
        (!s || t.name.toLowerCase().includes(s) || t.subcategory.toLowerCase().includes(s) || t.url.includes(s)),
    );
  }, [q, cat]);

  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h1 className="text-4xl font-bold">All AI Tools</h1>
          <p className="mt-2 text-foreground/70">{list.length.toLocaleString()} tools found</p>
          <div className="mt-6 flex max-w-xl items-center gap-2 rounded-2xl bg-background p-2 shadow-soft">
            <Search className="ml-3 h-5 w-5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search by name or use case…"
              className="flex-1 bg-transparent px-2 py-2 outline-none"
            />
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {[{ name: "", label: "All" }, ...categories.map((c) => ({ name: c.name, label: shortName(c.name) }))].map((c) => (
            <button
              key={c.label}
              onClick={() => {
                setCat(c.name);
                setLimit(PAGE);
              }}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                cat === c.name ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.slice(0, limit).map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
        {list.length === 0 && <p className="py-20 text-center text-muted-foreground">No tools match your search.</p>}
        {limit < list.length && (
          <div className="mt-10 text-center">
            <button onClick={() => setLimit(limit + PAGE)} className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft">
              Load more
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}
