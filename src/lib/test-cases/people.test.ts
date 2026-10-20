// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/people.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUserEmails, resolveIssuePeople } from "./people";

test("emails are read from single-user and multi-user picker fields, normalised and de-duplicated", () => {
  const cf = {
    customfield_1: { emailAddress: "Asha@Salescode.ai", accountId: "a" },
    customfield_2: [{ emailAddress: "bo@salescode.ai" }, { emailAddress: "ASHA@salescode.ai" }, { accountId: "no-email" }],
    customfield_3: "not a user",
    customfield_4: null,
  };
  assert.deepEqual(extractUserEmails(cf, ["customfield_1", "customfield_2", "customfield_3", "customfield_4", "customfield_9"]).sort(), ["asha@salescode.ai", "bo@salescode.ai"]);
  assert.deepEqual(extractUserEmails(null, ["x"]), []);
  assert.deepEqual(extractUserEmails({ a: 1 }, null), []);
});

test("developers are the assignee(s) and Dev Owner; testers come from the QA picker fields", () => {
  const people = resolveIssuePeople({
    assigneeEmail: "Dev1@salescode.ai",
    additionalAssigneeEmails: ["dev2@salescode.ai", ""],
    customFields: { dev_owner: { emailAddress: "dev3@salescode.ai" }, qa: [{ emailAddress: "qa1@salescode.ai" }] },
    devOwnerFieldIds: ["dev_owner"],
    qaAssigneeFieldIds: ["qa"],
  });
  assert.deepEqual(people.dev.sort(), ["dev1@salescode.ai", "dev2@salescode.ai", "dev3@salescode.ai"]);
  assert.deepEqual(people.qa, ["qa1@salescode.ai"]);
});

test("an issue with no people data resolves to empty lists", () => {
  assert.deepEqual(
    resolveIssuePeople({ assigneeEmail: null, additionalAssigneeEmails: null, customFields: null, devOwnerFieldIds: null, qaAssigneeFieldIds: null }),
    { dev: [], qa: [] },
  );
});
