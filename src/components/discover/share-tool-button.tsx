"use client";

import { useActionState, useState } from "react";
import { RiAddLine } from "@remixicon/react";
import { createShowcase } from "@/app/(app)/discover/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TITLE_MAX } from "@/lib/discover/core";

/** "Share a tool": asks for the tool's name first, so no empty drafts get created. */
export function ShareToolButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createShowcase, {});
  const [title, setTitle] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTitle("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="lg">
          <RiAddLine />
          Share a tool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Share a tool</DialogTitle>
            <DialogDescription>
              Start with its name. You can add a description, screenshots and links next, and publish when it&apos;s
              ready.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="share-tool-title">Tool name</Label>
            <Input
              id="share-tool-title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="e.g. promo-utils"
              autoComplete="off"
              autoFocus
              required
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "share-tool-error" : undefined}
            />
            {state.error && (
              <p id="share-tool-error" className="text-xs text-destructive">
                {state.error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
