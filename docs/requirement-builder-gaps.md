# Requirement Builder — Gaps & Next Steps

## What's been built (in this session)

- `src/lib/db/schema.ts` — `requirements` table added
- `drizzle/0007_naive_songbird.sql` — migration generated & applied
- `src/lib/charjan/client.ts` — SSE search client for charjan
- `src/app/api/requirements/route.ts` — CRUD API
- `src/app/api/requirements/generate/route.ts` — charjan-powered generation
- `src/app/(app)/requirements/page.tsx` — list page
- `src/app/(app)/requirements/new/page.tsx` — new requirement page (SSR shell)
- `src/components/requirement-builder/index.tsx` — 3-step client form
- `src/components/app-sidebar.tsx` — Requirements nav link added
- `.env.local` — `CHARJAN_API_URL` + `CHARJAN_TENANT_ID` set

---

## Gap 1: Charjan Authentication

### Problem
The current `charjan/client.ts` calls `POST /api/v1/datastore/search/{tenantId}` with an
optional `X-API-Key`. But charjan UAT has no hardcoded service key available.

### What charjan actually supports
charjan exposes `POST /api/v1/auth/provision` — takes `{ access_token, email, name }` and
returns a per-session `api_key`. This is the runtime token exchange the user described.

### How charjan validates the access_token
- charjan reads `central_auth_url` from config (defaults to `https://dev-auth.salescode.ai`)
- It calls `GET {central_auth_url}/v1/users/me` with `Authorization: Bearer {access_token}`
- That endpoint returns `{ emailId, loginId }` and charjan verifies it matches the `email` claim
- **If `CENTRAL_AUTH_URL` is not set on the charjan instance → it skips token verification entirely and trusts the email directly**

### The old PoC approach
The old `salescode-sdlc` (salesforge-integration-clean branch) used **NextAuth with Google OAuth**.
When the user logged in via Google, NextAuth stored the Google `access_token` in the JWT session.
The app would then call charjan's `provision` endpoint with that Google token.

### flux-salescode-sdlc uses Clerk, not Google OAuth
Clerk does not give you a raw Google `access_token` — it issues its own Clerk session JWT.
charjan's `dev-auth.salescode.ai` cannot verify a Clerk JWT.

### Recommended solution
**Option A (preferred — check with team first):** Confirm whether charjan UAT has
`CENTRAL_AUTH_URL` configured. If it's empty/unset, call provision with just the user's
email + name (no real OAuth token needed, or send any dummy string as `access_token`):

```ts
// src/lib/charjan/client.ts — add getCharjanApiKey()
export async function getCharjanApiKey(email: string, name: string): Promise<string> {
  const res = await fetch(`${process.env.CHARJAN_API_URL}/api/v1/auth/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: "clerk-session", email, name }),
  });
  const data = await res.json();
  return data.api_key;   // rotates on every call — cache per request or per session
}
```

Then in `generate/route.ts`, call `getCharjanApiKey(user.email, ...)` before `searchCharjan()`.

**Option B:** Have the charjan team create a long-lived service key for flux-salescode-sdlc
and store it as `CHARJAN_API_KEY` in Vercel env vars. Simplest operationally.

**Option C:** Switch the flux-salescode-sdlc login from Clerk to NextAuth + Google
(matching the old PoC). Heavy change — not recommended unless there's another reason.

### Files to change for Option A
- `src/lib/charjan/client.ts` — add `getCharjanApiKey(email, name)` function
- `src/app/api/requirements/generate/route.ts` — call `getCharjanApiKey` before search
- Optionally cache the key in a short-lived store (e.g. `Map<userId, {key, expiresAt}>`)

---

## Gap 2: Project List — GitHub Repos instead of Jira Projects

### Problem
The current requirement builder shows `jiraProjects` (Jira-synced projects) in the dropdown.
But the BA needs to select an **engineering repo** (e.g. `schemes-service`) so charjan can
analyze that codebase. These repos live on GitHub under the `salescode-ai` org, not in Jira.

### What we have
- `GITHUB_TOKEN` is already in `.env.local` (PAT for `prasanna4742-salescode`)
- The PAT has access to `salescode-ai` org — confirmed 100 repos visible via API

### GitHub API call
```
GET https://api.github.com/orgs/salescode-ai/repos?per_page=100&type=all&sort=updated
Authorization: Bearer {GITHUB_TOKEN}
```
Returns: `[ { id, name, full_name, description, language, updated_at, ... } ]`

### Changes needed

**1. New API route — `src/app/api/github/repos/route.ts`**
```ts
// GET /api/github/repos
// Fetches repos from salescode-ai org using GITHUB_TOKEN
// Returns [ { id: number, name: string, fullName: string, description: string } ]
```
Cache the response (repos don't change often) — add `Cache-Control: max-age=300` or
store in a short-lived in-memory cache.

Add env var `GITHUB_ORG=salescode-ai` (or hardcode for now).

**2. Update `RequirementBuilderForm` (`src/components/requirement-builder/index.tsx`)**
- Change the `Project` type from `{ id: string, name: string, jiraProjectKey: string }`
  to `{ id: number, name: string, fullName: string, description: string }`
- Change the `projects` fetch in `new/page.tsx` from DB query to calling `/api/github/repos`
- Pass `fullName` (e.g. `salescode-ai/schemes-service`) to the generate API

**3. Update `generate/route.ts` (`src/app/api/requirements/generate/route.ts`)**
- Remove the Jira project DB lookup (no longer needed)
- Accept `{ repoFullName: string, roughIdea: string }` instead of `{ projectId, roughIdea }`
- Use `repoFullName` as the project name in the charjan search prompt

**4. Update `requirements` DB table**
- Change `project_id uuid NOT NULL REFERENCES jira_projects` to `github_repo_name text NOT NULL`
- Run new migration: `npm run db:generate && npm run db:migrate`

Or alternatively, keep `project_id` nullable and add `github_repo_name text` column — allows
gradual migration and avoids breaking the existing Jira project FK.

**Schema change in `src/lib/db/schema.ts`:**
```ts
// Replace projectId FK with githubRepoName
githubRepoName: text("github_repo_name").notNull(),
// (remove the .references(() => jiraProjects.id) line)
```

---

## Summary of next session work

| Priority | Task | Files |
|----------|------|-------|
| 1 | Confirm charjan UAT `CENTRAL_AUTH_URL` setting | (ask team / check charjan UAT env) |
| 2 | Implement `getCharjanApiKey()` provision flow | `src/lib/charjan/client.ts` |
| 3 | Wire api key into generate route | `src/app/api/requirements/generate/route.ts` |
| 4 | Add GitHub repos API route | `src/app/api/github/repos/route.ts` |
| 5 | Update schema: swap `project_id` FK → `github_repo_name` | `src/lib/db/schema.ts` + migration |
| 6 | Update RequirementBuilderForm + new/page to use GitHub repos | `src/components/requirement-builder/index.tsx`, `src/app/(app)/requirements/new/page.tsx` |
| 7 | Add `GITHUB_ORG=salescode-ai` to `.env.local.example` | `.env.local.example` |
