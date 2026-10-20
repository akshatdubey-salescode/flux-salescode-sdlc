// Who is the developer and who is the tester on a Jira issue, from the data we
// already sync: the assignee(s), the "Dev Owner" picker, and the project's QA
// assignee picker fields. Pure so it can be tested without a database.

type CustomFields = Record<string, unknown>;

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Every user's email in the given user-picker fields (single user or array of users). */
export function extractUserEmails(cf: CustomFields | null | undefined, fieldIds: string[] | null | undefined): string[] {
  if (!cf || !fieldIds?.length) return [];
  const out = new Set<string>();
  for (const id of fieldIds) {
    const raw = cf[id];
    for (const u of Array.isArray(raw) ? raw : [raw]) {
      if (u && typeof u === "object") {
        const email = (u as { emailAddress?: unknown }).emailAddress;
        if (typeof email === "string" && norm(email)) out.add(norm(email));
      }
    }
  }
  return [...out];
}

export type IssuePeople = { dev: string[]; qa: string[] };

export function resolveIssuePeople(args: {
  assigneeEmail: string | null;
  additionalAssigneeEmails: string[] | null;
  customFields: CustomFields | null;
  devOwnerFieldIds: string[] | null;
  qaAssigneeFieldIds: string[] | null;
}): IssuePeople {
  const dev = new Set<string>();
  if (norm(args.assigneeEmail)) dev.add(norm(args.assigneeEmail));
  for (const e of args.additionalAssigneeEmails ?? []) if (norm(e)) dev.add(norm(e));
  for (const e of extractUserEmails(args.customFields, args.devOwnerFieldIds)) dev.add(e);
  return { dev: [...dev], qa: extractUserEmails(args.customFields, args.qaAssigneeFieldIds) };
}
