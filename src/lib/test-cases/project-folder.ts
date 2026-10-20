// Every project gets one folder in the bucket for all its test-case files. The
// folder is picked once, from the project's name, and kept: renaming the project
// later must not split its files across two folders.

import { safeSegment } from "./filenames";

/**
 * Folder names to try, best first: the project's name, then the name with its
 * Jira project key (when two projects are called the same), then numbered.
 */
export function folderCandidates(projectName: string, projectKey: string, count = 20): string[] {
  const base = safeSegment(projectName, 40);
  const key = safeSegment(projectKey, 12);
  const out = [base, `${base}-${key}`];
  for (let n = 2; out.length < count; n++) out.push(`${base}-${key}-${n}`);
  return out;
}
