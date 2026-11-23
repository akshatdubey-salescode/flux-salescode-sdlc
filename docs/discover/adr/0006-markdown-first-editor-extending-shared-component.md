# ADR-0006: Markdown-first editor, built by extending the shared MarkdownEditor

- Status: Accepted (2026-11-20)
- Context: /discover (Tool Showcases)

## Context

`src/components/ui/markdown-editor.tsx` (a textarea with Write/Preview tabs) is
already used by Requirements and Release Notes. The audience is developers who
are comfortable with markdown.

## Decision

No WYSIWYG library. Extend the shared editor with:
- a formatting toolbar (bold, heading, link, code, list, image);
- paste, drag-drop and toolbar image upload (ADR-0004), which inserts an
  "Uploading…" placeholder and swaps in the image link when done;
- a side-by-side live preview on wide screens, keeping the tabs on narrow ones.

New behaviour is opt-in through props (e.g. an `onUploadImage` handler and a
`layout` prop), so existing callers don't change. Showcase drafts autosave
(debounced about 2s).

The renderer (`markdown.tsx`) stays react-markdown + GFM with raw HTML
disabled. It gains styled image rendering.

## Consequences

- No heavy new dependency, and markdown is stored exactly as written.
- Requirements and Release Notes can switch on the same upgrades later.
- Rejected: Milkdown/Tiptap-style WYSIWYG (bundle weight and markdown
  round-trip edge cases).
