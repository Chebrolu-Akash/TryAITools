// The AI Learning Hub (/learn): shared <head> builders and detail layouts for courses, books and tutorials. Routes in
// src/routes/learn.* stay thin. Listing pages are noindex while empty; detail pages follow each entry's indexing flag.
import { redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  AffiliateButton,
  ContentDetailPage,
  RelatedResources,
} from "@/components/site/ContentViews";
import {
  LEARN_PATH,
  learnPathOf,
  LEVELS,
  type CourseCard,
  type CourseDetail,
  type LearnKind,
  type TutorialCard,
  type TutorialDetail,
} from "@/lib/content/model";
import { detailHead, notFoundHead } from "@/lib/content/seo";
import { pageHead } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const HUB = { label: "AI Learning Hub", href: "/learn" };
export const SECTION_LABEL: Record<LearnKind, string> = {
  course: "AI Courses",
  book: "AI Books",
  tutorial: "AI Tutorials",
};
const pill = "rounded-full bg-secondary px-3 py-1 text-xs font-bold text-primary";

/** Head for a listing page: its own title and description, noindex while it has no entries. */
export const listingHead = (path: string, title: string, description: string, count: number) =>
  pageHead({ title: `${title} | ${SITE_NAME}`, description, path, noindex: count === 0 });

/** A course URL used for a book (or the other way round) redirects to the entry's real URL. */
export function ensureKind(item: CourseDetail, want: "course" | "book") {
  if (item.kind !== want)
    throw redirect({ href: learnPathOf(item.kind, item.slug), statusCode: 301 });
}

export function courseHead(kind: "course" | "book", slug: string, c: CourseDetail | undefined) {
  const path = learnPathOf(kind, slug);
  if (!c || c.kind !== kind) return notFoundHead(path, kind === "book" ? "Book" : "Course");
  // Course / Book structured data only when we can name who provides or wrote it.
  const extra = c.provider
    ? [
        kind === "book"
          ? { "@type": "Book", name: c.title, author: { "@type": "Person", name: c.provider } }
          : {
              "@type": "Course",
              name: c.title,
              description: c.seoDescription ?? c.summary ?? c.title,
              provider: { "@type": "Organization", name: c.provider },
            },
      ]
    : [];
  return detailHead({
    path,
    section: { label: SECTION_LABEL[kind], path: LEARN_PATH[kind] },
    parents: [{ label: HUB.label, path: HUB.href }],
    title: c.title,
    seoTitle: c.seoTitle,
    description:
      c.seoDescription ??
      c.summary ??
      `${c.title}${c.provider ? ` by ${c.provider}` : ""}: our notes on this AI ${kind}.`,
    indexable: c.indexable,
    canonical: null,
    image: c.image,
    extra,
  });
}

export function tutorialHead(slug: string, t: TutorialDetail | undefined) {
  const path = learnPathOf("tutorial", slug);
  if (!t) return notFoundHead(path, "Tutorial");
  return detailHead({
    path,
    section: { label: SECTION_LABEL.tutorial, path: LEARN_PATH.tutorial },
    parents: [{ label: HUB.label, path: HUB.href }],
    title: t.title,
    seoTitle: t.seoTitle,
    description: t.seoDescription ?? t.summary ?? `${t.title}: an AI tutorial.`,
    indexable: t.indexable,
    canonical: null,
    image: t.image,
    // A tutorial written here is an article; a link-only one gets breadcrumbs only.
    ...(t.body.trim()
      ? {
          article: {
            type: "Article" as const,
            author: t.author,
            published: t.publishedAt,
            modified: t.updatedAt,
          },
        }
      : {}),
  });
}

const relatedCourses = (kind: "course" | "book", xs: CourseCard[]) =>
  xs.map((x) => ({
    kind,
    slug: x.slug,
    title: x.title,
    meta: [x.provider, kind === "course" ? LEVELS[x.level] : null].filter(Boolean).join(" · "),
  }));

export function CourseOrBookPage({
  kind,
  c,
  related,
}: {
  kind: "course" | "book";
  c: CourseDetail;
  related: CourseCard[];
}) {
  return (
    <ContentDetailPage
      parents={[HUB]}
      section={{ label: SECTION_LABEL[kind], href: LEARN_PATH[kind] }}
      title={c.title}
      badges={
        <>
          {kind === "course" && <span className={pill}>{LEVELS[c.level]}</span>}
          {c.isFree && <span className={pill}>Free</span>}
          {c.topics.slice(0, 3).map((t) => (
            <span key={t} className={pill}>
              {t}
            </span>
          ))}
        </>
      }
      meta={[c.provider, c.format, c.duration].filter(Boolean).join(" · ")}
      lead={c.summary}
      actions={
        <>
          {c.url && (
            <AffiliateButton href={c.url}>
              {kind === "book" ? "View book" : "View course"}
            </AffiliateButton>
          )}
          {c.price && <span className="text-xl font-bold">{c.price}</span>}
        </>
      }
      image={c.image}
      body={c.body}
      sponsored
      related={
        <RelatedResources
          title={kind === "book" ? "More AI books" : "More AI courses"}
          items={relatedCourses(kind, related)}
        />
      }
    />
  );
}

export function TutorialPage({ t, related }: { t: TutorialDetail; related: TutorialCard[] }) {
  return (
    <ContentDetailPage
      parents={[HUB]}
      section={{ label: SECTION_LABEL.tutorial, href: LEARN_PATH.tutorial }}
      title={t.title}
      badges={
        <>
          <span className={pill}>{LEVELS[t.difficulty]}</span>
          {t.isFree && <span className={pill}>Free</span>}
          {t.topics.slice(0, 3).map((x) => (
            <span key={x} className={pill}>
              {x}
            </span>
          ))}
        </>
      }
      meta={[t.author, t.format, t.duration].filter(Boolean).join(" · ")}
      lead={t.summary}
      actions={
        t.url &&
        (t.isAffiliate ? (
          <AffiliateButton href={t.url}>Open the tutorial</AffiliateButton>
        ) : (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-gradient-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
          >
            Open the tutorial
          </a>
        ))
      }
      image={t.image}
      body={t.body}
      sponsored={t.isAffiliate}
      related={
        <RelatedResources
          title="More AI tutorials"
          items={related.map((x) => ({
            kind: "tutorial" as const,
            slug: x.slug,
            title: x.title,
            meta: [x.author, LEVELS[x.difficulty]].filter(Boolean).join(" · "),
          }))}
        />
      }
    />
  );
}

/** Intro block under a listing heading: a sentence of real help plus links to the sibling sections. */
export function SiblingLinks({ current }: { current: LearnKind }): ReactNode {
  return (
    <span className="mt-3 flex flex-wrap gap-2 text-sm">
      {(Object.keys(LEARN_PATH) as LearnKind[])
        .filter((k) => k !== current)
        .map((k) => (
          <a
            key={k}
            href={LEARN_PATH[k]}
            className="rounded-full border border-primary/20 bg-background px-3 py-1 font-semibold text-primary hover:border-primary/50"
          >
            {SECTION_LABEL[k]}
          </a>
        ))}
    </span>
  );
}
