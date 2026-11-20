// Registry of endpoints that external apps may call with an API token.
// Exposing a new endpoint = add an entry here + write its /api/v1 route
// (call authenticateApiToken(request, scope, projectId?)) + its markdown doc.
// The superuser API Tokens page lists these as grantable scopes.

import { BUGS_DOC } from "./docs/bugs";

export type ExposedEndpoint = {
  /** Scope a token must hold to call this endpoint. */
  scope: string;
  title: string;
  method: "GET";
  /** Path template, shown in the UI. */
  path: string;
  summary: string;
  /** True if the path carries a project id that a token's project list restricts. */
  projectScoped: boolean;
  /** Markdown docs; {{BASE_URL}} is replaced with the deployment origin. */
  docs: string;
};

export const EXPOSED_ENDPOINTS: ExposedEndpoint[] = [
  {
    scope: "bugs:read",
    title: "Bug board",
    method: "GET",
    path: "/api/v1/projects/{projectId}/bugs",
    summary: "A project's bugs with every Bug Summary filter: date range, environment, owner, search, status, priority, sort and paging.",
    projectScoped: true,
    docs: BUGS_DOC,
  },
];

export const EXPOSED_SCOPES = new Set(EXPOSED_ENDPOINTS.map((e) => e.scope));
