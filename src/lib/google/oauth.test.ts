// Run: ./node_modules/.bin/tsx --test "src/lib/google/oauth.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GLOBAL_AUTH_GOOGLE_CLIENT_ID = "client-id";
process.env.GLOBAL_AUTH_GOOGLE_CLIENT_SECRET = "client-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

test("the Sheets scope is requested only on demand, on top of the existing scopes", async () => {
  const { buildAuthUrl, OPTIONAL_SCOPES } = await import("./oauth");
  const scopes = (url: string) => new URL(url).searchParams.get("scope")!.split(" ");

  const plain = scopes(buildAuthUrl("s"));
  assert.ok(plain.includes("https://www.googleapis.com/auth/calendar.readonly"));
  assert.ok(!plain.includes(OPTIONAL_SCOPES.sheets), "not asked for at normal connect/sign-in");

  const withSheets = scopes(buildAuthUrl("s", ["sheets"]));
  assert.ok(withSheets.includes(OPTIONAL_SCOPES.sheets));
  assert.ok(withSheets.includes("https://www.googleapis.com/auth/calendar.readonly"), "calendar access is kept");
  assert.equal(OPTIONAL_SCOPES.sheets, "https://www.googleapis.com/auth/spreadsheets.readonly", "read-only, never write");

  const params = new URL(buildAuthUrl("s", ["sheets"])).searchParams;
  assert.equal(params.get("include_granted_scopes"), "true", "additive: existing grants are kept");
  assert.equal(params.get("access_type"), "offline");
});
