import Link from "next/link";
import { RiDownload2Line, RiExternalLinkLine, RiGoogleLine, RiShieldCheckLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { withReturnTo } from "@/lib/test-cases/return-to";
import type { SignoffView } from "@/lib/test-cases/signoff-service";

const ROLE_LABEL = { dev: "Developer", tester: "Tester" } as const;

export type SignoffAction = { role: "dev" | "tester"; allowed: boolean; reason: string | null };

export function SignoffPanel({
  issueId,
  returnTo,
  signoffs,
  actions,
  isLatest,
  approved,
  resubmit,
  openFeedback,
}: {
  issueId: string;
  returnTo: string | null;
  signoffs: SignoffView[];
  actions: SignoffAction[];
  isLatest: boolean;
  approved: boolean;
  /** A reviewer asked for changes: the sheet has to be fixed and resubmitted before anything else. */
  resubmit: boolean;
  /** Unresolved feedback comments on the round. */
  openFeedback: number;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <RiShieldCheckLine className="size-4" /> Sign-off
        </h2>
        {isLatest && approved && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) =>
              a.allowed ? (
                <Link
                  key={a.role}
                  href={withReturnTo(`/test-cases/signoff?issue=${issueId}&role=${a.role}`, returnTo)}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
                >
                  {signoffs.some((s) => s.role === a.role) ? `Re-submit ${ROLE_LABEL[a.role].toLowerCase()} sign-off` : `Sign off as ${ROLE_LABEL[a.role].toLowerCase()}`}
                </Link>
              ) : null,
            )}
          </div>
        )}
      </div>

      {isLatest && !approved && (
        <p className="text-xs text-muted-foreground">
          {resubmit
            ? "Sign-off is closed while feedback is open: a reviewer asked for changes. Resubmit the test cases; sign-off opens once they are approved and the feedback is resolved or waived."
            : "Sign-off opens once a reviewer approves this round."}
        </p>
      )}
      {isLatest && approved && openFeedback > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Sign-off is closed until the {openFeedback} open feedback item{openFeedback === 1 ? " is" : "s are"} resolved or waived (see the comments below).
        </p>
      )}
      {isLatest && approved && openFeedback === 0 && actions.every((a) => !a.allowed) && (
        <p className="text-xs text-muted-foreground">
          Only the issue&apos;s developer(s) and tester(s) can sign off ({actions.map((a) => `${ROLE_LABEL[a.role]}: ${a.reason ?? "allowed"}`).join(" · ")}).
        </p>
      )}
      {!isLatest && <p className="text-xs text-muted-foreground">Showing sign-offs recorded against this older round. Sign-off applies to the latest approved round.</p>}

      {signoffs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sign-off uploaded for this round yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {signoffs.map((s) => (
            <li key={s.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2 text-xs", !s.current && "opacity-60")}>
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {ROLE_LABEL[s.role]} · {s.by}
                  {!s.current && <span className="ml-1.5 font-normal text-muted-foreground">(replaced)</span>}
                </p>
                <p className="text-muted-foreground">
                  {s.label} · <span className="text-emerald-600">{s.pass} passed</span> · <span className="text-red-600">{s.fail} failed</span> ·{" "}
                  <span className="text-amber-600">{s.blocked} blocked</span> · {s.notRun} not run
                </p>
                {s.meta && <p className="text-muted-foreground">{s.meta}</p>}
                {s.notes && <p className="whitespace-pre-wrap text-foreground">{s.notes}</p>}
              </div>
              <div className="flex gap-2">
                {s.sheetUrl && (
                  <a href={s.sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    <RiGoogleLine className="size-3.5" /> Open sheet <RiExternalLinkLine className="size-3 opacity-60" />
                  </a>
                )}
                {s.fileId && (
                  <a href={`/api/test-cases/files/${s.fileId}`} title={s.fileName ?? undefined} className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    <RiDownload2Line className="size-3.5" /> Download
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
