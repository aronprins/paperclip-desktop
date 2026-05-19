import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isSameProcess,
  shouldHandleTrackedServerExit,
  shouldKillSupersededServer,
  shouldRestorePreviousTrackedServer,
  shouldStopPreviousLocalServerForExposureChange,
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

test("local server lifecycle stops previous server when local exposure changes", () => {
  assert.equal(shouldStopPreviousLocalServerForExposureChange({
    previousMode: "local_embedded",
    currentExposeOnLocalNetwork: false,
    nextExposeOnLocalNetwork: true,
  }), true);
  assert.equal(shouldStopPreviousLocalServerForExposureChange({
    previousMode: "local_embedded",
    currentExposeOnLocalNetwork: true,
    nextExposeOnLocalNetwork: false,
  }), true);
  assert.equal(shouldStopPreviousLocalServerForExposureChange({
    previousMode: "local_embedded",
    currentExposeOnLocalNetwork: true,
    nextExposeOnLocalNetwork: true,
  }), false);
  assert.equal(shouldStopPreviousLocalServerForExposureChange({
    previousMode: "remote_existing",
    currentExposeOnLocalNetwork: false,
    nextExposeOnLocalNetwork: true,
  }), false);
});
