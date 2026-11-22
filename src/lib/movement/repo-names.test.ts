import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRepo, resolveRepoAlias } from "./repo-names";

describe("repo names", () => {
  it("normalizeRepo agrees with the parser convention", () => {
    assert.equal(normalizeRepo("salescode-ai/channelkart-flutter"), "channelkart-flutter");
    assert.equal(normalizeRepo("https://github.com/salescode-ai/Channelkart.git"), "channelkart");
  });

  it("resolves only exact known names and the explicit alias table; never guesses by prefix/suffix", () => {
    const known = ["channelkart", "channelkart-flutter", "salescode-auth-service", "kpi-dashboard"];
    assert.equal(resolveRepoAlias("flutter", known), "channelkart-flutter");
    assert.equal(resolveRepoAlias("auth-service", known), "salescode-auth-service");
    assert.equal(resolveRepoAlias("channelkart", known), "channelkart", "exact name wins; NOT mapped onto channelkart-flutter");
    assert.equal(resolveRepoAlias("channelkart", ["channelkart-flutter"]), "channelkart", "unknown stays as written");
    assert.equal(resolveRepoAlias("dashboard", known), "dashboard", "no suffix guessing");
    assert.equal(resolveRepoAlias("flutter", ["channelkart"]), "flutter", "alias target not known: unresolved");
    assert.equal(resolveRepoAlias("flutter"), "flutter");
  });
});
