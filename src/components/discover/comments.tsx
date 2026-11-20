"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { addComment, deleteComment, editComment } from "@/app/(app)/discover/actions";
import { COMMENT_MAX } from "@/lib/discover/core";
import type { CommentView } from "@/lib/discover/service";

type Ctx = { showcaseId: string; viewerId: string; isAdmin: boolean; canComment: boolean };

function Composer({
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        maxLength={COMMENT_MAX}
        rows={3}
        autoFocus={autoFocus}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-zinc-400">Markdown supported</span>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button
          disabled={pending || !body.trim()}
          onClick={() =>
            startTransition(async () => {
              if (await onSubmit(body)) setBody("");
            })
          }
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function CommentItem({ c, ctx, isReply }: { c: CommentView; ctx: Ctx; isReply: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const [pending, startTransition] = useTransition();
  const mine = c.authorId === ctx.viewerId;

  async function handle(res: Promise<{ error?: string }>) {
    const r = await res;
    if (r.error) {
      toast.error(r.error);
      return false;
    }
    setMode("view");
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{c.authorName}</span>
          <span>{formatDistanceToNow(c.createdAt, { addSuffix: true })}</span>
          {c.editedAt && <span className="italic">(edited)</span>}
        </div>
        {mode === "edit" ? (
          <Composer
            initial={c.body}
            placeholder="Edit your comment"
            submitLabel="Save"
            autoFocus
            onSubmit={(body) => handle(editComment(c.id, body))}
            onCancel={() => setMode("view")}
          />
        ) : (
          <Markdown content={c.body} />
        )}
        {mode === "view" && (
          <div className="mt-2 flex gap-1">
            {!isReply && ctx.canComment && (
              <Button variant="ghost" size="xs" onClick={() => setMode("reply")}>
                Reply
              </Button>
            )}
            {mine && (
              <Button variant="ghost" size="xs" onClick={() => setMode("edit")}>
                Edit
              </Button>
            )}
            {(mine || ctx.isAdmin) && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="xs" disabled={pending} className="text-red-600 hover:text-red-700">
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {!isReply && c.replies.length
                        ? "Its replies are deleted too. This cannot be undone."
                        : "This cannot be undone."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => startTransition(() => void handle(deleteComment(c.id)))}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>
      {(c.replies.length > 0 || mode === "reply") && (
        <div className="ml-6 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
          {c.replies.map((r) => (
            <CommentItem key={r.id} c={r} ctx={ctx} isReply />
          ))}
          {mode === "reply" && (
            <Composer
              placeholder={`Reply to ${c.authorName}`}
              submitLabel="Reply"
              autoFocus
              onSubmit={(body) => handle(addComment(ctx.showcaseId, body, c.id))}
              onCancel={() => setMode("view")}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function Comments({ comments, ...ctx }: Ctx & { comments: CommentView[] }) {
  const router = useRouter();
  const total = comments.reduce((n, c) => n + 1 + c.replies.length, 0);
  return (
    <section id="comments" className="space-y-4">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Comments {total > 0 && <span className="text-zinc-400">({total})</span>}
      </h2>
      {ctx.canComment ? (
        <Composer
          placeholder="Ask a question or share feedback…"
          submitLabel="Comment"
          onSubmit={async (body) => {
            const r = await addComment(ctx.showcaseId, body, null);
            if (r.error) {
              toast.error(r.error);
              return false;
            }
            router.refresh();
            return true;
          }}
        />
      ) : (
        <p className="text-sm text-zinc-500">Comments open once this showcase is published.</p>
      )}
      <div className="space-y-3">
        {comments.map((c) => (
          <CommentItem key={c.id} c={c} ctx={ctx} isReply={false} />
        ))}
      </div>
    </section>
  );
}
