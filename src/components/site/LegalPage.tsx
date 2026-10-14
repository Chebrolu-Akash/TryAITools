import type { ReactNode } from "react";
import { Page } from "@/components/site/Layout";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/site";

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <Page>
      <section className="bg-hero pb-12 pt-14">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h1 className="text-4xl font-bold sm:text-5xl">{title}</h1>
          <p className="mt-4 text-foreground/75">{intro}</p>
          <p className="mt-2 text-xs text-foreground/60">Last updated: {LEGAL_UPDATED}</p>
        </div>
      </section>
      <article className="mx-auto max-w-3xl space-y-8 px-4 pt-12 text-sm leading-7 text-foreground/80 sm:px-6 sm:text-base [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
        {CONTACT_EMAIL && (
          <section>
            <h2>Contact</h2>
            <p>
              Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </section>
        )}
      </article>
    </Page>
  );
}
