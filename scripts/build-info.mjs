#!/usr/bin/env node
//
// Writes public/version.json so a deployment can be asked what it actually is:
//   curl -s https://<host>/version.json
//
// Next.js serves public/ as static files, so this needs no route and no runtime
// step. src/proxy.ts excludes the path from its matcher so it answers without a
// session.
//
// Runs from scripts/build.sh before `next build`. Each value comes from the first
// source that has it:
//
//   1. Vercel's system env (VERCEL_GIT_*) — a Git-triggered Vercel build. Its
//      checkout can be shallow and detached, so git alone would report the branch
//      as "HEAD".
//   2. BUILD_GIT_* — passed with `vercel deploy --build-env` by a CLI deploy
//      that uploads without .git, where neither of the above exists.
//   3. Local git — a developer's `pnpm build`.
//   4. null — the file must always be valid JSON, even with none of the above.
//
// Node rather than POSIX sh (promotions-co-pilot uses sh because its Jenkins agent
// has no node): every place this runs already has node, and JSON.stringify escapes
// commit messages correctly.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "public", "version.json");

function env(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function git(...args) {
  try {
    const out = execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const firstLine = (s) => (s ? s.split(/\r?\n/)[0].trim() || null : null);

const commitId = env("VERCEL_GIT_COMMIT_SHA") ?? env("BUILD_GIT_COMMIT_SHA") ?? git("rev-parse", "HEAD");

let branch = env("VERCEL_GIT_COMMIT_REF") ?? env("BUILD_GIT_BRANCH") ?? git("rev-parse", "--abbrev-ref", "HEAD");
if (branch === "HEAD") branch = null;

// Look up the commit chosen above, not HEAD, so the fields can't describe two
// commits. Vercel exposes no commit time; its checkout usually has the commit.
const fromCommit = (...format) => (commitId ? git("log", "-1", ...format, commitId) : null);

const message = firstLine(
  env("VERCEL_GIT_COMMIT_MESSAGE") ?? env("BUILD_GIT_COMMIT_MESSAGE") ?? fromCommit("--format=%s"),
);

const commitTime =
  env("BUILD_GIT_COMMIT_TIME") ?? fromCommit("--date=format:%Y-%m-%dT%H:%M:%S%z", "--format=%cd");

const tag = commitId ? git("describe", "--tags", "--exact-match", commitId) : null;

const author =
  env("VERCEL_GIT_COMMIT_AUTHOR_LOGIN") ?? env("BUILD_GIT_COMMIT_AUTHOR") ?? fromCommit("--format=%an");

const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const shortSha = commitId ? commitId.slice(0, 7) : null;

const info = {
  status: "UP",
  version: shortSha ? `${pkgVersion}+${shortSha}` : pkgVersion,
  buildTime: new Date().toISOString(),
  // The environment the build was made for. A Vercel preview build promoted to
  // production keeps saying "preview": promotion reuses the build.
  environment: env("VERCEL_TARGET_ENV") ?? env("VERCEL_ENV") ?? "local",
  deploymentUrl: env("VERCEL_URL"),
  lastCommitInfo: commitId
    ? { time: commitTime, commitId, message, branch, tag, author }
    : null,
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, JSON.stringify(info, null, 2) + "\n");
console.log(`build-info: ${info.version} (${branch ?? "unknown branch"}, ${info.environment})`);
