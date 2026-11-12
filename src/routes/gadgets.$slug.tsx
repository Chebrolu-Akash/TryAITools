import { createFileRoute } from "@tanstack/react-router";
import {
  AffiliateButton,
  ContentDetailPage,
  ContentNotFound,
} from "@/components/site/ContentViews";
import { fetchContentItem } from "@/lib/content/api";
import { GADGET_TYPES, type GadgetDetail } from "@/lib/content/model";
import { detailHead, notFoundHead } from "@/lib/content/seo";

const SECTION = { label: "AI Gadgets", path: "/gadgets" };

export const Route = createFileRoute("/gadgets/$slug")({
  loader: ({ params }) => fetchContentItem({ data: { section: "gadgets", slug: params.slug } }),
  staleTime: Infinity,
  head: ({ loaderData, params }) => {
    const path = `/gadgets/${params.slug}`;
    const g = loaderData?.item as GadgetDetail | undefined;
    if (!g) return notFoundHead(path, "Gadget");
    // No Product schema: we hold no live price or availability, and Product without an offer or review is invalid.
    return detailHead({
      path,
      section: SECTION,
      title: g.title,
      seoTitle: g.seoTitle,
      description:
        g.seoDescription ?? g.summary ?? `${g.title}: what its AI does and where to buy it.`,
      indexable: g.indexable,
      canonical: null,
      image: g.image,
    });
  },
  notFoundComponent: () => (
    <ContentNotFound what="Gadget" href="/gadgets" back="Browse AI gadgets" />
  ),
  component: GadgetPage,
});

function GadgetPage() {
  const g = Route.useLoaderData().item as GadgetDetail;
  return (
    <ContentDetailPage
      section={{ label: SECTION.label, href: SECTION.path }}
      title={g.title}
      badges={
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-primary">
          {GADGET_TYPES[g.type] ?? g.type}
        </span>
      }
      meta={g.brand}
      lead={g.summary}
      actions={
        <>
          {g.url && (
            <AffiliateButton href={g.url}>
              {g.retailer ? `Check price on ${g.retailer}` : "Check price"}
            </AffiliateButton>
          )}
          {g.price && <span className="text-xl font-bold">{g.price}</span>}
        </>
      }
      image={g.image}
      aside={
        (g.features.length > 0 || g.otherRetailers.length > 0) && (
          <div className="mb-8 grid gap-5 sm:grid-cols-2">
            {g.features.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-lg font-bold">Key features</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground/80">
                  {g.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </section>
            )}
            {g.otherRetailers.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-lg font-bold">Also available at</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {g.otherRetailers.map((r) => (
                    <li key={r.url}>
                      <AffiliateButton href={r.url} subtle>
                        {r.name}
                      </AffiliateButton>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )
      }
      body={g.body}
      sponsored
    />
  );
}
