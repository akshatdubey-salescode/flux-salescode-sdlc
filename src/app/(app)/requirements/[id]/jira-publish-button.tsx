"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RiExternalLinkLine, RiLoader4Line } from "@remixicon/react";
import { PublishToJiraButton } from "./publish-to-jira-button";

type IntegrationStatus =
  | { connected: false }
  | {
      connected: true;
      accountId: string;
      email: string;
    };

type Props = {
  requirementId: string;
  existingIssueKey: string | null;
  jiraBaseUrl: string;
};

export function JiraPublishButton({ requirementId, existingIssueKey, jiraBaseUrl }: Props) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    fetch("/api/integrations/atlassian")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  if (status === null) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm text-zinc-500">
        <RiLoader4Line className="animate-spin" size={14} />
        Loading...
      </div>
    );
  }

  if (!status.connected) {
    return (
      <Link
        href="/settings"
        className="inline-flex items-center gap-2 rounded-lg bg-[#0052CC] hover:bg-[#0747A6] px-4 py-2 text-sm font-semibold text-white transition-colors"
      >
        <RiExternalLinkLine size={14} />
        Connect to Atlassian
      </Link>
    );
  }

  return (
    <PublishToJiraButton
      requirementId={requirementId}
      existingIssueKey={existingIssueKey}
      jiraBaseUrl={jiraBaseUrl}
    />
  );
}
