import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Flux by Salescode.ai",
};

const EFFECTIVE_DATE = "April 16, 2025";
const CONTACT_EMAIL = "hello@salescode.ai";

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Effective date: {EFFECTIVE_DATE}
          </p>
        </div>

        <div className="space-y-8 text-zinc-700 dark:text-zinc-300">

          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using Flux (&ldquo;the App&rdquo;), you agree to be bound by
              these Terms of Service. Flux is operated by Salescode.ai and is made
              available exclusively to authorised Salescode.ai employees and personnel.
            </p>
            <p>
              If you do not agree to these terms, you must not use the App.
            </p>
          </Section>

          <Section title="2. Authorised Use">
            <p>
              Flux is an internal tool. Access is limited to individuals with a
              verified @salescode.ai Google account. You agree to:
            </p>
            <ul>
              <li>Use Flux only for legitimate business purposes related to your role at Salescode.ai</li>
              <li>Not share your credentials or access with anyone outside the organisation</li>
              <li>Not attempt to access data or systems beyond your authorised permissions</li>
              <li>Not use Flux to store, transmit, or process data that violates any applicable law</li>
            </ul>
          </Section>

          <Section title="3. Atlassian Integration">
            <p>
              Flux allows you to connect your personal Atlassian account via OAuth 2.0
              to publish requirements directly to Jira on your behalf. By connecting
              your Atlassian account, you:
            </p>
            <ul>
              <li>Authorise Flux to create Jira issues using your account credentials</li>
              <li>Acknowledge that Jira issues created through Flux will appear as created by you</li>
              <li>Accept responsibility for the content of requirements you publish to Jira</li>
            </ul>
            <p>
              You may revoke this authorisation at any time from the Settings page.
              Revocation removes your stored OAuth tokens from our systems immediately.
            </p>
          </Section>

          <Section title="4. Intellectual Property">
            <p>
              Flux and its source code are proprietary to Salescode.ai. All rights
              are reserved. You may not copy, modify, distribute, or create derivative
              works based on the App without explicit written permission from Salescode.ai.
            </p>
            <p>
              Data you create within Flux — such as requirements — remains your
              intellectual property and that of Salescode.ai as your employer,
              subject to your employment agreement.
            </p>
          </Section>

          <Section title="5. Availability and Changes">
            <p>
              Flux is provided on an &ldquo;as is&rdquo; basis for internal use. We make no
              guarantee of uptime, availability, or fitness for any particular purpose.
              We may modify, suspend, or discontinue features of Flux at any time
              without notice.
            </p>
          </Section>

          <Section title="6. Limitation of Liability">
            <p>
              To the fullest extent permitted by law, Salescode.ai shall not be
              liable for any indirect, incidental, special, or consequential damages
              arising from your use of Flux or the Atlassian integration, including
              any errors in requirements published to Jira.
            </p>
          </Section>

          <Section title="7. Governing Law">
            <p>
              These Terms are governed by the laws of the jurisdiction in which
              Salescode.ai is incorporated, without regard to conflict of law principles.
            </p>
          </Section>

          <Section title="8. Changes to These Terms">
            <p>
              We may update these Terms from time to time. Continued use of Flux
              after any changes constitutes your acceptance of the updated Terms.
              Material changes will be communicated via internal channels.
            </p>
          </Section>

          <Section title="9. Contact">
            <p>
              For questions about these Terms, contact us at:
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
      <div className="space-y-3 text-[15px] leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
