// Run: ./node_modules/.bin/tsx --test "src/lib/google/sheets.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySheetsFailure } from "./sheets";

test("Google failures map to actionable codes", () => {
  assert.equal(classifySheetsFailure(401, "").code, "not_connected");
  assert.equal(
    classifySheetsFailure(403, '{"error":{"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED"}}').code,
    "scope_missing",
  );
  assert.equal(
    classifySheetsFailure(403, '{"error":{"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}').code,
    "no_access",
  );
  assert.equal(
    classifySheetsFailure(403, "Google Sheets API has not been used in project 123 before or it is disabled.").code,
    "api_disabled",
  );
  assert.equal(classifySheetsFailure(404, "").code, "not_found");
  assert.equal(classifySheetsFailure(429, "").code, "rate_limited");
  assert.equal(classifySheetsFailure(500, "boom").code, "failed");
});
