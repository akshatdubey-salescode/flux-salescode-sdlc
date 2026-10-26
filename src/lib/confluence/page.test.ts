// Run: ./node_modules/.bin/tsx --test "src/lib/confluence/page.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfluenceError, parsePageUrl, storageToText } from "./page";

const base = "https://applicate.atlassian.net";

test("page ids are read from full links on the project's own site", () => {
  assert.equal(parsePageUrl("https://applicate.atlassian.net/wiki/spaces/ENG/pages/123456/Module+map", base).pageId, "123456");
  assert.equal(parsePageUrl("https://APPLICATE.atlassian.net/wiki/spaces/ENG/pages/9", base).pageId, "9");
  assert.equal(parsePageUrl("https://applicate.atlassian.net/wiki/pages/viewpage.action?pageId=555", base).pageId, "555");
});

test("foreign hosts, plain http, short links and junk are rejected with a reason", () => {
  const code = (u: string) => {
    try {
      parsePageUrl(u, base);
      return "ok";
    } catch (e) {
      assert.ok(e instanceof ConfluenceError);
      return e.code;
    }
  };
  assert.equal(code("https://evil.example.com/wiki/spaces/ENG/pages/1/x"), "foreign_host");
  assert.equal(code("http://applicate.atlassian.net/wiki/spaces/ENG/pages/1/x"), "foreign_host");
  assert.equal(code("https://applicate.atlassian.net.evil.com/wiki/spaces/ENG/pages/1"), "foreign_host");
  assert.equal(code("https://applicate.atlassian.net/wiki/x/AbCd"), "bad_url");
  assert.equal(code("not a url"), "bad_url");
});

test("storage format becomes readable text: headings, lists, tables, code; macros' settings dropped", () => {
  const xhtml =
    '<h2>Modules</h2><p>Orders &amp; <strong>Stock</strong></p><ul><li>Orders -&gt; Invoicing</li><li>Stock</li></ul>' +
    '<table><tr><th>Module</th><th>Depends on</th></tr><tr><td>Orders</td><td>Stock</td></tr></table>' +
    '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">sql</ac:parameter><ac:plain-text-body><![CDATA[select 1;]]></ac:plain-text-body></ac:structured-macro>' +
    '<ac:image><ri:attachment ri:filename="x.png" /></ac:image><p>caf&eacute; &#233;</p>';
  const t = storageToText(xhtml);
  assert.match(t, /## Modules/);
  assert.match(t, /Orders & Stock/);
  assert.match(t, /- Orders -> Invoicing\n- Stock/);
  assert.match(t, /Module \| Depends on\nOrders \| Stock/);
  assert.match(t, /select 1;/);
  assert.ok(!t.includes("sql\n") && !t.includes("x.png"));
  assert.match(t, /é/);
});
