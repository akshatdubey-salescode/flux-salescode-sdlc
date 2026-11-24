// Registry of APIs that external apps may call with an API token. Each entry
// is one grantable scope, covering one or more /api/v1 routes.
// Exposing a new API = add an entry here + write its /api/v1 route(s)
// (call authenticateApiToken(request, scope, projectId?)) + its markdown doc.
// The superuser API Tokens page lists these as grantable scopes.

import { BUGS_DOC } from "./docs/bugs";
import { SLA_VIOLATIONS_DOC } from "./docs/sla-violations";

export type ExposedRoute = {
  method: "GET";
  /** Path template, shown in the UI. */
  path: string;
};

export type ExposedEndpoint = {
  /** Scope a token must hold to call these routes. */
  scope: string;
  title: string;
  routes: ExposedRoute[];
  /** Route (with query) used for the "Try it" curl after creating a token. */
  examplePath: string;
  summary: string;
  /** True if the routes read project data that a token's project list restricts. */
  projectScoped: boolean;
  /** Markdown docs; {{BASE_URL}} is replaced with the deployment origin. */
  docs: string;
};

export const EXPOSED_ENDPOINTS: ExposedEndpoint[] = [
  {
    scope: "bugs:read",
    title: "Bug board & SLA breaches",
    routes: [
      { method: "GET", path: "/api/v1/projects" },
      { method: "GET", path: "/api/v1/bugs?projects={keys}" },
      { method: "GET", path: "/api/v1/projects/{projectId}/bugs" },
      { method: "GET", path: "/api/v1/sla-violations?projects={keys}" },
    ],
    examplePath: "/api/v1/bugs?status=open&limit=10",
    summary: "Bugs for one or many projects (by Jira key) with every Bug Summary filter: date range, environment, owner, search, status, priority, sort and paging. Also SLA rule violations per project (by Jira key). Includes a project list for key/name → id lookups.",
    projectScoped: true,
    docs: BUGS_DOC + SLA_VIOLATIONS_DOC,
  },
];

export const EXPOSED_SCOPES = new Set(EXPOSED_ENDPOINTS.map((e) => e.scope));
