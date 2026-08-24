import type { JiraCreateField } from "@/lib/jira/client";

export type CreateDateField = {
  id: string;
  name: string;
  required: boolean;
};

export type CreateDateFields = {
  start: CreateDateField | null;
  due: CreateDateField | null;
};

function toDateField(field: JiraCreateField | undefined): CreateDateField | null {
  if (!field) return null;
  return {
    id: field.fieldId,
    name: field.name,
    required: field.required,
  };
}

function findCandidate(
  fields: JiraCreateField[],
  candidateIds: string[] | null,
  namePattern: RegExp,
  fallbackIds: string[] = []
) {
  const settable = fields.filter(
    (field) =>
      (!field.operations || field.operations.includes("set")) &&
      (!field.schema?.type || field.schema.type === "date")
  );

  for (const id of candidateIds ?? []) {
    const match = settable.find(
      (field) => field.fieldId === id || field.key === id
    );
    if (match) return match;
  }

  for (const id of fallbackIds) {
    const match = settable.find(
      (field) => field.fieldId === id || field.key === id
    );
    if (match) return match;
  }

  return settable.find((field) => namePattern.test(field.name.trim()));
}

/**
 * Maps the portal's planned start/due concepts to the actual fields available
 * for a Jira project + issue type create screen.
 */
export function selectCreateDateFields(
  fields: JiraCreateField[],
  startDateFieldIds: string[] | null,
  endDateFieldIds: string[] | null
): CreateDateFields {
  return {
    start: toDateField(
      findCandidate(
        fields,
        startDateFieldIds,
        /^start\s*date$/i,
        ["customfield_10015", "startdate", "start_date"]
      )
    ),
    due: toDateField(
      findCandidate(
        fields,
        endDateFieldIds,
        /^(due|end)\s*date$/i,
        ["duedate", "due_date", "end_date"]
      )
    ),
  };
}
