import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildLocalNetworkExposureConfig,
  listLocalNetworkIpv4Addresses,
  readOrCreateLocalNetworkAuthSecret,
} = require("../dist/connection/local-network-exposure.js");

test("local network address detection keeps only usable external IPv4 addresses", () => {
  const addresses = listLocalNetworkIpv4Addresses({
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    en3: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    en2: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    en1: [{ address: "169.254.1.10", family: "IPv4", internal: false }],
    cgnat: [{ address: "100.64.1.10", family: "IPv4", internal: false }],
    utun: [{ address: "fd00::1", family: "IPv6", internal: false }],
  });

  assert.deepEqual(addresses, ["192.168.1.23"]);
});

test("local network address detection accepts RFC1918 ranges only", () => {
  const addresses = listLocalNetworkIpv4Addresses({
    ten: [{ address: "10.0.0.9", family: "IPv4", internal: false }],
    "172low": [{ address: "172.15.255.255", family: "IPv4", internal: false }],
    "172start": [{ address: "172.16.0.1", family: "IPv4", internal: false }],
    "172end": [{ address: "172.31.255.254", family: "IPv4", internal: false }],
    "172high": [{ address: "172.32.0.1", family: "IPv4", internal: false }],
    lan: [{ address: "192.168.0.5", family: "IPv4", internal: false }],
  });

  assert.deepEqual(addresses, ["10.0.0.9", "172.16.0.1", "172.31.255.254", "192.168.0.5"]);
});

test("local network exposure config enables authenticated LAN mode", () => {
  const config = buildLocalNetworkExposureConfig({
    port: 3100,
    authSecret: "generated-secret-with-enough-entropy",
    hostname: "Paperclip-Host.local",
    interfaces: {
      en0: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    },
  });

  assert.equal(config.primaryUrl, "http://192.168.1.23:3100");
  assert.equal(config.env.PAPERCLIP_DEPLOYMENT_MODE, "authenticated");
  assert.equal(config.env.PAPERCLIP_DEPLOYMENT_EXPOSURE, "private");
  assert.equal(config.env.PAPERCLIP_BIND, "lan");
  assert.equal(config.env.BETTER_AUTH_SECRET, "generated-secret-with-enough-entropy");
  assert.equal(config.env.PAPERCLIP_AUTH_BASE_URL_MODE, "explicit");
  assert.equal(config.env.PAPERCLIP_PUBLIC_URL, "http://192.168.1.23:3100");
  assert.equal(config.env.BETTER_AUTH_URL, "http://192.168.1.23:3100");
  assert.equal(config.env.BETTER_AUTH_BASE_URL, "http://192.168.1.23:3100");
  assert.equal(config.env.BETTER_AUTH_TRUSTED_ORIGINS, "");
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /192\.168\.1\.23/);
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /paperclip-host\.local/);
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /localhost/);
});

test("local network exposure excludes public-looking hostnames from allow-list", () => {
  const config = buildLocalNetworkExposureConfig({
    port: 3100,
    authSecret: "generated-secret-with-enough-entropy",
    hostname: "paperclip.example.com",
    interfaces: {
      en0: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    },
  });

  assert.doesNotMatch(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /paperclip\.example\.com/);
});

test("local network exposure ignores ambient public URL and host allow-list env", () => {
  const previousPublicUrl = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
  const previousAllowedHostnames = process.env.PAPERCLIP_ALLOWED_HOSTNAMES;
  const previousTrustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL = "https://paperclip.example.com";
  process.env.PAPERCLIP_ALLOWED_HOSTNAMES = "paperclip.example.com";
  process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://paperclip.example.com";

  try {
    const config = buildLocalNetworkExposureConfig({
      port: 3100,
      authSecret: "generated-secret-with-enough-entropy",
      interfaces: {
        en0: [{ address: "10.0.0.15", family: "IPv4", internal: false }],
      },
    });

    assert.equal(config.primaryUrl, "http://10.0.0.15:3100");
    assert.equal(config.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL, "http://10.0.0.15:3100");
    assert.equal(config.env.BETTER_AUTH_SECRET, "generated-secret-with-enough-entropy");
    assert.equal(config.env.BETTER_AUTH_TRUSTED_ORIGINS, "");
    assert.doesNotMatch(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /paperclip\.example\.com/);
    assert.deepEqual(
      Object.entries(config.env)
        .filter(([, value]) => value.includes("paperclip.example.com"))
        .map(([key]) => key),
      [],
    );
  } finally {
    if (previousPublicUrl === undefined) {
      delete process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
    } else {
      process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL = previousPublicUrl;
    }
    if (previousAllowedHostnames === undefined) {
      delete process.env.PAPERCLIP_ALLOWED_HOSTNAMES;
    } else {
      process.env.PAPERCLIP_ALLOWED_HOSTNAMES = previousAllowedHostnames;
    }
    if (previousTrustedOrigins === undefined) {
      delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    } else {
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = previousTrustedOrigins;
    }
  }
});

test("local network exposure rejects missing private addresses", () => {
  assert.throws(
    () => buildLocalNetworkExposureConfig({
      port: 3100,
      authSecret: "generated-secret-with-enough-entropy",
      interfaces: {
        en0: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
      },
    }),
    /No active IPv4 local network address/,
  );
});

test("local network exposure rejects weak auth secrets", () => {
  assert.throws(
    () => buildLocalNetworkExposureConfig({
      port: 3100,
      authSecret: "too-short",
      interfaces: {
        en0: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
      },
    }),
    /requires an auth secret/,
  );
});

test("local network auth secret is stable once written", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-lan-secret-"));

  const first = readOrCreateLocalNetworkAuthSecret(tempDir);
  const second = readOrCreateLocalNetworkAuthSecret(tempDir);

  assert.equal(first, second);
  assert.ok(first.length >= 32);
});

test("local network auth secret replaces weak existing values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-lan-weak-secret-"));
  fs.writeFileSync(path.join(tempDir, "paperclip-lan-auth-secret"), "weak\n", "utf8");

  const secret = readOrCreateLocalNetworkAuthSecret(tempDir);

  assert.notEqual(secret, "weak");
  assert.ok(secret.length >= 32);
});
