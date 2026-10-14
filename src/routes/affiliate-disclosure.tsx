import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/affiliate-disclosure")({
  head: () =>
    pageHead({
      title: "Affiliate Disclosure | TryAITools",
      description: "TryAITools may earn a commission when you use some links on the site. Here is how that works.",
      path: "/affiliate-disclosure",
    }),
  component: () => (
    <LegalPage title="Affiliate Disclosure" intro="Some links on TryAITools are affiliate links. This page explains what that means for you.">
      <section>
        <h2>What this means</h2>
        <p>
          If you click certain links and then sign up for or buy a product, TryAITools may earn a commission from the company at no extra cost to you.
        </p>
      </section>
      <section>
        <h2>Our independence</h2>
        <p>
          Commissions help keep the directory free. They do not decide whether a tool is listed or how it is categorized.
        </p>
      </section>
      <section>
        <h2>Identifying affiliate links</h2>
        <p>
          Outbound links are marked with <code>rel=&quot;sponsored&quot;</code> so search engines can tell they may be compensated.
        </p>
      </section>
    </LegalPage>
  ),
});
