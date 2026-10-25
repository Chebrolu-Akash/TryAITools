import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyPrompt } from "@/components/site/CopyPrompt";
import { Page } from "@/components/site/Layout";
import { alternativesFor, slugOfTool, toolBySlugName } from "@/lib/tool-pages";
import { contentFor } from "@/lib/tool-content";
import { pageHead } from "@/lib/seo";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { domainOf, logoOf, shortName, slugOf, type Tool } from "@/lib/tools";

const cleanName = (t: Tool) => t.name.replace(/ \(.+\)$/, "");
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = toolBySlugName(params.slug);
    if (!tool) throw notFound();
    return { slug: params.slug, tool };
  },
  head: ({ loaderData, params }) => {
    const tool = loaderData?.tool;
    if (!tool) return pageHead({ title: `Tool not found | ${SITE_NAME}`, description: "This tool page doesn't exist.", path: `/tools/${params.slug}`, noindex: true });
    const name = cleanName(tool);
    const c = contentFor(tool);
    const path = `/tools/${params.slug}`;
    const description = c.description.length > 158 ? `${c.description.slice(0, 155).trimEnd()}…` : c.description;
    const base = pageHead({ title: `${name}: What It Is, How to Use It & Alternatives | ${SITE_NAME}`, description, path });
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          name,
          description: c.description,
          applicationCategory: shortName(tool.category),
          url: absoluteUrl(path),
          ...(tool.url ? { sameAs: tool.url } : {}),
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
            { "@type": "ListItem", position: 2, name: "AI Tools", item: absoluteUrl("/tools") },
            { "@type": "ListItem", position: 3, name: shortName(tool.category), item: absoluteUrl(`/categories/${slugOf(tool.category)}`) },
            { "@type": "ListItem", position: 4, name, item: absoluteUrl(path) },
          ],
        },
      ],
    };
    return { ...base, scripts: [{ type: "application/ld+json", children: jsonLd(ld) }] };
  },
  notFoundComponent: () => (
    <Page>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Tool not found</h1>
        <p className="mt-3 text-muted-foreground">We couldn&apos;t find that tool. Try searching the directory.</p>
        <Link to="/tools" className="mt-6 inline-flex rounded-full bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft">Browse all tools</Link>
      </div>
    </Page>
  ),
  component: ToolPage,
});

function Logo({ tool, size }: { tool: Tool; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = logoOf(tool.url, 128);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white font-bold text-primary shadow-card ring-1 ring-primary/15" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt={`${cleanName(tool)} logo`} width={size * 0.6} height={size * 0.6} decoding="async" referrerPolicy="no-referrer" className="object-contain" style={{ width: size * 0.6, height: size * 0.6 }} onError={() => setFailed(true)} />
      ) : (
        cleanName(tool).slice(0, 1)
      )}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-primary/10 bg-card p-5 shadow-card sm:p-7">
      <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ToolPage() {
  const { tool } = Route.useLoaderData();
  const name = cleanName(tool);
  const c = contentFor(tool);
  const alts = alternativesFor(tool, 6);
  const domain = domainOf(tool.url);
  const catSlug = slugOf(tool.category);

  const Visit = ({ className }: { className: string }) =>
    tool.url ? (
      <a href={tool.url} target="_blank" rel="noopener noreferrer sponsored" className={className}>
        Visit {name} Official Website <ArrowUpRight className="h-4 w-4" />
      </a>
    ) : null;

  return (
    <Page>
      <section className="bg-hero pb-10 pt-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:text-sm">
            <Link to="/" className="hover:text-primary">Home</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to="/tools" className="hover:text-primary">AI Tools</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="hover:text-primary">{shortName(tool.category)}</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">{name}</span>
          </nav>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <Logo tool={tool} size={88} />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
              <p className="mt-2 text-sm text-foreground/70 sm:text-base">{c.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="rounded-full bg-accent px-3 py-1 text-accent-foreground">{shortName(tool.category)}</Link>
                {tool.subcategory && (
                  <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: tool.subcategory }} className="rounded-full bg-background/80 px-3 py-1 text-muted-foreground ring-1 ring-primary/15">{tool.subcategory.replace(/^AI /, "")}</Link>
                )}
                {domain && <span className="rounded-full bg-background/80 px-3 py-1 text-muted-foreground ring-1 ring-primary/15">{domain}</span>}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Visit className="inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-7 py-3 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90 sm:text-base" />
            {!tool.url && <span className="text-sm text-muted-foreground">An official website isn&apos;t listed for this tool yet.</span>}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-10 sm:px-6">
        <Section title={`What is ${name}?`}>
          <p className="leading-7 text-foreground/80">{c.description}</p>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="font-bold text-foreground">Best for</dt><dd className="mt-1 text-foreground/75">{c.audience}</dd></div>
            <div><dt className="font-bold text-foreground">Category</dt><dd className="mt-1 text-foreground/75">{tool.category}{tool.subcategory ? ` · ${tool.subcategory}` : ""}</dd></div>
            {domain && <div><dt className="font-bold text-foreground">Official website</dt><dd className="mt-1 text-foreground/75">{domain}</dd></div>}
            <div><dt className="font-bold text-foreground">Pricing</dt><dd className="mt-1 text-foreground/75">Plans and prices change, so check the official website for current pricing.</dd></div>
          </dl>
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Main use cases">
            <ul className="space-y-2.5">{c.useCases.map((u) => <li key={u} className="flex gap-2 text-sm text-foreground/80"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{u}</li>)}</ul>
          </Section>
          <Section title="Key features">
            <ul className="space-y-2.5">{c.features.map((f) => <li key={f} className="flex gap-2 text-sm text-foreground/80"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{f}</li>)}</ul>
          </Section>
          <Section title="Pros">
            <ul className="space-y-2.5">{c.pros.map((p) => <li key={p} className="flex gap-2 text-sm text-foreground/80"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />{p}</li>)}</ul>
          </Section>
          <Section title="Limitations">
            <ul className="space-y-2.5">{c.limits.map((l) => <li key={l} className="flex gap-2 text-sm text-foreground/80"><X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{l}</li>)}</ul>
          </Section>
        </div>

        <Section title={`A useful prompt for ${name}`}>
          <p className="mb-4 text-sm text-muted-foreground">Copy this prompt and replace each <span className="font-mono">[placeholder]</span> with your own details.</p>
          <CopyPrompt prompt={c.prompt} />
        </Section>

        <Section title={`How to use ${name}, step by step`}>
          <ol className="space-y-3">
            {c.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-sm text-foreground/80">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span className="pt-0.5 leading-6">{s}</span>
              </li>
            ))}
          </ol>
          <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-primary">Tips</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-foreground/80">{c.tips.map((t) => <li key={t}>{t}</li>)}</ul>
        </Section>

        {alts.length > 0 && (
          <Section title={`${name} alternatives`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {alts.map((a) => (
                <Link key={slugOfTool(a)} to="/tools/$slug" params={{ slug: slugOfTool(a) }} className="group flex items-center gap-3 rounded-2xl border border-primary/10 bg-background p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Logo tool={a} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold group-hover:text-primary">{cleanName(a)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{(a.subcategory || a.category).replace(/^AI /, "")}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        )}

        <section className="rounded-[2rem] bg-gradient-to-b from-[#8a86ff] to-[#5f5bf5] px-6 py-10 text-center text-white">
          <h2 className="text-2xl font-extrabold sm:text-3xl">Ready to try {name}?</h2>
          <p className="mt-2 text-white/90">Head to the official website to get started. You&apos;ll leave TryAITools when you click.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Visit className="inline-flex items-center gap-1.5 rounded-full bg-white px-7 py-3 text-sm font-bold text-primary shadow-soft transition hover:opacity-90" />
            <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="rounded-full border border-white/70 px-7 py-3 text-sm font-bold text-white transition hover:bg-white/10">More {shortName(tool.category)} tools</Link>
          </div>
        </section>
      </div>
    </Page>
  );
}
