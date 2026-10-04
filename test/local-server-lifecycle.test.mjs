import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isSameProcess,
  shouldHandleTrackedServerExit,
  shouldKillSupersededServer,
  shouldRestorePreviousTrackedServer,
  shouldStopPreviousServerBeforeRestart,
  shouldStopAttemptedServer,
} = require("../dist/connection/local-server-lifecycle.js");

test("local server lifecycle matches processes by pid", () => {
  assert.equal(isSameProcess({ pid: 101 }, { pid: 101 }), true);
  assert.equal(isSameProcess({ pid: 101 }, { pid: 202 }), false);
  assert.equal(isSameProcess({ pid: 101 }, null), false);
});

test("local server lifecycle ignores exits from superseded processes", () => {
  const previous = { pid: 101 };
  const next = { pid: 202 };

  assert.equal(shouldHandleTrackedServerExit(next, next), true);
  assert.equal(shouldHandleTrackedServerExit(next, previous), false);
});

test("forced local restart stops the previous server before replacement startup", () => {
  assert.equal(shouldStopPreviousServerBeforeRestart({ pid: 101 }, true), true);
  assert.equal(shouldStopPreviousServerBeforeRestart({ pid: 101 }, false), false);
  assert.equal(shouldStopPreviousServerBeforeRestart(null, true), false);
});

test("local server lifecycle kills the previous process after a successful swap", () => {
  assert.equal(shouldKillSupersededServer({ pid: 101 }, { pid: 202 }), true);
  assert.equal(shouldKillSupersededServer({ pid: 101 }, { pid: 101 }), false);
  assert.equal(shouldKillSupersededServer(null, { pid: 202 }), false);
});

test("local server lifecycle restores the previous process after a failed replacement", () => {
  const previous = { pid: 101 };
  const attempted = { pid: 202 };

  assert.equal(shouldStopAttemptedServer(attempted, attempted), true);
  assert.equal(shouldRestorePreviousTrackedServer(previous, attempted, attempted), true);
  assert.equal(shouldRestorePreviousTrackedServer(null, attempted, attempted), false);
});
