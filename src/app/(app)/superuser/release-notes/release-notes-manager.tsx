"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  RiAddLine,
  RiDeleteBin2Line,
  RiEdit2Line,
  RiMegaphoneLine,
  RiInformationLine,
  RiExternalLinkLine,
} from "@remixicon/react";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { cn } from "@/lib/utils";
import {
  createReleaseNote,
  updateReleaseNote,
  deleteReleaseNote,
  setReleaseNotePublished,
  type ReleaseNoteInput,
} from "./actions";

export type ReleaseNoteRow = {
  id: string;
  title: string;
  body: string;
  type: "INFO" | "ALERT";
  linkLabel: string | null;
  linkHref: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
};

const EMPTY: ReleaseNoteInput = {
  title: "",
  body: "",
  type: "INFO",
  linkLabel: "",
  linkHref: "",
  isPublished: true,
};

export function ReleaseNotesManager({ notes }: { notes: ReleaseNoteRow[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReleaseNoteRow | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(note: ReleaseNoteRow) {
    setEditing(note);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-1.5">
          <RiAddLine className="size-4" />
          New note
        </Button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {notes.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
            No release notes yet. Create one to announce a change.
          </div>
        ) : (
          notes.map((note) => (
            <NoteRow key={note.id} note={note} onEdit={() => openEdit(note)} />
          ))
        )}
      </div>

      <NoteDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        note={editing}
      />
    </div>
  );
}

function NoteRow({
  note,
  onEdit,
}: {
  note: ReleaseNoteRow;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function togglePublished() {
    startTransition(async () => {
      await setReleaseNotePublished(note.id, !note.isPublished);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteReleaseNote(note.id);
      router.refresh();
    });
  }

  const isAlert = note.type === "ALERT";

  return (
    <div className={cn("flex items-start gap-3 px-5 py-4", isPending && "opacity-60")}>
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          isAlert
            ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        )}
      >
        {isAlert ? (
          <RiMegaphoneLine className="size-4" />
        ) : (
          <RiInformationLine className="size-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {note.title}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              isAlert
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}
          >
            {isAlert ? "Alert" : "Info"}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              note.isPublished
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}
          >
            {note.isPublished ? "Published" : "Draft"}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          {note.body}
        </p>
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-400">
          <span>
            {note.publishedAt
              ? `Published ${formatDistanceToNow(new Date(note.publishedAt), { addSuffix: true })}`
              : `Created ${formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}`}
          </span>
          {note.linkHref && (
            <span className="inline-flex items-center gap-1 truncate">
              <RiExternalLinkLine className="size-3" />
              {note.linkHref}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={togglePublished}
          disabled={isPending}
        >
          {note.isPublished ? "Unpublish" : "Publish"}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onEdit}
          disabled={isPending}
          aria-label="Edit note"
        >
          <RiEdit2Line className="size-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={isPending}
              aria-label="Delete note"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950/40"
            >
              <RiDeleteBin2Line className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{note.title}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the note from everyone&apos;s What&apos;s
                New. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function NoteDialog({
  open,
  onOpenChange,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: ReleaseNoteRow | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ReleaseNoteInput>(
    note
      ? {
          title: note.title,
          body: note.body,
          type: note.type,
          linkLabel: note.linkLabel ?? "",
          linkHref: note.linkHref ?? "",
          isPublished: note.isPublished,
        }
      : EMPTY
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof ReleaseNoteInput>(
    key: K,
    value: ReleaseNoteInput[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = note
        ? await updateReleaseNote(note.id, form)
        : await createReleaseNote(form);
      if (res.error) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
          <DialogDescription>
            Authored notes appear in every user&apos;s notification bell.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rn-title">Title</Label>
            <Input
              id="rn-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="What changed?"
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => set("type", v as ReleaseNoteInput["type"])}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INFO">Info — bell only</SelectItem>
                  <SelectItem value="ALERT">
                    Alert — also pops up once
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end pb-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isPublished}
                  onCheckedChange={(c) => set("isPublished", c === true)}
                  disabled={isPending}
                />
                Published (visible to users)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rn-link-label">Link label (optional)</Label>
              <Input
                id="rn-link-label"
                value={form.linkLabel}
                onChange={(e) => set("linkLabel", e.target.value)}
                placeholder="Customise your sidebar"
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rn-link-href">Link target (optional)</Label>
              <Input
                id="rn-link-href"
                value={form.linkHref}
                onChange={(e) => set("linkHref", e.target.value)}
                placeholder="/settings/customise-sidebar"
                disabled={isPending}
                className="font-mono"
              />
            </div>
          </div>

          <MarkdownEditor
            label="Body"
            value={form.body}
            onChange={(v) => set("body", v)}
            placeholder="Describe the change. Markdown is supported."
            rows={8}
            required
          />

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {note ? "Save changes" : "Create note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
