import test from "node:test";
import assert from "node:assert/strict";
import { deriveState } from "../patchwake/state-machine.js";
type StateInput = Parameters<typeof deriveState>[0];
const state = (overrides: Partial<StateInput> = {}) =>
  deriveState({
    alive: false,
    stopping: false,
    gaveUp: false,
    turn: {},
    status: null,
    waits: false,
    starting: false,
    ...overrides,
  });
test("lifecycle is derived from lock ownership and durable records", () => {
  assert.equal(state(), "CLAIMED");
  assert.equal(state({ alive: true }), "RUNNING");
  assert.equal(state({ alive: true, stopping: true }), "STOPPING");
  assert.equal(state({ stopping: true }), "STOPPED");
  assert.equal(state({ gaveUp: true }), "GAVE_UP");
  const turn = { sequence: 2 };
  assert.equal(state({ turn }), "FAILED");
  assert.equal(state({ turn, starting: true }), "RUNNING");
  assert.equal(
    state({ turn, status: { sequence: 1, exit_code: 0 } }),
    "FAILED",
  );
  assert.equal(
    state({ turn, status: { sequence: 2, exit_code: 1 } }),
    "FAILED",
  );
  assert.equal(
    state({ turn, status: { sequence: 2, exit_code: 0, is_error: true } }),
    "FAILED",
  );
  assert.equal(state({ turn, status: { sequence: 2, exit_code: 0 } }), "IDLE");
  assert.equal(
    state({ turn, status: { sequence: 2, exit_code: 0 }, waits: true }),
    "WAITING",
  );
});
