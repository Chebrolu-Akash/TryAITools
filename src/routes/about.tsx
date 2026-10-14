import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { pageHead } from "@/lib/seo";
import { categories, tools } from "@/lib/tools";

export const Route = createFileRoute("/about")({
  head: () =>
    pageHead({ title: "About TryAITools", description: "TryAITools helps you discover the right AI tool for every task. Learn about our mission and how the directory is organized.", path: "/about" }),
  component: () => (
    <Page>
      <section className="bg-hero pb-16 pt-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h1 className="text-4xl font-bold sm:text-5xl">Making AI Tools Easy to Discover</h1>
          <p className="mt-5 text-lg text-foreground/75">
            We organize the fast-growing world of AI into clear categories so you can find the right tool in seconds.
          </p>
        </div>
      </section>
      <div className="mx-auto grid max-w-4xl gap-5 px-4 pt-12 sm:grid-cols-3">
        {[
          [`${tools.length.toLocaleString()}+`, "AI tools listed"],
          [String(categories.length), "Categories"],
          ["Free", "To browse, always"],
        ].map(([n, l]) => (
          <div key={l} className="rounded-2xl border border-border bg-card p-6 text-center">
            <div className="font-display text-3xl font-bold text-primary">{n}</div>
            <div className="mt-1 text-sm text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-12 text-center">
        <Link to="/tools" className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft">
          Start exploring
        </Link>
      </div>
    </Page>
  ),
});
