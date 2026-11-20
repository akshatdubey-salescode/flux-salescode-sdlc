"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiDeleteBin2Line, RiEditLine, RiEyeOffLine, RiShieldLine, RiSendPlaneLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteShowcase,
  publishShowcase,
  takeDownShowcase,
  unpublishShowcase,
} from "@/app/(app)/discover/actions";
import { TAKEDOWN_REASON_MAX } from "@/lib/discover/core";

export function ShowcaseActions({
  id,
  editHref,
  status,
  isAuthor,
  isAdmin,
}: {
  id: string;
  editHref: string;
  status: "draft" | "published";
  isAuthor: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [takedownOpen, setTakedownOpen] = useState(false);

  function run(fn: () => Promise<{ error?: string; path?: string }>, ok: string, after?: (path?: string) => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(ok);
      if (after) after(res.path);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isAuthor && (
        <>
          <Button asChild variant="outline" size="lg">
            <Link href={editHref}>
              <RiEditLine />
              Edit
            </Link>
          </Button>
          {status === "published" ? (
            <Button
              variant="outline"
              size="lg"
              disabled={pending}
              onClick={() => run(() => unpublishShowcase(id), "Moved back to drafts")}
            >
              <RiEyeOffLine />
              Unpublish
            </Button>
          ) : (
            <Button size="lg" disabled={pending} onClick={() => run(() => publishShowcase(id), "Published")}>
              <RiSendPlaneLine />
              Publish
            </Button>
          )}
        </>
      )}
      {isAdmin && !isAuthor && status === "published" && (
        <Dialog open={takedownOpen} onOpenChange={setTakedownOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="lg" disabled={pending}>
              <RiShieldLine />
              Take down
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Take down this showcase?</DialogTitle>
              <DialogDescription>
                It goes back to the author&apos;s drafts (nothing is deleted) and they get an email with your reason.
                They can fix it and publish again.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={TAKEDOWN_REASON_MAX}
              rows={4}
              placeholder="e.g. A screenshot shows a client's data. Please blur it and republish."
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setTakedownOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  run(() => takeDownShowcase(id, reason), "Taken down, the author has been emailed", () => {
                    setTakedownOpen(false);
                    router.push("/discover");
                  })
                }
              >
                Take down
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {(isAuthor || isAdmin) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon-lg" disabled={pending} aria-label="Delete showcase" className="text-red-600 hover:text-red-700">
              <RiDeleteBin2Line />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this showcase?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes it, with its upvotes, comments and images. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => run(() => deleteShowcase(id), "Showcase deleted", () => router.push("/discover"))}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
