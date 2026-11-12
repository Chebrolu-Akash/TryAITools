import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Page } from "@/components/site/Layout";

/**
 * The shared layout of the AI Courses, AI Gadgets, Guest Articles and Blog sections (approved design): breadcrumb,
 * heading, intro and an optional notice, then the section's content (`children`). Until a section has entries it
 * shows `empty`.
 */
export function Crumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <a href="/" className="hover:text-primary">
            TryAITools
          </a>
        </li>
        {trail.map((t) => (
          <li key={t.label} className="flex items-center gap-1">
            <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            {t.href ? (
              <a href={t.href} className="hover:text-primary">
                {t.label}
              </a>
            ) : (
              <span aria-current="page" className="font-semibold text-foreground">
                {t.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SectionLanding({
  title,
  intro,
  notice,
  aside,
  empty,
  children,
  parents = [],
}: {
  title: string;
  intro: ReactNode;
  notice?: ReactNode;
  aside?: ReactNode;
  empty: { heading: string; text: ReactNode };
  children?: ReactNode;
  /** breadcrumb levels above this page (e.g. the Learning Hub) */
  parents?: { label: string; href: string }[];
}) {
  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="page-container flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0 flex-[1_1_520px]">
            <Crumbs trail={[...parents, { label: title }]} />
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{title}</h1>
            <div className="mt-3 max-w-2xl text-base text-foreground/75 sm:text-lg">{intro}</div>
            {notice && (
              <p className="mt-4 inline-flex rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                {notice}
              </p>
            )}
          </div>
          {aside}
        </div>
      </section>
      {children ?? (
        <div className="page-container pt-10">
          <div className="rounded-3xl border border-dashed border-primary/25 bg-secondary px-6 py-16 text-center">
            <h2 className="text-2xl font-bold">{empty.heading}</h2>
            <div className="mx-auto mt-3 max-w-xl text-muted-foreground">{empty.text}</div>
            <a
              href="/"
              className="mt-6 inline-flex rounded-full bg-gradient-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-soft transition hover:opacity-90"
            >
              Browse AI Tools
            </a>
          </div>
        </div>
      )}
    </Page>
  );
}
