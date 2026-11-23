import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MOVEMENT_ENVIRONMENT_VALUES,
  MOVEMENT_READINESS_VALUES,
  MOVEMENT_RESULT_VALUES,
  MOVEMENT_SLOT_VALUES,
  MOVEMENT_SNAPSHOT_REASON_VALUES,
  MOVEMENT_STATUS_VALUES,
  isMovementEnvironment,
  isMovementReadiness,
  isMovementResult,
  isMovementSlot,
  isMovementSnapshotReason,
  isMovementStatus,
} from "./values";

describe("movement value guards", () => {
  const cases = [
    [isMovementEnvironment, MOVEMENT_ENVIRONMENT_VALUES],
    [isMovementStatus, MOVEMENT_STATUS_VALUES],
    [isMovementSlot, MOVEMENT_SLOT_VALUES],
    [isMovementReadiness, MOVEMENT_READINESS_VALUES],
    [isMovementResult, MOVEMENT_RESULT_VALUES],
    [isMovementSnapshotReason, MOVEMENT_SNAPSHOT_REASON_VALUES],
  ] as const;

  it("accept every persisted value", () => {
    for (const [guard, values] of cases) {
      for (const v of values) assert.equal(guard(v), true, v);
    }
  });

  it("reject unknown, wrong-case, inherited-key and non-string input", () => {
    for (const [guard] of cases) {
      for (const bad of ["", "PROD", "toString", "__proto__", 1, null, undefined, {}]) {
        assert.equal(guard(bad), false, String(bad));
      }
    }
  });

  it("do not accept a value from a different set", () => {
    assert.equal(isMovementEnvironment("signed_off"), false);
    assert.equal(isMovementSlot("prod"), false);
  });
});
