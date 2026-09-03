"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RiExternalLinkLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adfToText } from "@/lib/jira/adf";
import { initials } from "@/components/project-tracking/helpers";

type JiraComment = {
  id: string;
  authorName: string | null;
  body: string | null; // ADF as a JSON string
  jiraCreatedAt: string | null;
};

/**
 * The Jira comment thread for one issue — comments are read live from Jira
 * (via /api/issues/[key], the same source the issue page uses) and new ones
 * are posted back to Jira as the logged-in user through their connected
 * Atlassian account. Jira stays the single source of truth; Flux keeps no
 * comment store of its own.
 */
export function ItemCommentsModal({
  jiraKey,
  jiraBaseUrl,
  summary,
  open,
  onOpenChange,
}: {
  jiraKey: string;
  jiraBaseUrl: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [comments, setComments] = useState<JiraComment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    fetch(`/api/issues/${encodeURIComponent(jiraKey)}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { comments: JiraComment[] }) =>
        setComments(
          [...(d.comments ?? [])].sort((a, b) => (b.jiraCreatedAt ?? "").localeCompare(a.jiraCreatedAt ?? ""))
        )
      )
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "Failed to load comments"));
  }, [jiraKey]);

  useEffect(() => {
    if (open) {
      setComments(null);
      load();
    }
  }, [open, load]);

  async function handlePost() {
    const text = draft.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(jiraKey)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          body.code === "ATLASSIAN_RECONNECT_REQUIRED" || body.code === "ATLASSIAN_SITE_ACCESS_REQUIRED"
            ? body.error
            : (body.error ?? "Failed to post comment")
        );
        return;
      }
      setDraft("");
      toast.success("Comment posted to Jira");
      load();
    } finally {
      setPosting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Comments — {jiraKey}
            <a
              href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${jiraKey}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open in Jira"
            >
              <RiExternalLinkLine className="size-3.5" />
            </a>
          </DialogTitle>
          <DialogDescription className="truncate">{summary}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loadError ? (
            <p className="text-xs text-destructive">Could not load comments: {loadError}</p>
          ) : comments === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No comments on this issue yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="rounded-md border border-border/60 p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold">
                    {initials(c.authorName)}
                  </span>
                  <span className="text-[11px] font-medium">{c.authorName ?? "Unknown"}</span>
                  {c.jiraCreatedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.jiraCreatedAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{adfToText(c.body) || "—"}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment — it will be posted to the Jira issue as you…"
            rows={3}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!draft.trim() || posting} onClick={handlePost}>
              {posting ? "Posting…" : "Post to Jira"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
