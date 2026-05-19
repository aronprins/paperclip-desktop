#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const appPath = takeOption("--app");
const timeoutMs = Number.parseInt(takeOption("--timeout-ms") || "90000", 10);
const keepData = hasFlag("--keep-data");
const localNetworkMode = hasFlag("--local-network");

if (!appPath) {
  fail("Missing --app /path/to/Paperclip Desktop.app or packaged executable.");
}

const executablePath = resolveExecutable(appPath);
if (!existsSync(executablePath)) {
  fail(`Packaged executable does not exist: ${executablePath}`);
}

if (localNetworkMode && findHostPrivateIpv4Addresses().length === 0) {
  fail("Local network smoke test requires an active RFC1918 IPv4 address.");
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "paperclip-packaged-smoke-"));
const userDataDir = path.join(tempRoot, "user-data");
const paperclipHome = path.join(tempRoot, "paperclip-home");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(paperclipHome, { recursive: true });
seedLocalAutoStart(userDataDir, { localNetworkMode });

const outputChunks = [];
let child = null;
let settled = false;

try {
  const result = await runSmokeTest();
  console.log(`[smoke-macos] Packaged app started local server on ${result.url}`);
  if (result.localNetworkUrl) {
    console.log(`[smoke-macos] Packaged app exposed LAN server on ${result.localNetworkUrl}`);
  }
  console.log(`[smoke-macos] Isolated userData: ${userDataDir}`);
  console.log(`[smoke-macos] Isolated PAPERCLIP_HOME: ${paperclipHome}`);
} finally {
  await stopChild();
  if (!keepData) {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`[smoke-macos] Kept smoke-test data: ${tempRoot}`);
  }
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function hasFlag(name) {
  return args.includes(name);
}

function resolveExecutable(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!resolved.endsWith(".app")) {
    return resolved;
  }

  const macosDir = path.join(resolved, "Contents", "MacOS");
  const entries = readdirSync(macosDir).filter((entry) => !entry.startsWith("."));
  if (entries.length !== 1) {
    fail(`Expected exactly one executable under ${macosDir}.`);
  }
  return path.join(macosDir, entries[0]);
}

function seedLocalAutoStart(targetUserDataDir, options = {}) {
  const connectionsFile = {
    version: 1,
    state: {
      activeProfileId: "local_embedded",
      alwaysShowChooser: false,
      autoConnectLastProfile: true,
      chooserMode: "local_embedded",
      localNetworkEnabled: options.localNetworkMode === true,
      localProfileName: options.localNetworkMode === true ? "Local Network" : "Local",
      localLastHealth: "healthy",
    },
    remoteProfiles: [],
  };

  writeFileSync(
    path.join(targetUserDataDir, "connections.json"),
    `${JSON.stringify(connectionsFile, null, 2)}\n`,
    "utf8",
  );
}

function runSmokeTest() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for packaged server startup.\n${tailOutput()}`));
    }, timeoutMs);

    child = spawn(executablePath, [], {
      env: {
        ...process.env,
        PAPERCLIP_DESKTOP_REQUIRE_ISOLATED_DATA: "1",
        PAPERCLIP_DESKTOP_USER_DATA_DIR: userDataDir,
        PAPERCLIP_HOME: paperclipHome,
        ...(localNetworkMode
          ? {
              PAPERCLIP_AUTH_PUBLIC_BASE_URL: "https://paperclip.example.com",
              PAPERCLIP_ALLOWED_HOSTNAMES: "paperclip.example.com",
              BETTER_AUTH_TRUSTED_ORIGINS: "https://paperclip.example.com",
            }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      handleOutput(chunk, resolve, reject, timeout);
    });
    child.stderr.on("data", (chunk) => {
      handleOutput(chunk, resolve, reject, timeout);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      reject(new Error(`Packaged app exited before server startup (code=${code}, signal=${signal}).\n${tailOutput()}`));
    });
  });
}

function handleOutput(chunk, resolve, reject, timeout) {
  const text = chunk.toString();
  outputChunks.push(text);
  const output = outputChunks.join("");

  const productionPath = findProductionPathLeak(output);
  if (productionPath) {
    clearTimeout(timeout);
    reject(new Error(`Packaged smoke test touched or logged production data path: ${productionPath}\n${tailOutput()}`));
    return;
  }

  const localNetworkUrl = findLocalNetworkUrl(output);
  if (localNetworkMode && localNetworkUrl) {
    const validationError = validateLocalNetworkUrl(localNetworkUrl);
    if (validationError) {
      clearTimeout(timeout);
      reject(new Error(`${validationError}\n${tailOutput()}`));
      return;
    }
  }

  const match = output.match(/Server listening on\s+(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/);
  if (!match || settled) {
    return;
  }

  settled = true;
  const port = Number.parseInt(match[1], 10);
  const url = `http://127.0.0.1:${port}`;
  void validateStartedServer({ url, localNetworkUrl })
    .then(() => {
      clearTimeout(timeout);
      resolve({ url, localNetworkUrl });
    })
    .catch((error) => {
      clearTimeout(timeout);
      reject(new Error(`Server started but smoke endpoint failed: ${error.message}\n${tailOutput()}`));
    });
}

async function validateStartedServer({ url, localNetworkUrl }) {
  if (localNetworkMode && !localNetworkUrl) {
    throw new Error("Local network mode was requested but no LAN URL was advertised.");
  }

  await requestOk(`${url}/get-session`);

  if (localNetworkMode) {
    await requestOk(`${localNetworkUrl}/get-session`);
    const secret = readLocalNetworkSecret();
    if (!secret || secret.length < 32) {
      throw new Error("Local network auth secret was not created or is too weak.");
    }
    if (outputIncludes(secret)) {
      throw new Error("Local network auth secret was written to app output.");
    }
  }
}

function findLocalNetworkUrl(output) {
  const match = output.match(/Local network access enabled at\s+(http:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

function validateLocalNetworkUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return `Local network URL is invalid: ${rawUrl}`;
  }

  if (parsed.protocol !== "http:") {
    return `Local network URL must use HTTP for same-LAN access, got: ${rawUrl}`;
  }

  if (parsed.hostname === "0.0.0.0" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    return `Local network URL must advertise a concrete LAN address, got: ${rawUrl}`;
  }

  if (!isPrivateIpv4Address(parsed.hostname)) {
    return `Local network URL must advertise an RFC1918 IPv4 address, got: ${rawUrl}`;
  }

  if (!findHostPrivateIpv4Addresses().includes(parsed.hostname)) {
    return `Local network URL ${rawUrl} is not one of this host's active private IPv4 addresses.`;
  }

  return null;
}

function isPrivateIpv4Address(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function findHostPrivateIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.internal && entry.family === "IPv4" && isPrivateIpv4Address(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return Array.from(new Set(addresses));
}

function readLocalNetworkSecret() {
  try {
    return readFileSync(path.join(userDataDir, "paperclip-lan-auth-secret"), "utf8").trim();
  } catch {
    return null;
  }
}

function outputIncludes(value) {
  return value.length > 0 && outputChunks.join("").includes(value);
}

function findProductionPathLeak(output) {
  for (const candidate of productionPaperclipDataPaths()) {
    if (output.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function productionPaperclipDataPaths() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Paperclip"),
      path.join(home, ".paperclip"),
    ];
  }
  return [path.join(home, ".paperclip")];
}

function requestOk(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 10_000 }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`${url} returned HTTP ${response.statusCode}`));
      }
    });
    request.on("timeout", () => {
      request.destroy(new Error(`${url} timed out`));
    });
    request.on("error", reject);
  });
}

async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

function tailOutput() {
  return outputChunks.join("").split(/\r?\n/).slice(-80).join("\n");
}

function fail(message) {
  console.error(`[smoke-macos] ${message}`);
  process.exit(1);
}
