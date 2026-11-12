import { createFileRoute } from "@tanstack/react-router";
import {
  ContentDetailPage,
  ContentNotFound,
  formatDate,
  SponsoredBadge,
  SPONSORED_REL,
} from "@/components/site/ContentViews";
import { fetchContentItem } from "@/lib/content/api";
import type { GuestDetail } from "@/lib/content/model";
import { detailHead, notFoundHead } from "@/lib/content/seo";

const SECTION = { label: "Guest Articles", path: "/guest-articles" };

export const Route = createFileRoute("/guest-articles/$slug")({
  loader: ({ params }) =>
    fetchContentItem({ data: { section: "guest-articles", slug: params.slug } }),
  staleTime: Infinity,
  head: ({ loaderData, params }) => {
    const path = `/guest-articles/${params.slug}`;
    const a = loaderData?.item as GuestDetail | undefined;
    if (!a) return notFoundHead(path, "Article");
    return detailHead({
      path,
      section: SECTION,
      title: a.title,
      seoTitle: a.seoTitle,
      description:
        a.seoDescription ?? a.excerpt ?? `${a.title}, a sponsored article by ${a.contributor}.`,
      indexable: a.indexable,
      canonical: a.canonical,
      image: a.image,
      article: {
        type: "Article",
        author: a.contributor,
        published: a.publishedAt,
        modified: a.updatedAt,
      },
    });
  },
  notFoundComponent: () => (
    <ContentNotFound what="Article" href="/guest-articles" back="Browse guest articles" />
  ),
  component: GuestArticlePage,
});

function GuestArticlePage() {
  const a = Route.useLoaderData().item as GuestDetail;
  const sponsor = a.sponsorUrl ? (
    <a
      href={a.sponsorUrl}
      target="_blank"
      rel={SPONSORED_REL}
      className="font-semibold text-primary"
    >
      {a.sponsor}
    </a>
  ) : (
    <strong>{a.sponsor}</strong>
  );
  return (
    <ContentDetailPage
      section={{ label: SECTION.label, href: SECTION.path }}
      title={a.title}
      badges={
        <>
          <SponsoredBadge label={a.sponsorLabel} />
          {a.topic && (
            <span className="text-xs font-bold uppercase tracking-wide text-primary">
              {a.topic}
            </span>
          )}
        </>
      }
      meta={
        <>
          By <strong className="text-foreground">{a.contributor}</strong> ·{" "}
          {formatDate(a.publishedAt)}
        </>
      }
      lead={a.excerpt}
      notice={
        <>
          {a.sponsorLabel}: this article was paid for by {sponsor} and written by its contributor,
          not by TryAITools. Links in it are sponsored links.
        </>
      }
      image={a.image}
      body={a.body}
      sponsored
    />
  );
}
