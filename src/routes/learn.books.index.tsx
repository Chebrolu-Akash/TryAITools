import { createFileRoute } from "@tanstack/react-router";
import { BooksList } from "@/components/site/ContentViews";
import { HUB, listingHead, SiblingLinks } from "@/components/site/LearnPages";
import { SectionLanding } from "@/components/site/SectionLanding";
import { fetchContentList } from "@/lib/content/api";
import type { CourseCard } from "@/lib/content/model";

export const Route = createFileRoute("/learn/books/")({
  loader: async () => ({
    items: ((await fetchContentList({ data: "courses" })).items as CourseCard[]).filter(
      (c) => c.kind === "book",
    ),
  }),
  staleTime: Infinity,
  head: ({ loaderData }) =>
    listingHead(
      "/learn/books",
      "AI Books Worth Reading",
      "Books that explain how AI works and how to use it, chosen for clarity and practical value, with author, topic and price.",
      loaderData?.items.length ?? 0,
    ),
  component: BooksPage,
});

function BooksPage() {
  const { items } = Route.useLoaderData();
  return (
    <SectionLanding
      title="AI Books"
      parents={[HUB]}
      intro={
        <>
          Books that explain the ideas behind AI and how to put them to work. Filter by topic,
          author or price.
          <SiblingLinks current="book" />
        </>
      }
      empty={{
        heading: "Our first book picks are on the way",
        text: "We are reading and reviewing books now. In the meantime, explore AI tools in the directory.",
      }}
    >
      {items.length > 0 ? <BooksList items={items} /> : undefined}
    </SectionLanding>
  );
}
