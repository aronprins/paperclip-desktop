import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  bindHostForLocalExposure,
  bindHostsForLocalExposure,
  findFreePortForLocalExposure,
  findFreePortForHost,
  isPortAvailableForLocalExposure,
  isPortAvailableForHost,
} = require("../dist/connection/local-port-selection.js");

test("local port selection maps exposure mode to the bind host", () => {
  assert.equal(bindHostForLocalExposure(false), "127.0.0.1");
  assert.equal(bindHostForLocalExposure(true), "0.0.0.0");
  assert.deepEqual(bindHostsForLocalExposure(false), ["127.0.0.1", "0.0.0.0"]);
  assert.deepEqual(bindHostsForLocalExposure(true), ["0.0.0.0", "127.0.0.1"]);
});

test("local port selection checks availability on the requested bind host", async () => {
  const occupied = await listenOnRandomPort("0.0.0.0");
  try {
    assert.equal(await isPortAvailableForHost(occupied.port, "0.0.0.0"), false);
  } finally {
    await closeServer(occupied.server);
  }
});

test("local port selection skips occupied ports", async () => {
  const occupied = await listenOnRandomPort("127.0.0.1");
  try {
    const selected = await findFreePortForHost(occupied.port, "127.0.0.1", 2);
    assert.equal(selected, occupied.port + 1);
  } finally {
    await closeServer(occupied.server);
  }
});

test("local network port selection skips ports occupied on localhost", async () => {
  const occupied = await listenOnRandomPort("127.0.0.1");
  try {
    assert.equal(await isPortAvailableForLocalExposure(occupied.port, true), false);

    const selected = await findFreePortForLocalExposure(occupied.port, true, 2);
    assert.equal(selected, occupied.port + 1);
  } finally {
    await closeServer(occupied.server);
  }
});

test("private local port selection skips ports occupied on all interfaces", async () => {
  const occupied = await listenOnRandomPort("0.0.0.0");
  try {
    assert.equal(await isPortAvailableForLocalExposure(occupied.port, false), false);

    const selected = await findFreePortForLocalExposure(occupied.port, false, 2);
    assert.equal(selected, occupied.port + 1);
  } finally {
    await closeServer(occupied.server);
  }
});

function listenOnRandomPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port: 0, host }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address."));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
