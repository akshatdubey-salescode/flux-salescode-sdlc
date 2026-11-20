"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  RiCheckLine,
  RiCloseLine,
  RiDeleteBin2Line,
  RiEyeLine,
  RiImageAddLine,
  RiLoader4Line,
  RiSendPlaneLine,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
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
import { ShowcaseCover } from "@/components/discover/showcase-cover";
import { deleteShowcase, publishShowcase, saveShowcase, type ShowcaseInput } from "@/app/(app)/discover/actions";
import { normalizeTag, TAGLINE_MAX, TAGS_MAX, TITLE_MAX, videoEmbed } from "@/lib/discover/core";
import { uploadShowcaseImage } from "@/lib/discover/upload-client";

const AUTOSAVE_MS = 2000;

const BODY_PLACEHOLDER = `## What it does
One or two paragraphs: the problem, and how the tool solves it.

## How to use it
Setup steps, commands, or where to click.

## How it's built
Stack, AI tools you used, anything others could reuse.

Tip: paste or drop screenshots straight into this box.`;

type SaveState = "saved" | "dirty" | "saving" | "error";

export function ShowcaseEditor({
  id,
  status,
  takenDownReason,
  initial,
  initialPath,
  initialUpdatedAt,
  tagSuggestions,
}: {
  id: string;
  status: "draft" | "published";
  takenDownReason: string | null;
  initial: ShowcaseInput;
  initialPath: string;
  initialUpdatedAt: string;
  tagSuggestions: string[];
}) {
  const router = useRouter();
  const isDraft = status === "draft";
  const [form, setForm] = useState<ShowcaseInput>(initial);
  const [path, setPath] = useState(initialPath);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<Date>(new Date(initialUpdatedAt));
  const [error, setError] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [publishing, startPublish] = useTransition();

  const savedJson = useRef(JSON.stringify(initial));
  const formRef = useRef(form);
  formRef.current = form;
  const inFlight = useRef<Promise<boolean> | null>(null);

  const set = <K extends keyof ShowcaseInput>(k: K, v: ShowcaseInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  /** Saves the latest form; resolves true when the server has it. */
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const snapshot = formRef.current;
    const json = JSON.stringify(snapshot);
    if (json === savedJson.current) return true;
    setSaveState("saving");
    const p = (async () => {
      const res = await saveShowcase(id, snapshot);
      if (res.error) {
        setError(res.error);
        setSaveState("error");
        return false;
      }
      setError("");
      savedJson.current = json;
      if (res.updatedAt) setSavedAt(new Date(res.updatedAt));
      if (res.path && res.path !== path) {
        setPath(res.path);
        window.history.replaceState(null, "", `${res.path}/edit`);
      }
      setSaveState(JSON.stringify(formRef.current) === json ? "saved" : "dirty");
      return true;
    })();
    inFlight.current = p;
    try {
      return await p;
    } finally {
      inFlight.current = null;
    }
  }, [id, path]);

  // Track dirtiness, and autosave drafts after a pause in typing.
  useEffect(() => {
    if (JSON.stringify(form) === savedJson.current) return;
    setSaveState((s) => (s === "saving" ? s : "dirty"));
    if (!isDraft) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, isDraft, save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(formRef.current) !== savedJson.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  async function uploadInline(file: File) {
    const { url } = await uploadShowcaseImage(id, file);
    return url;
  }

  async function uploadCover(file: File) {
    setCoverUploading(true);
    try {
      const { id: imageId } = await uploadShowcaseImage(id, file);
      set("coverImageId", imageId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setCoverUploading(false);
    }
  }

  function publish() {
    startPublish(async () => {
      if (!(await save())) return;
      const res = await publishShowcase(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.success("Published to Discover");
      router.push(res.path ?? path);
    });
  }

  function remove() {
    startPublish(async () => {
      // Stop autosave from firing against a showcase that's about to be gone.
      savedJson.current = JSON.stringify(formRef.current);
      const res = await deleteShowcase(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(isDraft ? "Draft deleted" : "Showcase deleted");
      router.push("/discover?tab=mine");
    });
  }

  function saveAndView() {
    startPublish(async () => {
      if (await save()) {
        toast.success("Changes saved");
        router.push(path);
      }
    });
  }

  const embed = videoEmbed(form.demoVideoUrl);
  const statusText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "dirty"
        ? isDraft
          ? "Unsaved changes"
          : "Unsaved changes, click Save"
        : saveState === "error"
          ? "Not saved"
          : `Saved ${format(savedAt, "HH:mm")}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {isDraft ? "Share a tool" : "Edit showcase"}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {isDraft
              ? "Drafts save automatically and stay private until you publish."
              : "This showcase is live. Changes go live when you save."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`flex items-center gap-1 text-xs ${saveState === "error" ? "text-red-600" : "text-zinc-500 dark:text-zinc-400"}`}
          >
            {saveState === "saving" ? <RiLoader4Line size={13} className="animate-spin" /> : saveState === "saved" ? <RiCheckLine size={13} /> : null}
            {statusText}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon-lg"
                disabled={publishing}
                aria-label={isDraft ? "Delete draft" : "Delete showcase"}
                title={isDraft ? "Delete draft" : "Delete showcase"}
                className="text-red-600 hover:text-red-700"
              >
                <RiDeleteBin2Line />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isDraft ? "Delete this draft?" : "Delete this showcase?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isDraft
                    ? "The draft and its images are removed for good. This cannot be undone."
                    : "This removes it from Discover for everyone, with its upvotes, comments and images. This cannot be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {isDraft ? (
            <>
              <Button
                variant="outline"
                size="lg"
                disabled={publishing}
                onClick={() =>
                  startPublish(async () => {
                    if (await save()) router.push(path);
                  })
                }
              >
                <RiEyeLine />
                Preview
              </Button>
              <Button size="lg" onClick={publish} disabled={publishing}>
                {publishing ? <RiLoader4Line className="animate-spin" /> : <RiSendPlaneLine />}
                Publish
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline" size="lg">
                <Link href={path}>Cancel</Link>
              </Button>
              <Button size="lg" onClick={saveAndView} disabled={publishing || saveState === "saved"}>
                {publishing ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
                Save changes
              </Button>
            </>
          )}
        </div>
      </div>

      {takenDownReason && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          <strong>Taken down by an admin:</strong> {takenDownReason}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 min-w-0">
          <div className="space-y-1.5">
            <Label htmlFor="sc-title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="sc-title"
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Jira Digest Bot"
              className="h-10 text-base"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="sc-tagline">
                Tagline <span className="text-red-500">*</span>
              </Label>
              <span className="text-[11px] text-zinc-400">
                {form.tagline.length}/{TAGLINE_MAX}
              </span>
            </div>
            <Input
              id="sc-tagline"
              value={form.tagline}
              maxLength={TAGLINE_MAX}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder="One line on what it does and who it's for"
            />
          </div>
          <MarkdownEditor
            label="Write-up"
            required
            value={form.body}
            onChange={(v) => set("body", v)}
            rows={22}
            toolbar
            layout="split"
            onUploadImage={uploadInline}
            placeholder={BODY_PLACEHOLDER}
          />
        </div>

        <aside className="space-y-5">
          <div className="space-y-1.5">
            <Label>Cover image</Label>
            <div className="relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <ShowcaseCover id={id} title={form.title} coverImageId={form.coverImageId} />
              {coverUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                  <RiLoader4Line className="animate-spin" />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" disabled={coverUploading}>
                <label className="cursor-pointer">
                  <RiImageAddLine />
                  {form.coverImageId ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadCover(f);
                    }}
                  />
                </label>
              </Button>
              {form.coverImageId && (
                <Button variant="ghost" size="sm" onClick={() => set("coverImageId", null)}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">16:9 works best. PNG, JPEG, WebP or GIF up to 5 MB.</p>
          </div>

          <TagsInput value={form.tags} onChange={(t) => set("tags", t)} suggestions={tagSuggestions} />

          <div className="space-y-3">
            <UrlField id="sc-live" label="App / tool URL" value={form.liveUrl} onChange={(v) => set("liveUrl", v)} placeholder="https://…" />
            <UrlField id="sc-repo" label="Repository URL" value={form.repoUrl} onChange={(v) => set("repoUrl", v)} placeholder="https://github.com/…" />
            <UrlField
              id="sc-video"
              label="Demo video URL"
              value={form.demoVideoUrl}
              onChange={(v) => set("demoVideoUrl", v)}
              placeholder="Loom, YouTube or Google Drive"
              hint={
                form.demoVideoUrl.trim()
                  ? embed
                    ? "Will play inline on the page."
                    : "Will show as a “Watch demo” link."
                  : undefined
              }
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function UrlField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}

function TagsInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const full = value.length >= TAGS_MAX;

  function add(raw: string) {
    const t = normalizeTag(raw);
    if (t && !value.includes(t) && !full) onChange([...value, t]);
    setDraft("");
  }

  const q = normalizeTag(draft);
  const matches = suggestions.filter((s) => !value.includes(s) && (!q || s.includes(q))).slice(0, 8);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="sc-tags">Tags</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-0.5">
              #{t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
                <RiCloseLine size={12} />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id="sc-tags"
        value={draft}
        disabled={full}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={full ? `Up to ${TAGS_MAX} tags` : "e.g. jira, cli, ai-agent (Enter to add)"}
      />
      {!full && matches.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              +{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
