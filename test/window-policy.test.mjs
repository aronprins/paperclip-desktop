import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isNavigationAllowed,
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

test("window policy rejects dangerous and confusable navigation schemes (PD-039)", () => {
  const allowedOrigin = "https://paperclip-host.tailnet.ts.net";
  assert.equal(isNavigationAllowed("file:///etc/passwd", allowedOrigin), false);
  assert.equal(isNavigationAllowed("javascript:alert(1)", allowedOrigin), false);
  assert.equal(isNavigationAllowed("data:text/html,<script>1</script>", allowedOrigin), false);
  assert.equal(isNavigationAllowed("about:blank", allowedOrigin), false);
  // Origin-confusable host must not be treated as same-origin.
  assert.equal(
    isNavigationAllowed("https://paperclip-host.tailnet.ts.net.evil.com/", allowedOrigin),
    false,
  );
  // Scheme is part of the origin: http must not match an https allowed origin.
  assert.equal(isNavigationAllowed("http://paperclip-host.tailnet.ts.net/", allowedOrigin), false);
  // Uppercase scheme normalizes; still same origin.
  assert.equal(isNavigationAllowed("HTTPS://paperclip-host.tailnet.ts.net/x", allowedOrigin), true);
});

test("remote partitions are isolated per profile", () => {
  assert.equal(remotePartitionForProfile("abc123"), "persist:paperclip-remote-abc123");
});
