import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/site/Layout";
import { pageHead } from "@/lib/seo";
import { useSiteSummary } from "@/lib/catalog/use-site";

export const Route = createFileRoute("/about")({
  head: () =>
    pageHead({
      title: "About TryAITools: An Independent AI Tools Directory",
      description:
        "TryAITools is an independent directory of AI tools in 15 categories. Learn how listings work, how tools are reviewed and how we stay independent.",
      path: "/about",
    }),
  component: function AboutPage() {
    const { toolCount, categories } = useSiteSummary();
    return (
      <Page>
        <section className="bg-hero pb-16 pt-16">
          <div className="mx-auto max-w-3xl text-center page-x">
            <h1 className="text-4xl font-bold sm:text-5xl">Making AI Tools Easy to Discover</h1>
            <p className="mt-5 text-lg text-foreground/75">
              We organize the fast-growing world of AI into clear categories so you can find the
              right tool in seconds.
            </p>
          </div>
        </section>
        <div className="mx-auto grid max-w-4xl gap-5 pt-12 sm:grid-cols-3 page-x">
          {[
            [`${toolCount.toLocaleString()}+`, "AI tools listed"],
            [String(categories.length), "Categories"],
            ["Free", "To browse, always"],
          ].map(([n, l]) => (
            <div key={l} className="rounded-2xl border border-border bg-card p-6 text-center">
              <div className="font-display text-3xl font-bold text-primary">{n}</div>
              <div className="mt-1 text-sm text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <article className="mx-auto max-w-3xl space-y-8 pt-12 text-foreground/80 sm:text-lg [&_a]:font-semibold [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 page-x">
          <section>
            <h2>What you&apos;ll find here</h2>
            <ul>
              <li>
                A directory of AI tools organised into {categories.length} categories and their
                subcategories, from writing and images to coding, marketing and education.
              </li>
              <li>
                Reviewed tool pages for the most widely used tools: what the tool does, its key
                features, advantages, limitations and pricing, checked against the official website.
              </li>
              <li>
                Directory listings for everything else, clearly marked when a tool hasn&apos;t been
                reviewed in detail yet.
              </li>
              <li>
                <a href="/news">AI News</a>: short, labelled AI summaries of announcements from
                official AI company blogs and research sources, always linked to the original.
              </li>
            </ul>
          </section>
          <section>
            <h2>How we stay independent</h2>
            <ul>
              <li>Listings are free; a tool cannot pay to be listed or to change what we write.</li>
              <li>
                Some outbound links are affiliate links. Commissions never decide whether a tool is
                listed, how it is categorised or what its page says. See our{" "}
                <a href="/affiliate-disclosure">affiliate disclosure</a>.
              </li>
              <li>We don&apos;t publish star ratings or reviews we haven&apos;t collected.</li>
            </ul>
          </section>
          <section>
            <h2>How tools are reviewed</h2>
            <p>
              Every reviewed page is checked against the tool&apos;s official website and pricing
              page, and anything the official pages don&apos;t support is left out. Read{" "}
              <a href="/how-we-review">how we review tools</a>.
            </p>
          </section>
        </article>
        <div className="mt-12 text-center">
          <a
            href="/tools"
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            Start exploring
          </a>
        </div>
      </Page>
    );
  },
});
