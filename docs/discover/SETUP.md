# Discover: setup

## Image storage (ImageKit)

Showcase images live in ImageKit as **private files** (ADR-0001, ADR-0003).

1. Create a free ImageKit account at https://imagekit.io.
2. In **Developer options**, copy the **public key**, **private key** and
   **URL endpoint** (e.g. `https://ik.imagekit.io/<your_id>`).
3. Set these env vars (Vercel → Project → Settings → Environment Variables,
   and in `.env.local` if you want real uploads locally):

   ```
   IMAGEKIT_PUBLIC_KEY=public_...
   IMAGEKIT_PRIVATE_KEY=private_...      # server-only, never NEXT_PUBLIC_
   IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<your_id>
   ```

No other ImageKit setup is needed. Browser uploads go straight to
`upload.imagekit.io`, which allows any origin. Leave
"Restrict unsigned URLs" off; private files are protected regardless.

**Without these vars:**
- In dev, images are stored in `.discover-storage/` (gitignored) and served by
  the app.
- In production, uploads return "Image uploads are not configured yet" and the
  rest of Discover keeps working.

**Free plan limits:** 3 GB storage and 20 GB delivery bandwidth a month. There
are no overage charges; features stop until the next month. Check usage in the
ImageKit dashboard. The nightly cleanup deletes images that are no longer used.

## Database

Migration `drizzle/0098_discover_showcases.sql` adds `showcases`,
`showcase_images`, `showcase_upvotes` and `showcase_comments`. Production
builds apply it automatically (`scripts/build.sh`). Other databases:
`pnpm db:migrate`.

## Email

Comment and take-down emails use the existing Resend config (`RESEND_API_KEY`,
`EMAIL_FROM`) and `NEXT_PUBLIC_APP_URL` for links. Without Resend the emails
are skipped and logged; nothing fails.

## Orphan image cleanup

Runs as part of the existing nightly `/api/cron/scheduled-processes` cron (its
JSON response includes `discoverImages: { deleted, failed }`). No extra cron
is needed.
