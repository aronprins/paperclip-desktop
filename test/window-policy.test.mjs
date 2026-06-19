import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isNavigationAllowed,
  newWindowPolicyAction,
  shouldOpenExternally,
  remotePartitionForProfile,
} = require("../dist/connection/window-policy.js");

test("window policy only allows same-origin navigation", () => {
  const allowedOrigin = "https://paperclip-host.tailnet.ts.net";
  assert.equal(isNavigationAllowed("https://paperclip-host.tailnet.ts.net/dashboard", allowedOrigin), true);
  assert.equal(isNavigationAllowed("https://example.com", allowedOrigin), false);
});

test("window policy opens external http links outside the allowed origin", () => {
  const allowedOrigin = "http://localhost:3100";
  assert.equal(shouldOpenExternally("https://docs.paperclip.ing", allowedOrigin), true);
  assert.equal(shouldOpenExternally("http://localhost:3100/settings", allowedOrigin), false);
  assert.equal(shouldOpenExternally("mailto:test@example.com", allowedOrigin), false);
});

test("new-window policy navigates same-origin http links in the app", () => {
  const allowedOrigin = "http://localhost:3100";
  assert.equal(
    newWindowPolicyAction(
      "http://localhost:3100/agents/agent_123/runs/run_456",
      allowedOrigin,
    ),
    "navigate-in-app",
  );
});

test("new-window policy opens different-origin http links externally", () => {
  const allowedOrigin = "https://paperclip-host.tailnet.ts.net";
  assert.equal(
    newWindowPolicyAction("https://docs.paperclip.ing/reference", allowedOrigin),
    "open-externally",
  );
  assert.equal(
    newWindowPolicyAction("http://example.com", allowedOrigin),
    "open-externally",
  );
});

test("new-window policy denies unsupported and malformed urls", () => {
  const allowedOrigin = "http://localhost:3100";
  assert.equal(newWindowPolicyAction("mailto:test@example.com", allowedOrigin), "deny");
  assert.equal(newWindowPolicyAction("file:///tmp/index.html", allowedOrigin), "deny");
  assert.equal(newWindowPolicyAction("not a url", allowedOrigin), "deny");
});

test("remote partitions are isolated per profile", () => {
  assert.equal(remotePartitionForProfile("abc123"), "persist:paperclip-remote-abc123");
});
