import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/site/Layout";
import { ToolCard } from "@/components/site/ToolCard";
import { pageHead } from "@/lib/seo";
import { categoryBySlug, toolsIn } from "@/lib/tools";

export const Route = createFileRoute("/categories/$slug")({
  validateSearch: (search: Record<string, unknown>): { sub?: string | undefined } =>
    typeof search["sub"] === "string" ? { sub: search["sub"] } : {},
  loader: ({ params }) => {
    const category = categoryBySlug(params.slug);
    if (!category) throw notFound();
    return { category };
  },
  head: ({ loaderData, params }) => {
    const n = loaderData?.category.name ?? "Category";
    return pageHead({ title: `Best ${n} | TryAITools`, description: `Discover the best ${n} — compare and visit top picks.`, path: `/categories/${params.slug}` });
  },
  notFoundComponent: () => (
    <Page>
      <div className="py-32 text-center">
        <h1 className="text-3xl font-bold">Category not found</h1>
        <Link to="/categories" className="mt-4 inline-block text-primary">Browse categories</Link>
      </div>
    </Page>
  ),
  component: CategoryPage,
});

function CategoryPage() {
  const { category } = Route.useLoaderData();
  const { sub: selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const sub = selected && category.subcategories.includes(selected) ? selected : "";
  const all = toolsIn(category.name);
  const list = sub ? all.filter((t) => t.subcategory === sub) : all;
  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Link to="/categories" className="text-sm font-medium text-primary">← All categories</Link>
          <h1 className="mt-3 text-4xl font-bold">{category.name}</h1>
          <p className="mt-2 text-foreground/70">{all.length} tools in this category</p>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {["", ...category.subcategories].map((s) => (
            <Button
              key={s || "all"}
              variant="outline"
              aria-pressed={sub === s}
              onClick={() => navigate({ search: { sub: s || undefined } })}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                sub === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
              }`}
            >
              {s ? s.replace(/^AI /, "") : "All"}
            </Button>
          ))}
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((t) => (
            <ToolCard key={t.id} tool={t} showCategory={false} />
          ))}
        </div>
      </div>
    </Page>
  );
}
