import { requireAuth } from "@/lib/auth/server";

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  private: boolean;
};

export type GitHubRepoItem = {
  id: number;
  name: string;
  fullName: string;
  description: string;
  language: string;
};

export async function GET() {
  await requireAuth();

  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG ?? "salescode-ai";

  if (!token) {
    return Response.json({ error: "GITHUB_TOKEN not configured" }, { status: 500 });
  }

  const res = await fetch(
    `https://api.github.com/orgs/${org}/repos?per_page=100&type=all&sort=updated`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 300 }, // cache 5 min
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return Response.json(
      { error: `GitHub API error: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}` },
      { status: 502 }
    );
  }

  const repos: GitHubRepo[] = await res.json();

  const items: GitHubRepoItem[] = repos
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? "",
      language: r.language ?? "",
    }));

  return Response.json(items);
}
