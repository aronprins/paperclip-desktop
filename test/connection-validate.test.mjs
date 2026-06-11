import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeRemoteUrl, isPrivateHostname } = require("../dist/connection/validate.js");

test("normalizeRemoteUrl strips path and preserves https origin", () => {
  const normalized = normalizeRemoteUrl("https://paperclip.example.com/app/dashboard?x=1#top");
  assert.equal(normalized.normalizedUrl, "https://paperclip.example.com/");
  assert.equal(normalized.origin, "https://paperclip.example.com");
  assert.equal(normalized.insecureTransport, false);
  assert.equal(normalized.warning, undefined);
});

test("normalizeRemoteUrl allows http remotes and attaches an insecurity warning", () => {
  const tenNet = normalizeRemoteUrl("http://10.0.1.25:3100");
  assert.equal(tenNet.normalizedUrl, "http://10.0.1.25:3100/");
  assert.equal(tenNet.origin, "http://10.0.1.25:3100");
  assert.equal(tenNet.insecureTransport, true);
  assert.match(tenNet.warning, /without TLS/i);

  const ipAddress = normalizeRemoteUrl("http://192.168.1.50:3100/dashboard");
  assert.equal(ipAddress.normalizedUrl, "http://192.168.1.50:3100/");
  assert.equal(ipAddress.origin, "http://192.168.1.50:3100");

  const tailscaleIp = normalizeRemoteUrl("http://100.100.100.100:3200");
  assert.equal(tailscaleIp.normalizedUrl, "http://100.100.100.100:3200/");
  assert.equal(tailscaleIp.origin, "http://100.100.100.100:3200");

  const tailnet = normalizeRemoteUrl("http://paperclip-host.tailnet.ts.net");
  assert.equal(tailnet.normalizedUrl, "http://paperclip-host.tailnet.ts.net/");
  assert.equal(tailnet.origin, "http://paperclip-host.tailnet.ts.net");
  assert.match(tailnet.warning, /trust the local or private network/i);

  const publicHost = normalizeRemoteUrl("http://paperclip.example.com");
  assert.equal(publicHost.normalizedUrl, "http://paperclip.example.com/");
  assert.match(publicHost.warning, /risk is higher/i);
});

test("normalizeRemoteUrl rejects embedded credentials", () => {
  assert.throws(
    () => normalizeRemoteUrl("https://user:pass@paperclip.example.com"),
    /cannot include username or password/i,
  );
});

test("isPrivateHostname recognises tailnet and RFC1918 hosts", () => {
  assert.equal(isPrivateHostname("paperclip-host.tailnet.ts.net"), true);
  assert.equal(isPrivateHostname("10.0.1.25"), true);
  assert.equal(isPrivateHostname("192.168.1.50"), true);
  assert.equal(isPrivateHostname("100.100.100.100"), true);
  assert.equal(isPrivateHostname("[::1]"), true);
  assert.equal(isPrivateHostname("[fd00::1]"), true);
  assert.equal(isPrivateHostname("paperclip.example.com"), false);
});

test("isPrivateHostname does not misclassify public hosts starting with fc/fd (PD-043)", () => {
  assert.equal(isPrivateHostname("fcbarcelona.com"), false);
  assert.equal(isPrivateHostname("fd-host.example.com"), false);
});

test("isPrivateHostname covers 0.0.0.0, link-local, and IPv4-mapped IPv6 (PD-044)", () => {
  assert.equal(isPrivateHostname("0.0.0.0"), true);
  assert.equal(isPrivateHostname("[fe80::1]"), true);
  assert.equal(isPrivateHostname("[::ffff:192.168.1.50]"), true);
  assert.equal(isPrivateHostname("[::ffff:8.8.8.8]"), false);
});
