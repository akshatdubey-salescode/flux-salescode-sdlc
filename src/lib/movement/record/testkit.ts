/** Test helpers: load the real Jira comment fixtures (ADF exactly as Jira returned them). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordComment } from "./types";

const DIR = join(__dirname, "__fixtures__");

export const RECORD_FIXTURES = [
  "CAV-7346-81399",
  "CAV-7346-81400",
  "CAV-7346-81421",
  "CAV-7304-81422",
  "CAV-7304-81423",
  "CAV-7304-81424",
  "CAV-7304-81425",
] as const;

/** The re-posted v2 records (LOB-prefixed env columns such as `ckcoedemo | ckcoeuat | ckcoe prod`). */
export const RECORD_FIXTURES_V2 = [
  "CAV-7346-81431",
  "CAV-7346-81432",
  "CAV-7346-81433",
  "CAV-7304-81434",
  "CAV-7304-81435",
  "CAV-7304-81436",
] as const;

/** A free-form record: one code block of label lines and numbered release rows (union of 2 PRs). */
export const UNION_FIXTURE = "CAV-7280-81643";

export const NEGATIVE_FIXTURES = ["CAV-7346-81300", "CAV-7304-80893"] as const;

/** A plain-text record body (`__fixtures__/<name>.txt`), as it would be pasted into a comment. */
export function loadText(name: string): string {
  return readFileSync(join(DIR, `${name}.txt`), "utf8");
}

export function loadFixture(name: string): RecordComment & { author: { displayName: string } } {
  return JSON.parse(readFileSync(join(DIR, `${name}.adf.json`), "utf8"));
}
