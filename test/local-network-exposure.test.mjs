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
    en1: [{ address: "169.254.1.10", family: "IPv4", internal: false }],
    utun: [{ address: "fd00::1", family: "IPv6", internal: false }],
  });

  assert.deepEqual(addresses, ["192.168.1.23"]);
});

test("local network exposure config enables authenticated LAN mode", () => {
  const config = buildLocalNetworkExposureConfig({
    port: 3100,
    authSecret: "generated-secret",
    hostname: "Paperclip-Host.local",
    baseEnv: {
      PAPERCLIP_ALLOWED_HOSTNAMES: "paperclip.local",
    },
    interfaces: {
      en0: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    },
  });

  assert.equal(config.primaryUrl, "http://192.168.1.23:3100");
  assert.equal(config.env.PAPERCLIP_DEPLOYMENT_MODE, "authenticated");
  assert.equal(config.env.PAPERCLIP_DEPLOYMENT_EXPOSURE, "private");
  assert.equal(config.env.PAPERCLIP_BIND, "lan");
  assert.equal(config.env.BETTER_AUTH_SECRET, "generated-secret");
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /192\.168\.1\.23/);
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /paperclip-host\.local/);
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /paperclip\.local/);
  assert.match(config.env.PAPERCLIP_ALLOWED_HOSTNAMES, /localhost/);
});

test("local network exposure respects existing public auth URL and auth secret", () => {
  const config = buildLocalNetworkExposureConfig({
    port: 3100,
    authSecret: "generated-secret",
    baseEnv: {
      PAPERCLIP_AUTH_PUBLIC_BASE_URL: "http://paperclip.lan:3200",
      BETTER_AUTH_SECRET: "existing-secret",
    },
    interfaces: {
      en0: [{ address: "10.0.0.15", family: "IPv4", internal: false }],
    },
  });

  assert.equal(config.primaryUrl, "http://paperclip.lan:3200");
  assert.equal(config.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL, "http://paperclip.lan:3200");
  assert.equal(config.env.BETTER_AUTH_SECRET, "existing-secret");
});

test("local network auth secret is stable once written", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-lan-secret-"));

  const first = readOrCreateLocalNetworkAuthSecret(tempDir);
  const second = readOrCreateLocalNetworkAuthSecret(tempDir);

  assert.equal(first, second);
  assert.ok(first.length >= 32);
});
