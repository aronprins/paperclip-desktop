import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handleSwipeNavigation } = require("../dist/navigation-gestures.js");

function createHistoryState(options = {}) {
  return {
    canGoBack: options.canGoBack ?? false,
    canGoForward: options.canGoForward ?? false,
    goBackCalls: 0,
    goForwardCalls: 0,
  };
}

function createHistoryStub(state) {
  return {
    canGoBack: () => state.canGoBack,
    canGoForward: () => state.canGoForward,
    goBack: () => {
      state.goBackCalls += 1;
    },
    goForward: () => {
      state.goForwardCalls += 1;
    },
  };
}

test("left swipe navigates back when history is available", () => {
  const state = createHistoryState({ canGoBack: true });

  assert.equal(handleSwipeNavigation("left", createHistoryStub(state)), true);
  assert.equal(state.goBackCalls, 1);
  assert.equal(state.goForwardCalls, 0);
});

test("right swipe navigates forward when history is available", () => {
  const state = createHistoryState({ canGoForward: true });

  assert.equal(handleSwipeNavigation("right", createHistoryStub(state)), true);
  assert.equal(state.goBackCalls, 0);
  assert.equal(state.goForwardCalls, 1);
});

test("swipes are ignored when there is no matching history entry", () => {
  const state = createHistoryState();

  assert.equal(handleSwipeNavigation("left", createHistoryStub(state)), false);
  assert.equal(handleSwipeNavigation("right", createHistoryStub(state)), false);
  assert.equal(state.goBackCalls, 0);
  assert.equal(state.goForwardCalls, 0);
});

test("non-horizontal gestures are ignored", () => {
  const state = createHistoryState({ canGoBack: true, canGoForward: true });

  assert.equal(handleSwipeNavigation("up", createHistoryStub(state)), false);
  assert.equal(state.goBackCalls, 0);
  assert.equal(state.goForwardCalls, 0);
});
