"use client";

import { useRef, useState } from "react";
import {
  RiBold,
  RiCodeLine,
  RiH2,
  RiImageAddLine,
  RiItalic,
  RiLink,
  RiListUnordered,
} from "@remixicon/react";
import { Markdown } from "./markdown";
import { applyFormat, imageMarkdown, insertBlock, type Edit, type FormatAction } from "./markdown-format";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
  required?: boolean;
  /**
   * Opt-in: formatting toolbar (bold, heading, link, code, list, and image when
   * `onUploadImage` is set).
   */
  toolbar?: boolean;
  /**
   * Opt-in: enables image paste / drag-drop / picker. Uploads the file and
   * resolves to the URL to embed; reject with an Error to show its message.
   */
  onUploadImage?: (file: File) => Promise<string>;
  /** "split" shows editor and live preview side by side on wide screens (tabs on narrow ones). */
  layout?: "tabs" | "split";
};

const FORMAT_BUTTONS: { action: FormatAction; label: string; icon: typeof RiBold }[] = [
  { action: "bold", label: "Bold", icon: RiBold },
  { action: "italic", label: "Italic", icon: RiItalic },
  { action: "heading", label: "Heading", icon: RiH2 },
  { action: "link", label: "Link", icon: RiLink },
  { action: "code", label: "Code", icon: RiCodeLine },
  { action: "list", label: "Bulleted list", icon: RiListUnordered },
];

let uploadSeq = 0;

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 16,
  label,
  required,
  toolbar = false,
  onUploadImage,
  layout = "tabs",
}: Props) {
  const split = layout === "split";
  const [tab, setTab] = useState<"write" | "preview">(split ? "write" : "preview");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Async uploads finish after further typing; always edit the latest value.
  const valueRef = useRef(value);
  valueRef.current = value;

  function commit(edit: Edit) {
    onChange(edit.value);
    valueRef.current = edit.value;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(edit.selStart, edit.selEnd);
    });
  }

  function format(action: FormatAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    setTab("write");
    commit(applyFormat(action, valueRef.current, ta.selectionStart, ta.selectionEnd));
  }

  async function uploadFiles(files: File[]) {
    if (!onUploadImage) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setUploadError("");
    setTab("write");
    for (const file of images) {
      const token = `![Uploading ${file.name.replace(/[[\]\n]/g, " ")} #${++uploadSeq}…]()`;
      const ta = textareaRef.current;
      const s = ta?.selectionStart ?? valueRef.current.length;
      const e = ta?.selectionEnd ?? valueRef.current.length;
      commit(insertBlock(valueRef.current, s, e, token));
      setUploading((n) => n + 1);
      try {
        const url = await onUploadImage(file);
        const next = valueRef.current.replace(token, imageMarkdown(file.name, url));
        onChange(next);
        valueRef.current = next;
      } catch (err) {
        const next = valueRef.current.replace(`${token}\n`, "").replace(token, "");
        onChange(next);
        valueRef.current = next;
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  const tabButton = (t: "write" | "preview", text: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
        tab === t
          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      {text}
    </button>
  );

  const textarea = (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={
        onUploadImage
          ? (e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void uploadFiles(files);
              }
            }
          : undefined
      }
      onDragOver={onUploadImage ? (e) => e.preventDefault() : undefined}
      onDrop={
        onUploadImage
          ? (e) => {
              const files = Array.from(e.dataTransfer.files);
              if (files.length) {
                e.preventDefault();
                void uploadFiles(files);
              }
            }
          : undefined
      }
      rows={rows}
      placeholder={placeholder}
      className={cn(
        "w-full resize-y bg-transparent px-4 py-3 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none leading-relaxed",
        toolbar && "font-mono text-[13px]",
      )}
    />
  );

  const preview = (
    <div className="min-h-[200px] px-4 py-3">
      {value.trim() ? (
        <Markdown content={value} />
      ) : (
        <p className="text-sm text-zinc-400 italic">Nothing to preview.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 focus-within:border-zinc-400 dark:focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-400 dark:focus-within:ring-zinc-500 transition-shadow bg-white dark:bg-zinc-900">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 border-b border-zinc-100 dark:border-zinc-800 px-2 py-1.5">
          <div className={cn("flex items-center gap-0.5", split && "lg:hidden")}>
            {tabButton("write", "Write")}
            {tabButton("preview", "Preview")}
          </div>
          {toolbar && (
            <div className={cn("flex items-center gap-0.5", !split && "ml-2", split && "max-lg:ml-2")}>
              {FORMAT_BUTTONS.map(({ action, label: l, icon: Icon }) => (
                <button
                  key={action}
                  type="button"
                  title={l}
                  aria-label={l}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => format(action)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <Icon size={15} />
                </button>
              ))}
              {onUploadImage && (
                <label
                  title="Insert image (or paste / drop one)"
                  className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <RiImageAddLine size={15} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void uploadFiles(files);
                    }}
                  />
                </label>
              )}
            </div>
          )}
          <span className="ml-auto text-[10px] text-zinc-300 dark:text-zinc-600 pr-1">
            {uploading > 0 ? `Uploading ${uploading} image${uploading > 1 ? "s" : ""}…` : "Markdown"}
          </span>
        </div>

        {split ? (
          <div className="lg:grid lg:grid-cols-2 lg:divide-x lg:divide-zinc-100 dark:lg:divide-zinc-800">
            <div className={cn(tab === "write" ? "block" : "hidden", "lg:block")}>{textarea}</div>
            <div className={cn(tab === "preview" ? "block" : "hidden", "lg:block lg:max-h-[80vh] lg:overflow-y-auto")}>
              {preview}
            </div>
          </div>
        ) : tab === "write" ? (
          textarea
        ) : (
          preview
        )}
      </div>
      {uploadError && <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
    </div>
  );
}

export function splitContent(content: string): {
  description: string;
  acceptanceCriteria: string | undefined;
} {
  const idx = content.search(/^##\s+Acceptance Criteria\b/im);
  if (idx === -1) return { description: content.trim(), acceptanceCriteria: undefined };
  const description = content.slice(0, idx).trim();
  const ac = content
    .slice(idx)
    .replace(/^##\s+Acceptance Criteria\b\n*/im, "")
    .trim();
  return { description, acceptanceCriteria: ac || undefined };
}
