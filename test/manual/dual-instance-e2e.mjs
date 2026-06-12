#!/usr/bin/env node
// End-to-end check for the single-instance lock: launch the packaged app
// twice against the same isolated userData/PAPERCLIP_HOME and assert the
// second launch exits without booting another embedded server.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const appArg = process.argv[2];
if (!appArg) {
  console.error("usage: dual-instance-e2e.mjs <path-to-.app>");
  process.exit(2);
}

const macosDir = path.join(path.resolve(appArg), "Contents", "MacOS");
const executable = path.join(macosDir, readdirSync(macosDir).filter((e) => !e.startsWith("."))[0]);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "paperclip-dual-instance-"));
const userDataDir = path.join(tempRoot, "user-data");
const paperclipHome = path.join(tempRoot, "paperclip-home");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(paperclipHome, { recursive: true });

writeFileSync(
  path.join(userDataDir, "connections.json"),
  JSON.stringify({
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
  }, null, 2),
  "utf8",
);

const env = {
  ...process.env,
  PAPERCLIP_DESKTOP_REQUIRE_ISOLATED_DATA: "1",
  PAPERCLIP_DESKTOP_USER_DATA_DIR: userDataDir,
  PAPERCLIP_HOME: paperclipHome,
};

function launch(label) {
  const child = spawn(executable, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.output = "";
  const collect = (chunk) => {
    child.output += chunk.toString();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("exit", (code, signal) => {
    child.exited = { code, signal };
    console.log(`[dual-e2e] ${label} exited (code=${code}, signal=${signal})`);
  });
  return child;
}

const waitFor = (pred, timeoutMs, what) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 250);
    };
    tick();
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let first;
let second;
let failed = false;

try {
  console.log("[dual-e2e] launching first instance...");
  first = launch("first");
  await waitFor(() => /Server listening on/.test(first.output), 120_000, "first instance server");
  console.log("[dual-e2e] first instance server is up");

  console.log("[dual-e2e] launching second instance...");
  second = launch("second");

  // The second instance should give up the single-instance lock and exit.
  await waitFor(() => second.exited, 30_000, "second instance to exit");

  await sleep(3_000);
  const secondBootedServer = /Server listening on|Using PAPERCLIP_HOME/.test(second.output);
  const firstStillAlive = first.exitCode === null && !first.exited;

  if (secondBootedServer) {
    console.error("[dual-e2e] FAIL: second instance attempted to boot a server:\n" + second.output.slice(-2000));
    failed = true;
  } else if (!firstStillAlive) {
    console.error("[dual-e2e] FAIL: first instance died after second launch");
    failed = true;
  } else {
    console.log("[dual-e2e] PASS: second instance exited without starting a server; first instance unaffected");
  }
} catch (error) {
  console.error(`[dual-e2e] FAIL: ${error.message}`);
  if (first) console.error("--- first output tail ---\n" + first.output.slice(-2000));
  if (second) console.error("--- second output tail ---\n" + second.output.slice(-2000));
  failed = true;
} finally {
  for (const child of [second, first]) {
    if (child && child.exitCode === null && !child.exited) {
      child.kill("SIGTERM");
    }
  }
  await sleep(4_000);
  rmSync(tempRoot, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
