import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyPrompt } from "@/components/site/CopyPrompt";
import { Page } from "@/components/site/Layout";
import { alternativesFor, relatedFor, siblingSubcategories, slugOfTool, toolBySlugName } from "@/lib/tool-pages";
import { contentFor } from "@/lib/tool-content";
import { pageHead } from "@/lib/seo";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { domainOf, logoOf, shortName, slugOf, type Tool } from "@/lib/tools";

const cleanName = (t: Tool) => t.name.replace(/ \(.+\)$/, "");
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const noSub = (s: string) => s.replace(/^AI /, "");

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = toolBySlugName(params.slug);
    if (!tool) throw notFound();
    return { slug: params.slug, tool };
  },
  head: ({ loaderData, params }) => {
    const tool = loaderData?.tool;
    const path = `/tools/${params.slug}`;
    if (!tool) return pageHead({ title: `Tool not found | ${SITE_NAME}`, description: "This tool page doesn't exist.", path, noindex: true });
    const name = cleanName(tool);
    const c = contentFor(tool);
    const sub = (tool.subcategory || tool.category).replace(/^AI /, "").replace(/ Tools$/, "");
    const indexable = isIndexable(tool);
    const raw = c.curated
      ? [c.tagline, c.overview].filter(Boolean).join(" ")
      : `${name} in ${sub}: a starter prompt, how-to steps and alternatives on ${SITE_NAME}.`;
    const description = raw.length > 158 ? `${raw.slice(0, 155).trimEnd()}…` : raw;
    const base = pageHead({ title: `${name}: ${sub} Tool, Prompt & Alternatives | ${SITE_NAME}`, description, path, noindex: !indexable });
    const graph: unknown[] = [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: "AI Tools", item: absoluteUrl("/tools") },
          { "@type": "ListItem", position: 3, name: shortName(tool.category), item: absoluteUrl(`/categories/${slugOf(tool.category)}`) },
          { "@type": "ListItem", position: 4, name, item: absoluteUrl(path) },
        ],
      },
    ];
    // Only describe the software when we have tool-specific information about it.
    if (c.curated) {
      graph.unshift({ "@type": "SoftwareApplication", name, description: [c.tagline, c.overview].filter(Boolean).join(" "), applicationCategory: shortName(tool.category), url: absoluteUrl(path), ...(tool.url ? { sameAs: tool.url } : {}) });
    }
    return { ...base, scripts: [{ type: "application/ld+json", children: jsonLd({ "@context": "https://schema.org", "@graph": graph }) }] };
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
  const inner = Math.round(size * 0.6);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-white font-bold text-primary shadow-card ring-1 ring-primary/15" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt="" width={inner} height={inner} decoding="async" referrerPolicy="no-referrer" className="object-contain" style={{ width: inner, height: inner }} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden>{cleanName(tool).slice(0, 1)}</span>
      )}
    </span>
  );
}

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-primary/10 bg-card p-5 shadow-card sm:p-7 ${className}`}>
      <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Bullets({ items, icon }: { items: string[]; icon: "check" | "x" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-sm leading-6 text-foreground/80">
          {icon === "check" ? <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden /> : <X className="mt-1 h-4 w-4 shrink-0 text-destructive" aria-hidden />}
          {t}
        </li>
      ))}
    </ul>
  );
}

function ToolLink({ tool }: { tool: Tool }) {
  return (
    <Link
      to="/tools/$slug"
      params={{ slug: slugOfTool(tool) }}
      className="group flex items-center gap-3 rounded-2xl border border-primary/10 bg-background p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Logo tool={tool} size={44} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold group-hover:text-primary">{cleanName(tool)}</span>
        <span className="block truncate text-xs text-muted-foreground">{noSub(tool.subcategory || tool.category)}</span>
      </span>
    </Link>
  );
}

function Bullets({ items, icon }: { items: string[]; icon: "check" | "x" | "good" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-sm text-foreground/80">
          {icon === "x" ? <X aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <Check aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${icon === "good" ? "text-green-600" : "text-primary"}`} />}
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function ToolPage() {
  const { tool } = Route.useLoaderData();
  const name = cleanName(tool);
  const c = contentFor(tool);
  const alts = alternativesFor(tool, 6);
  const more = relatedTools(tool, alts, 4);
  const cats = relatedCategories(tool.category, 4);
  const domain = domainOf(tool.url);
  const catSlug = slugOf(tool.category);
  const showAlts = alts.length >= 3;
  const hasDetails = Boolean(c.features?.length || c.pros?.length || c.limits?.length);

  return (
    <Page>
      <section className="bg-hero pb-10 pt-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:text-sm">
              <li><Link to="/" className="hover:text-primary">Home</Link></li>
              <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
              <li><Link to="/tools" className="hover:text-primary">AI Tools</Link></li>
              <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
              <li><Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="hover:text-primary">{shortName(tool.category)}</Link></li>
              <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
              <li aria-current="page" className="font-semibold text-foreground">{name}</li>
            </ol>
          </nav>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <Logo tool={tool} size={88} />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
              <p className="mt-2 text-base text-foreground/75 sm:text-lg">{c.tagline}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="rounded-full bg-accent px-3 py-1 text-accent-foreground">{shortName(tool.category)}</Link>
                {tool.subcategory && (
                  <Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: tool.subcategory }} className="rounded-full bg-background/80 px-3 py-1 text-muted-foreground ring-1 ring-primary/15">{tool.subcategory.replace(/^AI /, "")}</Link>
                )}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {tool.url ? (
              <a href={tool.url} target="_blank" rel="noopener noreferrer sponsored" className="inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-7 py-3 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base">
                Visit {name} Official Website <ArrowUpRight aria-hidden className="h-4 w-4" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">An official website isn&apos;t listed for this tool yet.</span>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-10 sm:px-6">
        <Section title={`About ${name}`}>
          {c.overview && <p className="leading-7 text-foreground/80">{c.overview}</p>}
          <dl className={`grid gap-4 text-sm sm:grid-cols-2 ${c.overview ? "mt-5" : ""}`}>
            <div><dt className="font-bold text-foreground">Best for</dt><dd className="mt-1 text-foreground/75">{c.bestFor}</dd></div>
            {domain && <div><dt className="font-bold text-foreground">Official website</dt><dd className="mt-1 text-foreground/75">{domain}</dd></div>}
          </dl>
        </Section>

        {hasDetails && (
          <div className="grid gap-6 md:grid-cols-2">
            {c.features && <Section title="Key features"><Bullets items={c.features} icon="check" /></Section>}
            {c.pros && <Section title="Pros"><Bullets items={c.pros} icon="good" /></Section>}
            {c.limits && <Section title="Limitations"><Bullets items={c.limits} icon="x" /></Section>}
          </div>
        )}

        <Section title={c.promptKind === "tool" ? `A prompt for ${name}` : `Starter prompt for ${(tool.subcategory || tool.category).replace(/^AI /, "").replace(/ Tools$/, "").toLowerCase()}`}>
          <p className="mb-4 text-sm text-muted-foreground">
            {c.promptKind === "tool" ? "Copy this prompt and replace each " : "A general starting point for this type of tool, not specific to " + name + ". Replace each "}
            <span className="font-mono">[placeholder]</span> with your own details.
          </p>
          <CopyPrompt prompt={c.prompt} />
        </Section>

        <Section title={`How to use ${name}`}>
          <ol className="space-y-3">
            {c.steps.map((st, i) => (
              <li key={st} className="flex gap-3 text-sm text-foreground/80">
                <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <span className="pt-0.5 leading-6">{st}</span>
              </li>
            ))}
          </ol>
          {c.tips.length > 0 && (
            <div className="mt-5 rounded-2xl bg-accent/60 p-4 text-sm text-foreground/80">
              <p className="font-bold text-primary">Tips</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">{c.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
        </Section>

        {showAlts && (
          <Section title={`${name} alternatives`}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {alts.map((a) => (
                <li key={slugOfTool(a)}>
                  <Link to="/tools/$slug" params={{ slug: slugOfTool(a) }} className="group flex items-center gap-3 rounded-2xl border border-primary/10 bg-background p-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Logo tool={a} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold group-hover:text-primary">{cleanName(a)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{(a.subcategory || a.category).replace(/^AI /, "")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Explore more">
          {more.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-foreground">Popular in {shortName(tool.category)}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {more.map((t) => (
                  <li key={slugOfTool(t)}><Link to="/tools/$slug" params={{ slug: slugOfTool(t) }} className="rounded-full border border-primary/15 bg-background px-4 py-1.5 text-sm font-semibold hover:border-primary/40 hover:text-primary">{cleanName(t)}</Link></li>
                ))}
              </ul>
            </>
          )}
          <h3 className={`text-sm font-bold text-foreground ${more.length > 0 ? "mt-5" : ""}`}>Browse categories</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            <li><Link to="/categories/$slug" params={{ slug: catSlug }} search={{ sub: undefined }} className="rounded-full bg-gradient-primary px-4 py-1.5 text-sm font-bold text-primary-foreground">All {shortName(tool.category)} tools</Link></li>
            {cats.map((cat) => (
              <li key={cat.slug}><Link to="/categories/$slug" params={{ slug: cat.slug }} search={{ sub: undefined }} className="rounded-full border border-primary/15 bg-background px-4 py-1.5 text-sm font-semibold hover:border-primary/40 hover:text-primary">{shortName(cat.name)}</Link></li>
            ))}
          </ul>
        </Section>
      </div>
    </Page>
  );
}
