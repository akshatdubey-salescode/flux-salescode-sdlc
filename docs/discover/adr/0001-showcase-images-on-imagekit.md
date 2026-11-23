# ADR-0001: Showcase images are stored in ImageKit (private files)

- Status: Accepted (2026-11-20). Replaces the earlier choice of Cloudflare R2.
- Context: /discover (Tool Showcases)

## Context

Showcases need cover and inline images, and the goal is to keep storage free.
The app already has a private AWS S3 bucket (`src/lib/storage`, used by Test
Cases), but S3 has no permanent free tier. Cloudflare R2 was chosen first
(10 GB free) and then dropped because R2 needs a payment card on file.

## Decision

Store Showcase Images in **ImageKit** as **private files**. The free plan
includes 3 GB of storage and 20 GB of delivery bandwidth a month. There is no
overage billing: features stop until the next month. Max upload size is 25 MB,
and we cap ours at 5 MB.

Integration is hand-rolled with `node:crypto` + `fetch` in
`src/lib/discover/storage.ts`. We don't use the SDK, because its
upload-expiry parameter is easy to misuse.

## Consequences

- New env vars: `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`,
  `IMAGEKIT_URL_ENDPOINT`. They are separate from the Test Cases S3 config.
- Dev without these vars falls back to a gitignored local folder
  (`.discover-storage/`), so the feature works locally with no account.
- Postgres stores the ImageKit file path and fileId, never image bytes.
- Budget watch: 3 GB is about 1,000–3,000 screenshots. Orphan cleanup
  (ADR-0004) keeps storage honest. Bandwidth is the likelier limit if
  Discover gets popular.
- Verified live on 2026-11-20 on the free plan: private uploads, signed-URL
  delivery (unsigned → 403), v2 JWT pinning (a tampered `folder` is
  rejected), file details and delete all work.
- Rejected: S3 (not free), R2 (needs a card), Vercel Blob (small allowance,
  tied to the Vercel plan).
