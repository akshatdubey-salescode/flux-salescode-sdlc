import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { RiArrowUpSLine, RiChat3Line } from "@remixicon/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { showcasePath } from "@/lib/discover/core";
import type { ShowcaseCard as Card } from "@/lib/discover/service";
import { cn } from "@/lib/utils";
import { ShowcaseCover } from "./showcase-cover";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Gallery tile: the cover is the card. Text sits below it, unboxed, with an
 * upvote tally on the right so popularity reads at a glance.
 */
export function ShowcaseCard({ s, showStatus = false }: { s: Card; showStatus?: boolean }) {
  const href = s.status === "draft" ? `${showcasePath(s)}/edit` : showcasePath(s);
  const when = s.publishedAt ?? s.updatedAt;
  const published = s.status === "published";
  const status = s.takenDownReason ? "Taken down" : published ? "Published" : "Draft";

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <div className="relative overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-950/10 transition-shadow group-hover:ring-2 group-hover:ring-primary/70 dark:bg-zinc-800 dark:ring-white/10">
        <ShowcaseCover id={s.id} title={s.title} coverImageId={s.coverImageId} />
        {showStatus && status !== "Published" && (
          <span
            className={cn(
              "absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-[11px] font-semibold shadow-sm",
              s.takenDownReason ? "bg-red-600 text-white" : "bg-white text-zinc-800 ring-1 ring-zinc-950/10",
            )}
          >
            {status}
          </span>
        )}
      </div>

      <div className="flex items-start gap-3 px-0.5">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-1 text-[15px] font-semibold leading-snug text-zinc-900 transition-colors group-hover:text-primary dark:text-zinc-50">
            {s.title || "Untitled showcase"}
          </h3>
          <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {s.tagline || <span className="italic text-zinc-400">No tagline yet</span>}
          </p>
          {s.tags.length > 0 && (
            <p className="line-clamp-1 pt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {s.tags.slice(0, 3).map((t) => `#${t}`).join("  ")}
            </p>
          )}
        </div>

        {published && (
          <div
            title={`${s.upvoteCount} upvote${s.upvoteCount === 1 ? "" : "s"}${s.viewerUpvoted ? ", including yours" : ""}`}
            className={cn(
              "flex w-11 shrink-0 flex-col items-center rounded-lg border pb-1.5 pt-0.5 tabular-nums",
              s.viewerUpvoted
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300",
            )}
          >
            <RiArrowUpSLine size={18} />
            <span className="-mt-1 text-sm font-semibold leading-none">{s.upvoteCount}</span>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 px-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Avatar size="sm" className="size-5">
          <AvatarFallback className="bg-zinc-200 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
            {initials(s.authorName)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{s.authorName}</span>
        <span className="shrink-0">{formatDistanceToNow(when, { addSuffix: true })}</span>
        {published && s.commentCount > 0 && (
          <span
            className="ml-auto flex shrink-0 items-center gap-1"
            title={`${s.commentCount} comment${s.commentCount === 1 ? "" : "s"}`}
          >
            <RiChat3Line size={13} /> {s.commentCount}
          </span>
        )}
      </div>
    </Link>
  );
}
