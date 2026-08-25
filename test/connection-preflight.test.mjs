import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { preflightRemoteConnection } = require("../dist/connection/preflight.js");

test("preflight accepts authenticated Paperclip with active session", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        version: "2026.403.0",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        authReady: true,
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    jsonResponse(
      {
        session: { id: "paperclip:session:1", userId: "user-1" },
        user: { id: "user-1" },
      },
      200,
    ),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    localServerVersion: "2026.403.0",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.insecureTransport, false);
  assert.equal(result.sessionState, "signed_in");
  assert.equal(result.deploymentMode, "authenticated");
  assert.equal(result.bootstrapStatus, "ready");
});

test("preflight treats 401 session probe as sign-in required", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        version: "2026.403.0",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        authReady: true,
        bootstrapStatus: "bootstrap_pending",
        bootstrapInviteActive: false,
      },
      200,
    ),
    authRequiredResponse(),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.insecureTransport, false);
  assert.equal(result.sessionState, "signed_out");
  assert.equal(result.bootstrapStatus, "bootstrap_pending");
});

test("preflight accepts redacted authenticated health with Paperclip auth-required session response", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        deploymentMode: "authenticated",
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    authRequiredResponse(),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionState, "signed_out");
  assert.equal(result.deploymentMode, "authenticated");
  assert.equal(result.deploymentExposure, null);
  assert.equal(result.authReady, null);
  assert.equal(result.bootstrapStatus, "ready");
  assert.equal(result.bootstrapInviteActive, false);
});

test("preflight accepts redacted authenticated health with active Paperclip session", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        deploymentMode: "authenticated",
        bootstrapStatus: "bootstrap_pending",
        bootstrapInviteActive: true,
      },
      200,
    ),
    jsonResponse(
      {
        session: { id: "paperclip:session:user-1", userId: "user-1" },
        user: { id: "user-1" },
      },
      200,
    ),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net/some/path?ignored=true#hash",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.normalizedUrl, "https://paperclip-host.tailnet.ts.net/");
  assert.equal(result.sessionState, "signed_in");
  assert.equal(result.bootstrapStatus, "bootstrap_pending");
  assert.equal(result.bootstrapInviteActive, true);
});

test("preflight accepts redacted authenticated health when deploymentExposure is present without authReady", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        deploymentMode: "authenticated",
        deploymentExposure: "public",
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    authRequiredResponse(),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.example.com",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.paperclipDetected, true);
  assert.equal(result.sessionState, "signed_out");
  assert.equal(result.deploymentExposure, "public");
});

test("preflight rejects redacted health with generic 401 session response", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        deploymentMode: "authenticated",
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    jsonResponse({ error: "Unauthorized" }, 401),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://example.com",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_paperclip");
  assert.equal(result.paperclipDetected, true);
  assert.equal(result.sessionState, "unknown");
});

test("preflight rejects redacted health without bootstrap invite state", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    fetchImpl: async () =>
      jsonResponse(
        {
          status: "ok",
          deploymentMode: "authenticated",
          bootstrapStatus: "ready",
        },
        200,
      ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_paperclip");
  assert.equal(result.paperclipDetected, false);
});

test("preflight treats explicit authReady false as auth not ready", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    fetchImpl: async () =>
      jsonResponse(
        {
          status: "ok",
          version: "2026.403.0",
          deploymentMode: "authenticated",
          deploymentExposure: "private",
          authReady: false,
          bootstrapStatus: "ready",
          bootstrapInviteActive: false,
        },
        200,
      ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "auth_not_ready");
  assert.equal(result.paperclipDetected, true);
});

test("preflight blocks local_trusted remotes", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://192.168.1.50:3100",
    fetchImpl: async () =>
      jsonResponse(
        {
          status: "ok",
          version: "2026.403.0",
          deploymentMode: "local_trusted",
          deploymentExposure: "private",
          authReady: true,
          bootstrapStatus: "ready",
          bootstrapInviteActive: false,
        },
        200,
      ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.insecureTransport, false);
  assert.equal(result.reason, "unsupported_local_trusted");
});

test("preflight rejects unsupported URL schemes before any network call", async () => {
  let called = false;
  const result = await preflightRemoteConnection({
    remoteUrl: "ftp://paperclip.example.com",
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ status: "ok" }, 200);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_url");
  assert.match(result.detail, /http or https/i);
  assert.equal(called, false);
});

test("preflight allows http remotes and carries the insecurity warning", async () => {
  const responses = [
    jsonResponse(
      {
        status: "ok",
        version: "2026.403.0",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        authReady: true,
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    authRequiredResponse(),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "http://paperclip.example.com:3200",
    fetchImpl: async () => responses.shift(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.insecureTransport, true);
  assert.equal(result.origin, "http://paperclip.example.com:3200");
  assert.equal(result.sessionState, "signed_out");
  assert.match(result.warning, /without TLS/i);
});

test("preflight rejects non-Paperclip endpoints", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://example.com",
    fetchImpl: async () => jsonResponse({ hello: "world" }, 200),
  });

  assert.equal(result.ok, false);
  assert.equal(result.insecureTransport, false);
  assert.equal(result.reason, "not_paperclip");
});

test("preflight rejects health responses that are not HTTP 200", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net",
    fetchImpl: async () =>
      jsonResponse(
        {
          status: "ok",
          deploymentMode: "authenticated",
          bootstrapStatus: "ready",
          bootstrapInviteActive: false,
        },
        503,
      ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_paperclip");
});

test("preflight uses fixed same-origin probe paths and manual redirects", async () => {
  const calls = [];
  const responses = [
    jsonResponse(
      {
        status: "ok",
        deploymentMode: "authenticated",
        bootstrapStatus: "ready",
        bootstrapInviteActive: false,
      },
      200,
    ),
    authRequiredResponse(),
  ];

  const result = await preflightRemoteConnection({
    remoteUrl: "https://paperclip-host.tailnet.ts.net/user/input?next=https://evil.test#fragment",
    fetchImpl: async (input, init) => {
      calls.push({ url: input.toString(), redirect: init?.redirect });
      return responses.shift();
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      url: "https://paperclip-host.tailnet.ts.net/api/health",
      redirect: "manual",
    },
    {
      url: "https://paperclip-host.tailnet.ts.net/api/auth/get-session",
      redirect: "manual",
    },
  ]);
});

test("preflight classifies TLS failures", async () => {
  const result = await preflightRemoteConnection({
    remoteUrl: "https://badcert.example.com",
    fetchImpl: async () => {
      throw new Error("self-signed certificate");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.insecureTransport, false);
  assert.equal(result.reason, "tls_error");
});

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authRequiredResponse() {
  return jsonResponse({ error: "Board authentication required" }, 401);
}
