import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shapeChips } from "./chips";

const r = (deliveryId: string, environment: "demo" | "uat" | "prod", status: string, id = `${deliveryId}-${environment}-${status}`) => ({ id, deliveryId, environment, status });

describe("movement chips of the deliveries list", () => {
  it("groups by delivery, drops cancelled, orders demo, uat, prod and keeps one chip per environment", () => {
    const m = shapeChips([r("d1", "prod", "done"), r("d1", "demo", "ready"), r("d1", "uat", "cancelled"), r("d2", "uat", "draft"), r("d1", "demo", "draft", "dup")]);
    assert.deepEqual(m.get("d1")?.map((c) => [c.environment, c.status, c.id]), [["demo", "ready", "d1-demo-ready"], ["prod", "done", "d1-prod-done"]]);
    assert.deepEqual(m.get("d2")?.map((c) => c.environment), ["uat"]);
    assert.equal(m.has("d3"), false);
    assert.ok([...m.values()].every((l) => l.length <= 3));
  });
  it("a delivery with only cancelled movements has no entry; the rows' extra fields are not leaked", () => {
    const m = shapeChips([r("d1", "uat", "cancelled")]);
    assert.equal(m.size, 0);
    assert.deepEqual(Object.keys(shapeChips([r("d1", "uat", "ready")]).get("d1")![0]).sort(), ["environment", "id", "status"]);
  });
});
