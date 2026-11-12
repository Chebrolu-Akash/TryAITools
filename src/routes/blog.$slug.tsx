import { createFileRoute } from "@tanstack/react-router";
import {
  ContentDetailPage,
  ContentNotFound,
  formatDate,
  Minutes,
} from "@/components/site/ContentViews";
import { fetchContentItem } from "@/lib/content/api";
import type { PostDetail } from "@/lib/content/model";
import { detailHead, notFoundHead } from "@/lib/content/seo";

const SECTION = { label: "Blog", path: "/blog" };

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => fetchContentItem({ data: { section: "blog", slug: params.slug } }),
  staleTime: Infinity,
  head: ({ loaderData, params }) => {
    const path = `/blog/${params.slug}`;
    const p = loaderData?.item as PostDetail | undefined;
    if (!p) return notFoundHead(path, "Post");
    return detailHead({
      path,
      section: SECTION,
      title: p.title,
      seoTitle: p.seoTitle,
      description: p.seoDescription ?? p.excerpt ?? p.title,
      indexable: true,
      canonical: p.canonical,
      image: p.image,
      article: {
        type: "BlogPosting",
        author: p.author,
        published: p.publishedAt,
        modified: p.updatedAt,
      },
    });
  },
  notFoundComponent: () => <ContentNotFound what="Post" href="/blog" back="Read the blog" />,
  component: PostPage,
});

function PostPage() {
  const p = Route.useLoaderData().item as PostDetail;
  return (
    <ContentDetailPage
      section={{ label: SECTION.label, href: SECTION.path }}
      title={p.title}
      badges={p.tags.slice(0, 3).map((t) => (
        <span key={t} className="text-xs font-bold uppercase tracking-wide text-primary">
          {t}
        </span>
      ))}
      meta={
        <span className="inline-flex flex-wrap items-center gap-2">
          {p.author ?? "TryAITools team"} · {formatDate(p.publishedAt)} · <Minutes n={p.minutes} />
        </span>
      }
      lead={p.excerpt}
      image={p.image}
      body={p.body}
      sponsored={false}
    />
  );
}
