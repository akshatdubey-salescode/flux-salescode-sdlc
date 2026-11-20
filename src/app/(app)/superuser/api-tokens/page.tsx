import { headers } from "next/headers";
import { asc, desc } from "drizzle-orm";
import { requireRole } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { apiTokens, jiraProjects } from "@/lib/db/schema";
import { EXPOSED_ENDPOINTS } from "@/lib/external-api/endpoints";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TokenManager, type TokenRow, type EndpointInfo, type ProjectOption } from "./token-manager";

export default async function ApiTokensPage() {
  await requireRole("SUPERUSER");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  const [tokenRows, projectRows] = await Promise.all([
    db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        scopes: apiTokens.scopes,
        projectIds: apiTokens.projectIds,
        createdBy: apiTokens.createdBy,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        revokedBy: apiTokens.revokedBy,
      })
      .from(apiTokens)
      .orderBy(asc(apiTokens.revokedAt), desc(apiTokens.createdAt)),
    db
      .select({
        id: jiraProjects.id,
        key: jiraProjects.jiraProjectKey,
        name: jiraProjects.name,
        isActive: jiraProjects.isActive,
      })
      .from(jiraProjects)
      .orderBy(desc(jiraProjects.isActive), asc(jiraProjects.name)),
  ]);

  const projects: ProjectOption[] = projectRows.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  const tokens: TokenRow[] = tokenRows.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
  }));
  const endpoints: EndpointInfo[] = EXPOSED_ENDPOINTS.map((e) => ({
    scope: e.scope,
    title: e.title,
    method: e.method,
    path: e.path,
    summary: e.summary,
    projectScoped: e.projectScoped,
    docs: e.docs.replaceAll("{{BASE_URL}}", baseUrl),
  }));

  return (
    <div className="flex flex-col min-h-svh bg-zinc-50 dark:bg-zinc-950">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/superuser">Superuser</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>API Tokens</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">API Tokens</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Tokens let other apps call selected Flux endpoints, server-to-server. Tokens never
              expire: they work until you revoke them. Each one is limited to the endpoints you
              pick and, optionally, to certain projects. The token is shown once, when you create
              it.
            </p>
          </div>

          <TokenManager tokens={tokens} projects={projects} endpoints={endpoints} baseUrl={baseUrl} />
        </div>
      </main>
    </div>
  );
}
