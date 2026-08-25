#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const appPath = takeOption("--app");
const timeoutMs = Number.parseInt(takeOption("--timeout-ms") || "90000", 10);
const keepData = hasFlag("--keep-data");

if (!appPath) {
  fail("Missing --app /path/to/Paperclip Desktop.app or packaged executable.");
}

const executablePath = resolveExecutable(appPath);
if (!existsSync(executablePath)) {
  fail(`Packaged executable does not exist: ${executablePath}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "paperclip-packaged-smoke-"));
const userDataDir = path.join(tempRoot, "user-data");
const paperclipHome = path.join(tempRoot, "paperclip-home");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(paperclipHome, { recursive: true });
seedLocalAutoStart(userDataDir);

const outputChunks = [];
let child = null;
let settled = false;

try {
  const result = await runSmokeTest();
  console.log(`[smoke-macos] Packaged app started local server on ${result.url}`);
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

function seedLocalAutoStart(targetUserDataDir) {
  const connectionsFile = {
    version: 1,
    state: {
      activeProfileId: "local_embedded",
      alwaysShowChooser: false,
      autoConnectLastProfile: true,
      chooserMode: "local_embedded",
      localProfileName: "Local",
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

  const match = output.match(/Server listening on\s+(?:127\.0\.0\.1|localhost):(\d+)/);
  if (!match || settled) {
    return;
  }

  settled = true;
  const port = Number.parseInt(match[1], 10);
  const url = `http://127.0.0.1:${port}`;
  void verifyServerEndpoints(url)
    .then(() => {
      clearTimeout(timeout);
      resolve({ url });
    })
    .catch((error) => {
      clearTimeout(timeout);
      reject(new Error(`Server started but smoke endpoint failed: ${error.message}\n${tailOutput()}`));
    });
}

async function verifyServerEndpoints(url) {
  await requestOk(`${url}/get-session`);
  await requestNonEmptyJsonArray(`${url}/api/skills/catalog`);
  await requestNonEmptyJsonArray(`${url}/api/teams/catalog`);
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

function requestNonEmptyJsonArray(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 10_000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} returned HTTP ${response.statusCode}`));
          return;
        }

        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(payload) || payload.length === 0) {
            reject(new Error(`${url} did not return a non-empty JSON array`));
            return;
          }
          resolve();
        } catch (error) {
          reject(new Error(`${url} returned invalid JSON: ${error.message}`));
        }
      });
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
