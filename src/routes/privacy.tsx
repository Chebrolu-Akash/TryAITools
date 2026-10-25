import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/site/LegalPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageHead({
      title: "Privacy Policy | TryAITools",
      description: "How TryAITools handles your data: what we collect, what third parties are involved, and your choices.",
      path: "/privacy",
    }),
  component: () => (
    <LegalPage title="Privacy Policy" intro="We keep data collection to a minimum. Here is exactly what happens when you use TryAITools.">
      <section>
        <h2>Information we collect</h2>
        <p>
          TryAITools does not require an account and does not ask for personal information. The search box on this site runs in your browser; the text you type is not stored by us.
        </p>
      </section>
      <section>
        <h2>Server logs</h2>
        <p>
          Like most websites, our hosting provider may automatically record technical information such as IP address, browser type, requested page and timestamp. This is used to deliver, secure and troubleshoot the service.
        </p>
      </section>
      <section>
        <h2>Third-party services</h2>
        <ul>
          <li><strong>Google Fonts</strong> serves the typefaces used on this site, so your browser contacts Google when a page loads.</li>
          <li><strong>Tool logos</strong> are loaded from Google&apos;s favicon service, so your browser requests them from Google servers.</li>
          <li><strong>Google Analytics 4</strong> measures how visitors use the site (pages viewed, approximate location, device and browser) so we can improve it.</li>
          <li><strong>Cloud hosting and CDN</strong> providers deliver the site and may process request data on our behalf.</li>
        </ul>
        <p>These providers have their own privacy policies and we do not control how they handle data.</p>
      </section>
      <section>
        <h2>Cookies and analytics</h2>
        <p>
          We do not set advertising cookies. Google Analytics may set cookies or use similar identifiers to recognize returning visitors and measure usage in aggregate. You can opt out with the <a href="https://tools.google.com/dlpage/gaoptout">Google Analytics opt-out browser add-on</a> or by blocking cookies in your browser settings.
        </p>
      </section>
      <section>
        <h2>Outbound links and affiliate links</h2>
        <p>
          Listings link to third-party websites. Some of those links are affiliate links (see our <a href="/affiliate-disclosure">Affiliate Disclosure</a>). Once you leave TryAITools, the destination site&apos;s privacy policy applies.
        </p>
      </section>
      <section>
        <h2>Children</h2>
        <p>TryAITools is not directed to children under 13 and we do not knowingly collect their information.</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <p>
          Depending on where you live (for example under the GDPR, UK GDPR or CCPA) you may have rights to access, correct or delete personal data we hold. Because we hold very little, requests are usually simple to resolve.
        </p>
      </section>
      <section>
        <h2>Changes to this policy</h2>
        <p>We may update this policy from time to time. The &quot;Last updated&quot; date above shows when it last changed.</p>
      </section>
    </LegalPage>
  ),
});
