"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  RiNotification3Line,
  RiCheckDoubleLine,
  RiArrowRightLine,
  RiSparklingLine,
} from "@remixicon/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { useWhatsNew } from "./context";

export function WhatsNewBell() {
  const { notes, loading, unreadCount, isRead, markRead, markAllRead } =
    useWhatsNew();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-full"
          aria-label={
            unreadCount > 0
              ? `What's new — ${unreadCount} unread`
              : "What's new"
          }
        >
          <RiNotification3Line className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground shadow-sm">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[24rem] p-0 gap-0 overflow-hidden bg-popover/95 backdrop-blur-md border border-border/60 shadow-[0_20px_50px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.28)] rounded-2xl animate-in fade-in-50 zoom-in-95"
      >
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 bg-muted/10">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <RiSparklingLine className="size-3.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">What&apos;s New</span>
            {unreadCount > 0 && (
              <span className="inline-flex h-4 items-center justify-center rounded-full bg-primary/12 px-1.5 text-[10px] font-semibold text-primary">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-all duration-150 py-1 px-1.5 rounded-md hover:bg-muted/50"
            >
              <RiCheckDoubleLine className="size-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5 pr-1 overscroll-contain custom-scrollbar">
          {loading ? (
            <div className="space-y-2 p-1">
              {[1, 2].map((i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border/40 p-2.5 animate-pulse">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-12 rounded bg-muted/80" />
                    <div className="h-3 w-16 rounded bg-muted/65" />
                  </div>
                  <div className="h-4 w-5/6 rounded bg-muted/80" />
                  <div className="space-y-1">
                    <div className="h-3 w-full rounded bg-muted/60" />
                    <div className="h-3 w-4/5 rounded bg-muted/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 text-primary ring-1 ring-primary/20 mb-3 shadow-sm">
                <RiCheckDoubleLine className="size-5.5" />
              </div>
              <p className="text-sm font-semibold text-foreground">All caught up!</p>
              <p className="mt-1 text-xs text-muted-foreground/80 max-w-[220px] leading-normal">
                You&apos;re running the latest version with all updates seen.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {notes.map((note) => {
                const unread = !isRead(note.id);
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => markRead(note.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        markRead(note.id);
                      }
                    }}
                    className={cn(
                      "group relative flex flex-col items-start rounded-lg p-2.5 text-left transition-all duration-200 outline-none select-none border border-transparent cursor-pointer w-full",
                      unread
                        ? "bg-primary/[0.02] border-primary/5 hover:bg-primary/[0.04]"
                        : "hover:bg-muted/50"
                    )}
                  >
                    {unread && (
                      <span
                        className="absolute left-1 top-2.5 bottom-2.5 w-[3px] rounded-full bg-primary"
                        aria-hidden
                      />
                    )}
                    
                    <div className="w-full">
                      <div className="flex items-center gap-2 mb-1 w-full">
                        {note.type === "ALERT" ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
                            Announcement
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20">
                            Update
                          </span>
                        )}
                        {note.publishedAt && (
                          <span className="text-[10px] text-muted-foreground/75 font-medium ml-auto">
                            {formatDistanceToNow(new Date(note.publishedAt), {
                              addSuffix: true,
                            })}
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-foreground leading-snug tracking-tight mb-1 w-full">
                        {note.title}
                      </h4>

                      <div className="text-xs text-muted-foreground/90 leading-relaxed [&_p]:text-xs [&_p]:text-muted-foreground/90 [&_p]:leading-relaxed [&_p]:my-0.5 [&_ul]:my-0.5 [&_li]:text-xs [&_li]:text-muted-foreground/90 [&_strong]:text-foreground [&_strong]:font-semibold">
                        <Markdown content={note.body} />
                      </div>

                      {note.linkHref && note.linkLabel && (
                        <Link
                          href={note.linkHref}
                          onClick={() => markRead(note.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors group/link"
                        >
                          <span>{note.linkLabel}</span>
                          <RiArrowRightLine className="size-3 transition-transform duration-150 group-hover/link:translate-x-0.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
