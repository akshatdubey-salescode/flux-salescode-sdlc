import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchPrHeads, headsQuery, sameHead, type GraphQlTransport } from "./heads";

const SECRET = "ghp_SECRET_TOKEN_VALUE";
const tokens = new Map([["salescode-ai", SECRET]]);

describe("fetchPrHeads", () => {
  it("batches 30 PRs per call per org, maps SHAs by repo#number and keeps the token out of the query", async () => {
    const prs = Array.from({ length: 65 }, (_, i) => ({ repoFullName: "salescode-ai/channelkart", number: i + 1 }));
    const seen: Array<{ token: string; query: string; vars: Record<string, unknown> }> = [];
    const transport: GraphQlTransport = async (token, query, vars) => {
      seen.push({ token, query, vars });
      const data: Record<string, { pullRequest: { headRefOid: string } }> = {};
      for (let i = 0; Object.hasOwn(vars, `p${i}`); i++) data[`r${i}`] = { pullRequest: { headRefOid: `abcdef0${String(vars[`p${i}`]).padStart(3, "0")}` } };
      return { data };
    };
    const heads = await fetchPrHeads(prs, { transport, tokens });
    assert.deepEqual(seen.map((s) => (s.query.match(/pullRequest\(/g) ?? []).length).sort((a, b) => a - b), [5, 30, 30]);
    assert.equal(heads.size, 65);
    assert.equal(heads.get("channelkart#7"), "abcdef0007");
    for (const s of seen) {
      assert.equal(s.token, SECRET);
      assert.ok(!s.query.includes(SECRET) && !JSON.stringify(s.vars).includes(SECRET));
      assert.ok(!/mutation/i.test(s.query), "read-only query");
    }
  });

  it("uses one call per org and each org's own token", async () => {
    const used: string[] = [];
    const transport: GraphQlTransport = async (token, _q, vars) => {
      used.push(token);
      return { data: { r0: { pullRequest: { headRefOid: "1111111" } }, ...(vars.p1 ? { r1: { pullRequest: { headRefOid: "2222222" } } } : {}) } };
    };
    const heads = await fetchPrHeads(
      [
        { repoFullName: "salescode-ai/a", number: 1 },
        { repoFullName: "other-org/b", number: 2 },
      ],
      { transport, tokens: new Map([["salescode-ai", "tokA"], ["other-org", "tokB"]]) }
    );
    assert.deepEqual(used.sort(), ["tokA", "tokB"]);
    assert.equal(heads.get("a#1"), "1111111");
    assert.equal(heads.get("b#2"), "1111111");
  });

  it("degrades to unknown: transport error, missing PR, org without a token, junk input", async () => {
    const calls: number[] = [];
    const transport: GraphQlTransport = async (_t, _q, vars) => {
      calls.push(1);
      if (vars.n0 === "boom") throw new Error(`HTTP 502 for ${SECRET}`);
      return { data: { r0: { pullRequest: null }, r1: null } };
    };
    const heads = await fetchPrHeads(
      [
        { repoFullName: "salescode-ai/boom", number: 1 },
        { repoFullName: "salescode-ai/gone", number: 2 },
        { repoFullName: "salescode-ai/gone", number: 3 },
        { repoFullName: "nobody/x", number: 4 },
        { repoFullName: "bad name/x y", number: 5 },
      ],
      { transport, tokens, chunkSize: 1 }
    );
    assert.deepEqual([...heads.values()], ["unknown", "unknown", "unknown", "unknown", "unknown"]);
    assert.equal(calls.length, 3, "no call for the org without a token or the invalid repo");
  });

  it("skips a PR number outside GitHub's Int range without losing the rest of the chunk, and does not guess between owners", async () => {
    const seen: string[] = [];
    const transport: GraphQlTransport = async (_t, q) => {
      seen.push(q);
      return { data: { r0: { pullRequest: { headRefOid: "abcdef1234" } } } };
    };
    const heads = await fetchPrHeads(
      [
        { repoFullName: "salescode-ai/ok", number: 5 },
        { repoFullName: "salescode-ai/huge", number: 2_147_483_648 },
        { repoFullName: "salescode-ai/dup", number: 1 },
        { repoFullName: "other-org/dup", number: 1 },
      ],
      { transport, tokens: new Map([["salescode-ai", "t"], ["other-org", "t"]]) }
    );
    assert.equal(heads.get("ok#5"), "abcdef1234");
    assert.equal(heads.get("huge#2147483648"), "unknown");
    assert.equal(heads.get("dup#1"), "unknown", "same repo name under two owners is ambiguous");
    assert.equal(seen.length, 1);
    assert.equal((seen[0].match(/pullRequest\(/g) ?? []).length, 1, "only the valid PR is queried");
  });

  it("returns an empty map for no PRs without touching tokens or the network", async () => {
    const heads = await fetchPrHeads([], {
      tokens: undefined,
      transport: async () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(heads.size, 0);
  });
});

describe("helpers", () => {
  it("builds one aliased query with variables only", () => {
    const q = headsQuery(2);
    assert.match(q, /r0: repository\(owner: \$o0, name: \$n0\)/);
    assert.match(q, /r1: repository/);
  });
  it("sameHead tolerates abbreviation but not short or different SHAs", () => {
    assert.equal(sameHead("f249c2be9c", "f249c2be9c1234567"), true);
    assert.equal(sameHead("f249c2be9c", "e2ad816ab0"), false);
    assert.equal(sameHead("f24", "f249c2be9c"), false);
    assert.equal(sameHead(undefined, "f249c2be9c"), false);
  });
});
