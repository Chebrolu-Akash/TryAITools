import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyPrompt } from "@/components/site/CopyPrompt";
import { Page } from "@/components/site/Layout";
import { PricingDisclaimer, ToolPricingSection } from "@/components/site/ToolPricingSection";
import { fetchToolPage } from "@/lib/catalog/api";
import type { PublicTool } from "@/lib/catalog/model";
import { pageHead } from "@/lib/seo";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { PRICING_LABELS } from "@/lib/pricing";
import { tagsOf } from "@/lib/tags";
import { domainOf, dropAI, logoOf, shortName } from "@/lib/tool-utils";

const cleanName = (t: Pick<PublicTool, "name">) => t.name.replace(/ \(.+\)$/, "");
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
/** schema.org applicationCategory for each category (a recognised value, not our label). */
const APP_CATEGORY: Record<string, string> = {
  "ai-image-tools": "MultimediaApplication",
  "ai-video-tools": "MultimediaApplication",
  "ai-audio-voice-tools": "MultimediaApplication",
  "ai-design-ui-ux-tools": "DesignApplication",
  "ai-coding-developer-tools": "DeveloperApplication",
  "ai-education-learning-tools": "EducationalApplication",
  "ai-chatbots-assistants": "CommunicationApplication",
};
/** Adds the site name only while the title stays within ~60 characters (what Google shows). */
const withSite = (t: string) => (t.length + SITE_NAME.length + 3 <= 60 ? `${t} | ${SITE_NAME}` : t);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export const Route = createFileRoute("/tools/$slug")({
  // Unknown, unpublished, archived and flagged tools all 404 here (the server only ever sees public rows).
  loader: ({ params }) => fetchToolPage({ data: params.slug }),
  staleTime: Infinity, // pre-built HTML: never refetch in the browser
  head: ({ loaderData, params }) => {
    const tool = loaderData?.tool;
    const path = `/tools/${params.slug}`;
    if (!loaderData || !tool)
      return pageHead({
        title: `Tool not found | ${SITE_NAME}`,
        description: "This tool page doesn't exist.",
        path,
        noindex: true,
        canonical: false,
      });
    const name = cleanName(tool);
    const c = loaderData.content;
    const sub = (tool.subcategory || tool.category).replace(/^AI /, "").replace(/ Tools$/, "");
    const raw =
      loaderData.seoDescription ??
      (c.curated
        ? [c.tagline, c.overview].filter(Boolean).join(" ")
        : `${name} in ${sub}: a starter prompt, how-to steps and alternatives on ${SITE_NAME}.`);
    const description = raw.length > 158 ? `${raw.slice(0, 155).trimEnd()}…` : raw;
    // reviewed tools: the editor-approved title, or what people search for (features, pricing, alternatives)
    const title = loaderData.seoTitle
      ? withSite(loaderData.seoTitle)
      : c.curated
        ? withSite(`${name}: Features, Pricing & Alternatives`)
        : `${name}: ${sub} Tool, Prompt & Alternatives | ${SITE_NAME}`;
    const base = pageHead({ title, description, path, noindex: !loaderData.indexable });
    const graph: unknown[] = [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
          {
            "@type": "ListItem",
            position: 2,
            name: dropAI(tool.category),
            item: absoluteUrl(`/categories/${tool.categorySlug}`),
          },
          { "@type": "ListItem", position: 3, name, item: absoluteUrl(path) },
        ],
      },
    ];
    // Only describe the software when we have tool-specific information about it.
    if (c.curated) {
      graph.unshift({
        "@type": "SoftwareApplication",
        name,
        description: [c.tagline, c.overview].filter(Boolean).join(" "),
        applicationCategory: APP_CATEGORY[tool.categorySlug] ?? "BusinessApplication",
        url: absoluteUrl(path),
        ...(tool.url ? { sameAs: tool.url } : {}),
        // only what is recorded: a free plan exists (free or freemium). Prices are never inferred.
        ...(tool.pricing === "free" || tool.pricing === "freemium"
          ? { offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }
          : {}),
      });
    }
    return {
      ...base,
      scripts: [
        {
          type: "application/ld+json",
          children: jsonLd({ "@context": "https://schema.org", "@graph": graph }),
        },
      ],
    };
  },
  notFoundComponent: () => (
    <Page>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">Tool not found</h1>
        <p className="mt-3 text-muted-foreground">
          We couldn&apos;t find that tool. Try searching the directory.
        </p>
        <a
          href="/tools"
          className="mt-6 inline-flex rounded-full bg-gradient-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-soft"
        >
          Browse all tools
        </a>
      </div>
    </Page>
  ),
  component: ToolPage,
});

function Logo({ tool, size }: { tool: PublicTool; size: number }) {
  const [failed, setFailed] = useState(false);
  const src = logoOf(tool.url, 128);
  const inner = Math.round(size * 0.6);
  return (
    <span className="tool-logo-frame" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={inner}
          height={inner}
          decoding="async"
          referrerPolicy="no-referrer"
          className="object-contain"
          style={{ width: inner, height: inner }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{cleanName(tool).slice(0, 1)}</span>
      )}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tool-section">
      <h2 className="tool-section-title">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Bullets({ items, icon }: { items: string[]; icon: "check" | "x" | "good" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2 text-sm text-foreground/80">
          {icon === "x" ? (
            <X aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <Check
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 ${icon === "good" ? "text-green-600" : "text-primary"}`}
            />
          )}
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function ToolPage() {
  const {
    tool,
    content: c,
    alternatives: alts,
    related: more,
    relatedCategories: cats,
    pricing,
  } = Route.useLoaderData();
  const name = cleanName(tool);
  const domain = domainOf(tool.url);
  const catSlug = tool.categorySlug;
  const showAlts = alts.length >= 3;
  const hasDetails = Boolean(c.features?.length || c.pros?.length || c.limits?.length);

  return (
    <Page>
      <section className="bg-hero pb-10 pt-10">
        <div className="mx-auto max-w-6xl page-x">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:text-sm">
              <li>
                <a href="/" className="hover:text-primary">
                  AI Tools
                </a>
              </li>
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li>
                <a href={`/categories/${catSlug}`} className="hover:text-primary">
                  {dropAI(tool.category)}
                </a>
              </li>
              {tool.subcategory && (
                <>
                  <li aria-hidden>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </li>
                  <li>
                    <a
                      href={`/categories/${catSlug}?${new URLSearchParams({ sub: tool.subcategory })}`}
                      className="hover:text-primary"
                    >
                      {dropAI(tool.subcategory)}
                    </a>
                  </li>
                </>
              )}
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li aria-current="page" className="font-semibold text-foreground">
                {name}
              </li>
            </ol>
          </nav>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <Logo tool={tool} size={88} />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{name}</h1>
              <p className="mt-2 text-base text-foreground/75 sm:text-lg">{c.tagline}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <a
                  href={`/categories/${catSlug}`}
                  className="rounded-full bg-accent px-3 py-1 text-accent-foreground"
                >
                  {shortName(tool.category)}
                </a>
                {tool.subcategory && (
                  <a
                    href={`/categories/${catSlug}?${new URLSearchParams({ sub: tool.subcategory })}`}
                    className="rounded-full bg-background/80 px-3 py-1 text-muted-foreground ring-1 ring-primary/15"
                  >
                    {dropAI(tool.subcategory)}
                  </a>
                )}
                {tool.pricing && (
                  <a
                    href={`/tools?pricing=${tool.pricing}`}
                    className="tool-card-price"
                    data-pricing={tool.pricing}
                  >
                    {PRICING_LABELS[tool.pricing]}
                  </a>
                )}
                {tagsOf(tool.tags).map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-border bg-background/80 px-3 py-1 text-foreground/70"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {tool.url ? (
              <a
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-primary px-7 py-3 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base"
              >
                Visit {name} Official Website <ArrowUpRight aria-hidden className="h-4 w-4" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-sm text-muted-foreground">
                An official website isn&apos;t listed for this tool yet.
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 pt-10 page-x">
        <Section title={`About ${name}`}>
          {c.overview && <p className="leading-7 text-foreground/80">{c.overview}</p>}
          <dl className={`grid gap-4 text-sm sm:grid-cols-2 ${c.overview ? "mt-5" : ""}`}>
            <div>
              <dt className="font-bold text-foreground">Best for</dt>
              <dd className="mt-1 text-foreground/75">{c.bestFor}</dd>
            </div>
            {domain && (
              <div>
                <dt className="font-bold text-foreground">Official website</dt>
                <dd className="mt-1 text-foreground/75">{domain}</dd>
              </div>
            )}
          </dl>
        </Section>

        {hasDetails && (
          <div className="grid gap-6 md:grid-cols-2">
            {c.features && (
              <Section title="Key features">
                <Bullets items={c.features} icon="check" />
              </Section>
            )}
            {c.pros && (
              <Section title="Pros">
                <Bullets items={c.pros} icon="good" />
              </Section>
            )}
            {c.limits && (
              <Section title="Limitations">
                <Bullets items={c.limits} icon="x" />
              </Section>
            )}
          </div>
        )}

        {pricing && <ToolPricingSection name={name} pricing={pricing} />}
        {/* Pricing shown only as the header badge: the disclaimer goes where the plans would be. */}
        {tool.pricing && !pricing && <PricingDisclaimer className="px-1" />}

        <Section
          title={
            c.promptKind === "tool"
              ? `A prompt for ${name}`
              : `Starter prompt for ${(tool.subcategory || tool.category)
                  .replace(/^AI /, "")
                  .replace(/ Tools$/, "")
                  .toLowerCase()}`
          }
        >
          <p className="mb-4 text-sm text-muted-foreground">
            {c.promptKind === "tool"
              ? "Copy this prompt and replace each "
              : "A general starting point for this type of tool, not specific to " +
                name +
                ". Replace each "}
            <span className="font-mono">[placeholder]</span> with your own details.
          </p>
          <CopyPrompt prompt={c.prompt} />
        </Section>

        <Section title={`How to use ${name}`}>
          <ol className="space-y-3">
            {c.steps.map((st, i) => (
              <li key={st} className="flex gap-3 text-sm text-foreground/80">
                <span aria-hidden className="tool-step-number">
                  {i + 1}
                </span>
                <span className="pt-0.5 leading-6">{st}</span>
              </li>
            ))}
          </ol>
          {c.tips.length > 0 && (
            <div className="mt-5 rounded-2xl bg-accent/60 p-4 text-sm text-foreground/80">
              <p className="font-bold text-primary">Tips</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {c.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {showAlts && (
          <Section title={`${name} alternatives`}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {alts.map((a) => (
                <li key={a.slug}>
                  <a href={`/tools/${a.slug}`} className="group tool-alt-card">
                    <Logo tool={a} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold group-hover:text-primary">
                        {cleanName(a)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {(a.subcategory || a.category).replace(/^AI /, "")}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Explore more">
          {more.length > 0 && (
            <>
              <h3 className="text-sm font-bold text-foreground">
                Popular in {shortName(tool.category)}
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {more.map((t) => (
                  <li key={t.slug}>
                    <a href={`/tools/${t.slug}`} className="tool-chip-link">
                      {cleanName(t)}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className={`text-sm font-bold text-foreground ${more.length > 0 ? "mt-5" : ""}`}>
            Browse categories
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            <li>
              <a
                href={`/categories/${catSlug}`}
                className="rounded-full bg-gradient-primary px-4 py-1.5 text-sm font-bold text-primary-foreground"
              >
                All {shortName(tool.category)} tools
              </a>
            </li>
            {cats.map((cat) => (
              <li key={cat.slug}>
                <a href={`/categories/${cat.slug}`} className="tool-chip-link">
                  {shortName(cat.name)}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </Page>
  );
}
