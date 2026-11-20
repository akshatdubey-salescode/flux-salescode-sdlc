# Discover — Domain Glossary

`/discover` is an internal showcase where salescode.ai developers share the
internal tools they have built (often AI-assisted), so others can find, use and
build on them.

> Status: design agreed in a grilling session on 2026-11-20; implemented on branch `feat/discover`.

## Terms

**Tool Showcase** (a.k.a. *Showcase*)
: The unit published on /discover. Describes exactly one internal tool:
  title, tagline, cover image, links, owner(s), tags, and a markdown body.
  Not a general-purpose blog post — every Showcase is about a tool.
  Code/UI name: `showcase`. Avoid "post", "blog", "article".

**Author**
: The signed-in user who created the Showcase. Each Showcase has exactly one
  Author, its only owner and editor (admins can still take it down).
  No co-authors; teammates are credited in the Body.

**Showcase fields**
: Required: title, tagline (≤120 chars), Body. Optional: cover image,
  repo URL, live/app URL, demo video URL, Tags. With no cover image, the card
  shows a generated placeholder. No tool-status field.

**Body**
: The long-form markdown content of a Showcase (GFM). Images are embedded
  as markdown image links pointing at Showcase Images.

**Showcase Image**
: An image uploaded while editing a Showcase (cover or inline). Stored in a
  ImageKit as a private file, never in Postgres (ADR-0001). Referenced by a
  stable app URL (`/api/discover/images/<id>`) that checks the user is signed in
  and redirects to a short-lived signed ImageKit URL (ADR-0003). PNG, JPEG,
  WebP or GIF, at most 5 MB; uploads are verified server-side (ADR-0004).

**Tag**
: A free-form label on a Showcase, used for filtering and search. Normalised
  to lowercase-kebab (`AI Agent` → `ai-agent`). The editor suggests existing
  tags to limit duplicates. Not curated by admins.

**Draft / Published**
: The two states of a Showcase. A Draft is autosaved and visible only to its
  Author. Publishing makes it visible to everyone. A Published Showcase stays
  editable (shown as "Updated <date>"), and the Author can unpublish it back to
  Draft or delete it. No revision history.

**Upvote**
: One toggleable endorsement per user per Showcase. Drives the upvote count
  and the "Popular" sort. No emoji reactions.

**Comment** / **Reply**
: A Comment is a markdown remark on a Showcase (no images). A Reply is a
  Comment on another Comment. Threads are one level deep: replies cannot be
  replied to. Authors edit/delete their own; admins delete any.

**Comment notification**
: Email sent via Resend. New Comment → the Showcase Author. New Reply → the
  Showcase Author and the parent Comment's author. Nobody is emailed about
  their own action, and each person gets at most one email per event.

**Discover feed**
: The /discover landing page. A card grid of Published Showcases (cover,
  title, tagline, Author, Tags, upvote and comment counts), with a Newest
  (default) / Popular sort, Tag filter chips and full-text search (ADR-0005).
  A "My Showcases" tab lists the user's Drafts and Published entries. Linked as
  "Discover" in the sidebar.

**Orphan image**
: A Showcase Image more than 24h old that its Showcase's Body or cover no longer
  references. Deleted by a nightly job (ADR-0004).

**Showcase URL**
: `/discover/<slug>-<shortid>`, e.g. `/discover/jira-digest-bot-k3f9a`. The
  short id is authoritative. The slug comes from the title, and a stale slug
  redirects to the current one, so renaming never breaks shared links.

**Demo video**
: Optional URL. Loom, YouTube and Google Drive URLs embed as an inline
  player on the detail page (allow-listed). Anything else becomes a "Watch
  demo" link. The Body never renders raw HTML or iframes.

**Take down**
: ADMIN/SUPERUSER action with a required reason. The Showcase goes back to
  Draft, flagged "Taken down: <reason>", and the Author is emailed. The Author
  can fix it and republish. Admins can also hard-delete. This is the only
  moderation step; there is no approval queue (ADR-0002).
