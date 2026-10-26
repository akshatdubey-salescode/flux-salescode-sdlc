import Link from "next/link";
import { RiAlertLine } from "@remixicon/react";
import type { AiBanner } from "@/lib/test-cases/ai-review/health";

const IST = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true } as const;

/**
 * Shown on the test-case pages while the AI review is on hold or struggling, so nobody waits for a review that
 * isn't coming. People can still review and approve without it.
 */
export function AiStatusBanner({ banner, isAdmin }: { banner: AiBanner | null; isAdmin: boolean }) {
  if (!banner) return null;
  const paused = banner.state === "paused";
  const why =
    banner.reason === "quota" ? "the AI service's quota or balance has run out"
    : banner.reason === "auth" ? "the AI service rejected its API key"
    : banner.reason === "rate_limited" ? "the AI service keeps rate limiting requests"
    : "the AI service isn't answering";
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <RiAlertLine className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-semibold">{paused ? "AI reviews are on hold" : "The AI review is having trouble"}</p>
        <p>
          {paused
            ? `Because ${why}, new submissions are saved without an AI review. Reviewers can still review and approve as usual; the AI review will be available again once the service recovers.`
            : `Because ${why}, some AI reviews may not complete. Reviewers can still review and approve as usual.`}{" "}
          Since {new Date(banner.since).toLocaleString("en-IN", IST)}.
        </p>
        {isAdmin && (
          <p>
            {banner.detail ? <span className="opacity-80">{banner.detail} </span> : null}
            <Link href="/admin/ai-guidelines" className="font-semibold underline underline-offset-2">
              Open AI status
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
