import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () =>
    pageHead({
      title: "Terms of Use | TryAITools",
      description: "The terms that apply when you use the TryAITools directory of AI tools.",
      path: "/terms",
    }),
  component: () => (
    <LegalPage title="Terms of Use" intro="By using TryAITools you agree to these terms. Please read them.">
      <section>
        <h2>The service</h2>
        <p>
          TryAITools is a free directory that helps you discover AI tools. We list and categorize third-party products; we do not own, operate or endorse them unless we say so.
        </p>
      </section>
      <section>
        <h2>No warranty</h2>
        <p>
          Listings are provided &quot;as is&quot;. We work to keep information accurate, but tools change quickly and we cannot guarantee that names, links, pricing or features are current or complete. Check the tool&apos;s own website before relying on it.
        </p>
      </section>
      <section>
        <h2>Third-party sites</h2>
        <p>
          We are not responsible for the content, security, availability or policies of third-party websites you reach through TryAITools. Your use of those tools is governed by their terms.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not attempt to disrupt, overload or gain unauthorized access to the site.</li>
          <li>Do not scrape the site at a rate that degrades service for others.</li>
          <li>Do not use the site for any unlawful purpose.</li>
        </ul>
      </section>
      <section>
        <h2>Intellectual property</h2>
        <p>
          The TryAITools name, logo, design and curation are our property. Third-party product names and logos belong to their respective owners and are shown only to identify those products.
        </p>
      </section>
      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, TryAITools is not liable for any indirect or consequential loss arising from your use of the site or of any tool listed on it.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>We may update these terms. Continued use of the site after a change means you accept the updated terms.</p>
      </section>
    </LegalPage>
  ),
});
