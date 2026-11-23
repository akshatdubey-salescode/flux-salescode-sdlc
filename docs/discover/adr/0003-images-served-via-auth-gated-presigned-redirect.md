# ADR-0003: Images are served through a sign-in check and signed-URL redirect

- Status: Accepted (2026-11-20). Updated for ImageKit (ADR-0001).
- Context: /discover (Tool Showcases)

## Context

Screenshots of internal tools can show internal data (client names, dashboards,
credentials by accident). A public URL can be viewed by anyone who has it.

## Decision

Images are uploaded to ImageKit as **private files**, which can only be fetched
through a signed URL. Markdown stores a stable, non-expiring app URL,
`/api/discover/images/<id>`. That route checks the user is signed in and
responds with a 302 to a signed ImageKit URL
(`?ik-t=<expiry>&ik-s=<HMAC-SHA1(privateKey, path + expiry)>`).

Expiry is at least 10 minutes and is rounded up to 5-minute buckets, so repeat
views get the identical URL and the browser/CDN cache works.

## Consequences

- Only signed-in salescode.ai users can see Showcase images, wherever the
  link ends up.
- The bytes come from ImageKit's CDN. Vercel only runs a tiny redirect
  function per image request, and the redirect is browser-cached for 5 min.
- Markdown never contains expiring URLs, so content does not rot.
- Rejected: public files (leak risk) and streaming bytes through the app
  (Vercel bandwidth and function cost).
