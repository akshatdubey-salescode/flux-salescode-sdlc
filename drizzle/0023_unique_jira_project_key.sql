CREATE UNIQUE INDEX IF NOT EXISTS "jira_projects_base_url_key_idx" ON "jira_projects" ("jira_base_url","jira_project_key");
