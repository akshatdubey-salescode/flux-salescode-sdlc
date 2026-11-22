import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Linkified, LinkProvider } from "./linkified";
import { GITHUB_DEFAULT_OWNER, linkifySegments, parseStateWords, richSegments } from "./rich-text";

const ctx = { jiraBaseUrl: "https://applicate.atlassian.net" };
const links = (t: string, c: { jiraBaseUrl: string | null } = ctx) => linkifySegments(t, c).filter((s) => s.type !== "text").map((s) => [s.type, s.text, (s as { href: string }).href]);

describe("links in comment text", () => {
  it("a Jira key links to <base>/browse/<KEY>", () => {
    assert.deepEqual(links("CAV-7280"), [["jira", "CAV-7280", "https://applicate.atlassian.net/browse/CAV-7280"]]);
    assert.deepEqual(linkifySegments("see CAV-7280, done", ctx).map((s) => s.type), ["text", "jira", "text"]);
  });
  it("a PR reference links to GitHub with the default owner; an explicit owner wins", () => {
    assert.equal(GITHUB_DEFAULT_OWNER, "salescode-ai");
    assert.deepEqual(links("slake-custom-reports#931"), [["pr", "slake-custom-reports#931", "https://github.com/salescode-ai/slake-custom-reports/pull/931"]]);
    assert.deepEqual(links("owner/repo#12"), [["pr", "owner/repo#12", "https://github.com/owner/repo/pull/12"]]);
  });
  it("several in one text, in order, with the plain text between", () => {
    const segs = linkifySegments("channelkart-flutter#49 and CAV-7304", ctx);
    assert.deepEqual(segs.map((s) => [s.type, s.text]), [["pr", "channelkart-flutter#49"], ["text", " and "], ["jira", "CAV-7304"]]);
    assert.equal((segs[0] as { href: string }).href, "https://github.com/salescode-ai/channelkart-flutter/pull/49");
  });
  it("NOT linked: UTF-8, ISO-27001, #931, an alias without a repo, v2.1-3", () => {
    for (const t of ["UTF-8", "ISO-27001", "#931", "executor #931", "v2.1-3", "SHA-256", "xCAV-7280", "CAV-7280x"]) {
      assert.deepEqual(links(t), [], t);
      assert.deepEqual(linkifySegments(t, ctx), [{ type: "text", text: t }], t);
    }
  });
  it("without a usable Jira base URL the keys stay text, PRs still link; only http(s) URLs link", () => {
    for (const base of [null, "", "javascript:alert(1)", "ftp://x"] as Array<string | null>) assert.deepEqual(links("CAV-7280 and lite#5", { jiraBaseUrl: base }).map((l) => l[0]), ["pr"], String(base));
    assert.deepEqual(links("see https://x.io/a?b=1, ok").map((l) => [l[0], l[1]]), [["url", "https://x.io/a?b=1"]]);
    assert.deepEqual(links("javascript:alert(1) and data:text/html,x"), []);
    assert.deepEqual(links("a https://x.io/CAV-7280 b").map((l) => l[0]), ["url"], "a Jira key inside a URL is part of the URL");
  });
});

describe("state words", () => {
  const states = (t: string) => parseStateWords(t).filter((s) => s.type === "state").map((s) => (s.type === "state" ? [s.text, s.state, s.owner] : []));
  it("'Done none' -> Done is a state, 'none' stays text", () => {
    assert.deepEqual(parseStateWords("Done none"), [{ type: "state", text: "Done", state: "done", owner: null }, { type: "text", text: " none" }]);
  });
  it("Not done after a label is a state; lower-case prose ('was not done yet') and words containing it are not", () => {
    assert.deepEqual(states("Rollback: Not done, see QA"), [["Not done", "notdone", null]]);
    assert.deepEqual(states("The step was not done yet"), []);
    assert.deepEqual(states("Undone done_at Done_x"), []);
    assert.deepEqual(parseStateWords("Rollback: Not done").map((s) => s.type), ["text", "state"]);
  });
  it("unknown (owner): the owner is kept apart for a muted tag", () => {
    assert.deepEqual(states("Config X: unknown (QA)"), [["unknown (QA)", "unknown", "QA"]]);
    assert.deepEqual(states("unknown (Dev lead)"), [["unknown (Dev lead)", "unknown", "Dev lead"]]);
  });
  it("NA, N/A, Not Required are grey 'na'; NATO and N/A-1 are not", () => {
    assert.deepEqual(states("NA and N/A and Not Required and n/a").map((s) => s[1]), ["na", "na", "na", "na"]);
    assert.deepEqual(states("NATO, NAME, NA1"), []);
  });
  it("Yes / No count right after a label, not as the first word of prose", () => {
    assert.deepEqual(states("Downtime: No"), [["No", "yesno", null]]);
    assert.deepEqual(states("Restart: Yes, both services"), [["Yes", "yesno", null]]);
    assert.deepEqual(states("No review comment found on this Jira"), []);
    assert.deepEqual(states("it is Yes or No"), []);
  });
  it("links first, then state words inside the plain pieces: one text can hold both", () => {
    const segs = richSegments("CAV-7280: Not done, see lite#5 (unknown (QA))", ctx);
    assert.deepEqual(segs.map((s) => s.type), ["jira", "text", "state", "text", "pr", "text", "state", "text"]);
  });
});

describe("rendering is React text only", () => {
  const html = (text: string, base: string | null = "https://j.atlassian.net") => renderToStaticMarkup(h(LinkProvider, { jiraBaseUrl: base, children: h("p", null, h(Linkified, { text })) }));
  it("a link opens in a new tab with noopener; the Jira base URL comes from the provider", () => {
    const out = html("CAV-7280 and lite#5");
    assert.match(out, /<a href="https:\/\/j\.atlassian\.net\/browse\/CAV-7280" target="_blank" rel="noopener noreferrer"[^>]*>CAV-7280<\/a>/);
    assert.match(out, /<a href="https:\/\/github\.com\/salescode-ai\/lite\/pull\/5" target="_blank" rel="noopener noreferrer"[^>]*>lite#5<\/a>/);
    assert.ok(!/<a [^>]*>CAV-7280/.test(html("CAV-7280", null)), "no base URL, no Jira link");
  });
  it("each state has its own look: Done green semibold, NOT DONE red bold uppercase, N/A grey italic, unknown amber italic dotted with the owner tag", () => {
    const out = html("Deploy: Done; Rollback: Not done; Tests: N/A; Config: unknown (QA); Restart: Yes");
    assert.match(out, /data-state="done" class="[^"]*font-semibold[^"]*emerald/);
    assert.match(out, /data-state="notdone" class="[^"]*font-bold[^"]*uppercase[^"]*tracking-wider[^"]*red/);
    assert.match(out, /data-state="na" class="[^"]*italic[^"]*text-muted-foreground/);
    assert.match(out, /data-state="unknown" class="[^"]*italic[^"]*amber[^"]*decoration-dotted[^"]*">unknown <span[^>]*>QA<\/span>/);
    assert.match(out, /data-state="yesno" class="[^"]*sky/);
  });
  it("HTML in the text is text, never markup", () => {
    const out = html('<img src=x onerror=alert(1)> <script>alert(1)</script> CAV-1');
    assert.ok(!out.includes("<img") && !out.includes("<script>"));
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});
