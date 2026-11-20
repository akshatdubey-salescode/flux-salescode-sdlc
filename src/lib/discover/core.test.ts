import test from "node:test";
import assert from "node:assert/strict";
import {
  canPublish,
  cleanUrl,
  commentRecipients,
  generateShortId,
  nameFromEmail,
  normalizeTag,
  normalizeTags,
  parseShowcaseParam,
  showcasePath,
  slugify,
  videoEmbed,
} from "./core";

test("slugify makes readable, bounded slugs", () => {
  assert.equal(slugify("Jira Digest Bot!"), "jira-digest-bot");
  assert.equal(slugify("  Café — résumé  "), "cafe-resume");
  assert.equal(slugify("!!!"), "untitled");
  assert.ok(slugify("a".repeat(200)).length <= 60);
});

test("short ids round-trip through the URL, and stale slugs still resolve", () => {
  const shortId = generateShortId();
  assert.equal(shortId.length, 6);
  const path = showcasePath({ slug: "jira-digest-bot", shortId });
  const seg = path.split("/").pop()!;
  assert.deepEqual(parseShowcaseParam(seg), { slug: "jira-digest-bot", shortId });
  assert.deepEqual(parseShowcaseParam(`old-name-${shortId}`)?.shortId, shortId);
  assert.deepEqual(parseShowcaseParam(shortId), { slug: "", shortId });
  assert.equal(parseShowcaseParam("no-id-here-0"), null);
  assert.equal(parseShowcaseParam("bad-%E0-abcdef"), null);
  assert.equal(parseShowcaseParam("x-ABCDEF".toLowerCase() + "0"), null);
});

test("tags normalise to lowercase-kebab, dedupe and cap", () => {
  assert.equal(normalizeTag("AI Agent"), "ai-agent");
  assert.equal(normalizeTag("#CLI"), "cli");
  assert.equal(normalizeTag("next.js"), "next.js");
  assert.equal(normalizeTag("  --  "), "");
  assert.deepEqual(normalizeTags(["Jira", "jira", " JIRA ", "", "Slack Bot"]), ["jira", "slack-bot"]);
  assert.equal(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 8);
});

test("cleanUrl accepts http(s) only", () => {
  assert.equal(cleanUrl("", "Repo URL"), null);
  assert.equal(cleanUrl(" https://github.com/x/y ", "Repo URL"), "https://github.com/x/y");
  assert.throws(() => cleanUrl("javascript:alert(1)", "Repo URL"), /http/);
  assert.throws(() => cleanUrl("github.com/x", "Repo URL"), /full URL/);
});

test("video embeds are allow-listed and rebuilt from the parsed id", () => {
  assert.deepEqual(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    provider: "youtube",
    src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  });
  assert.equal(videoEmbed("https://youtu.be/dQw4w9WgXcQ?t=3")?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://www.loom.com/share/abc123def")?.src, "https://www.loom.com/embed/abc123def");
  assert.equal(
    videoEmbed("https://drive.google.com/file/d/1AbC_d-E/view?usp=sharing")?.src,
    "https://drive.google.com/file/d/1AbC_d-E/preview",
  );
  assert.equal(videoEmbed("https://vimeo.com/123"), null);
  assert.equal(videoEmbed("https://www.youtube.com/watch?v=x\"onload=alert(1)"), null);
  assert.equal(videoEmbed("https://evil.com/youtube.com/watch?v=abc"), null);
  assert.equal(videoEmbed(null), null);
});

test("comment recipients: author, plus parent commenter on replies, never the actor", () => {
  assert.deepEqual(commentRecipients({ actorId: "b@x", showcaseAuthorId: "a@x" }), ["a@x"]);
  assert.deepEqual(commentRecipients({ actorId: "a@x", showcaseAuthorId: "a@x" }), []);
  assert.deepEqual(
    commentRecipients({ actorId: "c@x", showcaseAuthorId: "a@x", parentAuthorId: "b@x" }).sort(),
    ["a@x", "b@x"],
  );
  assert.deepEqual(commentRecipients({ actorId: "c@x", showcaseAuthorId: "a@x", parentAuthorId: "a@x" }), ["a@x"]);
  assert.deepEqual(commentRecipients({ actorId: "b@x", showcaseAuthorId: "a@x", parentAuthorId: "b@x" }), ["a@x"]);
});

test("nameFromEmail", () => {
  assert.equal(nameFromEmail("akshat.dubey@salescode.ai"), "Akshat Dubey");
  assert.equal(nameFromEmail("jane_doe-smith@x.com"), "Jane Doe Smith");
});

test("canPublish requires title, tagline and body", () => {
  assert.equal(canPublish({ title: "T", tagline: "tag", body: "b" }).ok, true);
  assert.equal(canPublish({ title: " ", tagline: "tag", body: "b" }).ok, false);
  assert.equal(canPublish({ title: "T", tagline: "", body: "b" }).ok, false);
  assert.equal(canPublish({ title: "T", tagline: "x".repeat(121), body: "b" }).ok, false);
  assert.equal(canPublish({ title: "T", tagline: "tag", body: "" }).ok, false);
});
