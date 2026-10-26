// Run: ./node_modules/.bin/tsx --test "src/lib/test-cases/ai-review/ai-reviewer-rules.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_OPENING_STATE, aiStateAfterFailure, aiStateAfterRun, applyCarryOver, canApprove, canDecide, canOverride, planOverride, requiredReviewersMissing, roundStatusFrom } from "../state";
import { validateReviewers } from "../reviewers";
import { AI_REVIEWER_EMAIL, isAiReviewer } from "../values";
import { getLlmConfig, buildBody, parseResponse, DEFAULT_MINIMAX_MODEL, DEFAULT_MINIMAX_BASE_URL } from "@/lib/llm/minimax";

const human = { email: "rev@x.com", name: "Rev" };
const ai = (state: Parameters<typeof roundStatusFrom>[0][number]) => ({ email: AI_REVIEWER_EMAIL, name: "AI review", state });

test("the AI never approves: a clean run leaves it pending, so a human approval is still needed", () => {
  assert.equal(aiStateAfterRun(0), "pending");
  assert.equal(roundStatusFrom([aiStateAfterRun(0)]), "in_review");
  assert.equal(roundStatusFrom([aiStateAfterRun(0), "approved"]), "approved");
});

test("AI findings block like a reviewer's change request, and approving is refused until they are overridden", () => {
  assert.equal(aiStateAfterRun(3), "changes_requested");
  assert.equal(roundStatusFrom(["approved", aiStateAfterRun(3)]), "changes_requested");
  const reviewers = [ai("changes_requested"), { ...human, state: "pending" as const }];
  const verdict = canApprove({ email: human.email, isAdmin: false }, reviewers);
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? "" : verdict.reason, /AI review has requested changes/);
});

test("a reviewer can override the AI's findings; the AI is marked overridden and the round approves", () => {
  const reviewers = [ai("changes_requested"), { ...human, state: "pending" as const }];
  assert.ok(canOverride({ actor: { email: human.email, isAdmin: false }, reviewers, isLatestRound: true, openFeedback: true }).ok);
  const plan = planOverride(reviewers, human.email);
  assert.equal(plan.states.get(AI_REVIEWER_EMAIL), "overridden");
  assert.equal(plan.states.get(human.email), "approved");
  assert.equal(roundStatusFrom([...plan.states.values()]), "approved");
});

test("nobody can decide as the AI, and it can't be assigned or dropped by a submitter", () => {
  assert.equal(canDecide({ email: "someone@x.com", isAdmin: false }, [ai("pending")], true).ok, false);
  const bad = validateReviewers([{ email: "AI-Review@flux.local" }], "me@x.com");
  assert.equal(bad.ok, false);
  assert.ok(isAiReviewer(" AI-REVIEW@flux.local "));
  assert.deepEqual(requiredReviewersMissing([ai("changes_requested")], [{ email: human.email }], false), []);
});

test("a resubmission puts the AI back to waiting until the new run settles it; a failed run releases the hold", () => {
  assert.equal(AI_OPENING_STATE, "re_review");
  assert.equal(roundStatusFrom(["approved", AI_OPENING_STATE]), "in_review");
  assert.equal(aiStateAfterFailure("re_review"), "pending");
  assert.equal(aiStateAfterFailure("changes_requested"), "changes_requested");
  assert.equal(roundStatusFrom(["approved", aiStateAfterFailure("re_review")]), "approved");
  // Humans still carry over as before.
  assert.equal(applyCarryOver([{ ...human, state: "changes_requested", decidedAt: null, decidedRoundNo: null }], [human])[0].state, "re_review");
});

test("LLM config: only the key is required, defaults apply, bad effort falls back", () => {
  assert.equal(getLlmConfig({}), null);
  assert.equal(getLlmConfig({ MINIMAX_API_KEY: "  " }), null);
  const d = getLlmConfig({ MINIMAX_API_KEY: "k" })!;
  assert.equal(d.model, DEFAULT_MINIMAX_MODEL);
  assert.equal(d.baseUrl, DEFAULT_MINIMAX_BASE_URL);
  assert.equal(d.effort, "medium");
  const o = getLlmConfig({ MINIMAX_API_KEY: "k", MINIMAX_MODEL: "MiniMax-M3", MINIMAX_BASE_URL: "https://x.test/anthropic/", MINIMAX_EFFORT: "bogus" })!;
  assert.deepEqual([o.model, o.baseUrl, o.effort], ["MiniMax-M3", "https://x.test/anthropic", "medium"]);
});

test("request body: effort only for Flash, tool forced when asked; response keeps text and tool blocks only", () => {
  const flash = buildBody(getLlmConfig({ MINIMAX_API_KEY: "k" })!, { system: "s", messages: [], maxTokens: 10, tools: [{ name: "t", description: "", input_schema: {} }], forceTool: "t" });
  assert.deepEqual(flash.output_config, { effort: "medium" });
  assert.deepEqual(flash.tool_choice, { type: "tool", name: "t" });
  const m3 = buildBody(getLlmConfig({ MINIMAX_API_KEY: "k", MINIMAX_MODEL: "MiniMax-M3" })!, { system: "s", messages: [], maxTokens: 10 });
  assert.equal("output_config" in m3, false);
  assert.equal("tools" in m3, false);

  const r = parseResponse(
    { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }, { type: "tool_use", id: "i", name: "t", input: { a: 1 } }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 7 } },
    "m",
  );
  assert.deepEqual(r.blocks.map((b) => b.type), ["text", "tool_use"]);
  assert.deepEqual([r.inputTokens, r.outputTokens, r.model], [5, 7, "m"]);
});
