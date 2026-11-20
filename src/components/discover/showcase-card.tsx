import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { RiArrowUpLine, RiChat3Line } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { showcasePath } from "@/lib/discover/core";
import type { ShowcaseCard as Card } from "@/lib/discover/service";
import { ShowcaseCover } from "./showcase-cover";

export function ShowcaseCard({ s, showStatus = false }: { s: Card; showStatus?: boolean }) {
  const href = s.status === "draft" ? `${showcasePath(s)}/edit` : showcasePath(s);
  const when = s.publishedAt ?? s.updatedAt;
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <ShowcaseCover id={s.id} title={s.title} coverImageId={s.coverImageId} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 text-sm font-semibold text-zinc-900 group-hover:text-primary dark:text-zinc-50">
            {s.title || "Untitled showcase"}
          </h3>
          {showStatus && (
            <Badge variant={s.status === "published" ? "secondary" : "outline"} className="shrink-0">
              {s.takenDownReason ? "Taken down" : s.status === "published" ? "Published" : "Draft"}
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          {s.tagline || <span className="italic">No tagline yet</span>}
        </p>
        {s.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.tags.slice(0, 4).map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="truncate">
            {s.authorName} · {formatDistanceToNow(when, { addSuffix: true })}
          </span>
          {s.status === "published" && (
            <span className="flex shrink-0 items-center gap-2.5">
              <span className={`flex items-center gap-0.5 ${s.viewerUpvoted ? "text-primary" : ""}`}>
                <RiArrowUpLine size={13} /> {s.upvoteCount}
              </span>
              <span className="flex items-center gap-0.5">
                <RiChat3Line size={13} /> {s.commentCount}
              </span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
