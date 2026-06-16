"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { RiNotification3Line, RiCheckDoubleLine, RiArrowRightLine } from "@remixicon/react";
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
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={
            unreadCount > 0
              ? `What's new — ${unreadCount} unread`
              : "What's new"
          }
        >
          <RiNotification3Line className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[22rem] p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">What&apos;s New</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RiCheckDoubleLine className="size-3.5" />
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-3 p-3">
              <div className="h-12 animate-pulse rounded-md bg-muted/50" />
              <div className="h-12 animate-pulse rounded-md bg-muted/50" />
            </div>
          ) : notes.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground/70">
              You&apos;re all caught up. Nothing new yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notes.map((note) => {
                const unread = !isRead(note.id);
                return (
                  <li key={note.id}>
                    <div
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
                        "cursor-pointer px-3 py-3 transition-colors hover:bg-accent",
                        unread && "bg-primary/[0.04]"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            unread ? "bg-primary" : "bg-transparent"
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {note.title}
                            </p>
                            {note.publishedAt && (
                              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                {formatDistanceToNow(new Date(note.publishedAt), {
                                  addSuffix: true,
                                })}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground [&_p]:my-0.5 [&_ul]:my-1">
                            <Markdown content={note.body} />
                          </div>
                          {note.linkHref && note.linkLabel && (
                            <Link
                              href={note.linkHref}
                              onClick={() => markRead(note.id)}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              {note.linkLabel}
                              <RiArrowRightLine className="size-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
