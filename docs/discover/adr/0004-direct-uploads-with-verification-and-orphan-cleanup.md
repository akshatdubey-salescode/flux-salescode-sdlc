# ADR-0004: Direct browser uploads, server-verified, with nightly orphan cleanup

- Status: Accepted (2026-11-20). Updated for ImageKit (ADR-0001).
- Context: /discover (Tool Showcases)

## Context

Vercel functions reject request bodies over about 4.5 MB, and screenshots are
often bigger. Editors upload images freely while drafting, so many uploads
never end up referenced. The ImageKit free tier (3 GB) is the budget.

## Decision

1. **Start:** the editor (paste / drag-drop / toolbar) calls
   `POST /api/discover/images`. The app creates a `showcase_images` row and
   returns the upload fields plus an ImageKit **v2 upload token**. The token
   is an HS256 JWT signed with the private key that pins every parameter:
   `fileName`, `folder` (`/discover/<showcaseId>`), `isPrivateFile=true`,
   `useUniqueFileName=false`, `overwriteFile=false`. It is single-use and
   valid for 10 minutes.
2. **Upload:** the browser POSTs multipart straight to
   `upload.imagekit.io/api/v2/files/upload`. If any field differs from the
   token, ImageKit rejects the upload, so the browser can't write anywhere
   else, make the file public, or overwrite an existing file. ImageKit allows
   any origin, so no CORS setup is needed.
3. **Verify:** the browser calls `POST /api/discover/images/<id>/complete`
   with the returned `fileId`. The server fetches the file details from
   ImageKit. A fileId at any other path is rejected *without* deleting
   anything. At the right path, the file and row are deleted unless the file
   is private, ≤ 5 MB, and of the declared MIME type (PNG/JPEG/WebP/GIF;
   never SVG). Only verified images are served.
4. **Cleanup:** a nightly job (inside the existing
   `/api/cron/scheduled-processes` run) deletes images more than 24h old that
   are unverified, detached from a deleted Showcase, or no longer referenced
   by their Showcase's Body or cover.

## Consequences

- Uploads don't pass through Vercel, so the 4.5 MB body limit doesn't apply.
- Known gap: a file uploaded to ImageKit whose `complete` call never happens
  has no recorded fileId, so cleanup removes only its row. It is a rare
  abandoned-tab case. Fix later with a list-by-folder sweep if it shows up in
  storage numbers.
- ImageKit labels the v2 upload API "beta". v1 was rejected because it signs
  only `token + expire`, which would let any signed-in user write over
  another showcase's image path. If v2 changes, verify (step 3) is the
  backstop.
- Rejected: proxying uploads through the app (4.5 MB limit) and never
  deleting (storage slowly leaks).
