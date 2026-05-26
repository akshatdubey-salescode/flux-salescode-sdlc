import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Flux by Salescode.ai",
};

const EFFECTIVE_DATE = "April 16, 2025";
const CONTACT_EMAIL = "hello@salescode.ai";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors mb-8"
          >
            ← Back to Flux
          </Link>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mt-4">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-8 text-zinc-700 dark:text-zinc-300">

          <Section title="1. Overview">
            <p>
              Flux (&ldquo;the App&rdquo;) is an internal software development lifecycle tracker
              operated by Salescode.ai (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). This Privacy Policy describes how
              we collect, use, and protect information when you use Flux, including
              when you connect your Atlassian account to enable Jira integration.
            </p>
            <p>
              Flux is an internal tool intended exclusively for employees and
              authorised personnel of Salescode.ai. Access is restricted to
              verified @salescode.ai Google accounts.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <Subsection title="2.1 Account Information">
              <p>
                When you sign in, we collect your name, email address, and profile
                image from your Salescode.ai Google account via Clerk authentication.
              </p>
            </Subsection>
            <Subsection title="2.2 Atlassian OAuth Tokens">
              <p>
                When you connect your Atlassian account, we receive and store:
              </p>
              <ul>
                <li>An OAuth access token (short-lived)</li>
                <li>An OAuth refresh token (long-lived, used to obtain new access tokens)</li>
                <li>Your Atlassian account ID and email address</li>
              </ul>
              <p>
                These tokens are encrypted at rest using AES-256-GCM and are used
                solely to perform actions in Jira on your behalf — specifically,
                creating issues from requirements you choose to publish.
              </p>
            </Subsection>
            <Subsection title="2.3 Jira Data">
              <p>
                We sync issue metadata, status history, and comments from your
                connected Jira projects into our database to power analytics,
                SLA tracking, and search features. This sync uses a shared
                site-level credential configured by your Salescode.ai administrator,
                not your personal OAuth token.
              </p>
            </Subsection>
            <Subsection title="2.4 Usage Data">
              <p>
                We may collect standard server logs including IP addresses,
                timestamps, and request paths for security monitoring and
                debugging purposes.
              </p>
            </Subsection>
          </Section>

          <Section title="3. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul>
              <li>Authenticate and authorise access to Flux</li>
              <li>Publish Jira issues on your behalf using your connected Atlassian account, so that you appear as the creator in Jira</li>
              <li>Display Jira project data, analytics, and SLA insights</li>
              <li>Maintain security audit logs</li>
            </ul>
            <p>
              We do not sell, share, or disclose your personal information or
              OAuth tokens to any third party except Atlassian (as the OAuth
              provider) and the infrastructure services that host the App
              (database, hosting platform).
            </p>
          </Section>

          <Section title="4. Data Storage and Security">
            <p>
              All data is stored on servers within our controlled infrastructure.
              OAuth tokens are encrypted at rest using AES-256-GCM encryption.
              Access to the database is restricted to authorised services and
              personnel only.
            </p>
            <p>
              We use HTTPS for all data in transit.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p>
              Your Atlassian OAuth tokens are retained until you disconnect your
              Atlassian account from the Settings page, or until your Flux account
              is removed. You may disconnect your Atlassian integration at any time
              from <strong>/settings</strong>, which immediately deletes your stored tokens.
            </p>
            <p>
              Jira issue data synced into Flux is retained as long as the
              associated Jira project remains onboarded. Removing a project from
              Flux deletes all associated synced data.
            </p>
          </Section>

          <Section title="6. Your Rights">
            <p>
              As a Salescode.ai employee using this internal tool, you may:
            </p>
            <ul>
              <li>Disconnect your Atlassian integration at any time from the Settings page</li>
              <li>Request deletion of your personal data by contacting us at the address below</li>
            </ul>
          </Section>

          <Section title="7. Third-Party Services">
            <p>
              Flux integrates with the following third-party services, each with
              their own privacy policies:
            </p>
            <ul>
              <li><strong>Atlassian</strong> — OAuth provider and Jira issue tracking</li>
              <li><strong>Clerk</strong> — Authentication and user management</li>
              <li><strong>GitHub</strong> — Repository metadata for the AI requirement builder</li>
            </ul>
          </Section>

          <Section title="8. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Changes will
              be reflected by updating the effective date at the top of this page.
              Continued use of Flux after changes constitutes acceptance of the
              updated policy.
            </p>
          </Section>

          <Section title="9. Contact">
            <p>
              For questions about this Privacy Policy or your data, contact us at:
            </p>
            <p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-primary font-medium underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Subsection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
