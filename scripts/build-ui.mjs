#!/usr/bin/env node

/**
 * Builds the Paperclip UI from the upstream repo source.
 *
 * Since @paperclipai/ui is not published to npm, this script clones the
 * upstream repo at the matching version tag, builds the UI, and copies
 * the output into the server bundle.
 *
 * When @paperclipai/ui is eventually published to npm, this script can
 * be simplified to just copy from node_modules.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const bundleRootDir = path.join(projectRoot, "build", "server-bundle");
const cloneDir = path.join(projectRoot, "build", "upstream-clone");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function getBundleUiDistDirs() {
  if (!existsSync(bundleRootDir)) return [];
  return readdirSync(bundleRootDir)
    .map((variant) => path.join(bundleRootDir, variant, "server", "ui-dist"))
    .filter((dir) => existsSync(path.dirname(dir)));
}

function copyUiDistToBundles(uiDist) {
  for (const bundleUiDist of getBundleUiDistDirs()) {
    mkdirSync(bundleUiDist, { recursive: true });
    cpSync(uiDist, bundleUiDist, { recursive: true });
  }
}

// ── Check if UI is already built ────────────────────────────────────────────

const bundleUiDistDirs = getBundleUiDistDirs();
if (
  bundleUiDistDirs.length > 0 &&
  bundleUiDistDirs.every((dir) => existsSync(path.join(dir, "index.html")))
) {
  console.log("[build-ui] UI already present in server bundle, skipping.");
  process.exit(0);
}

// ── Read the target server version ──────────────────────────────────────────

const projectPkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const serverVersion = projectPkg.devDependencies["@paperclipai/server"];
if (!serverVersion) {
  console.error("[build-ui] @paperclipai/server not found in devDependencies");
  process.exit(1);
}

// ── Try to install @paperclipai/ui from npm first (future-proofing) ─────────

try {
  const uiVersion = execFileSync(npmCommand, ["view", `@paperclipai/ui@${serverVersion}`, "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  }).trim();

  if (uiVersion) {
    console.log(`[build-ui] Found @paperclipai/ui@${uiVersion} on npm, installing...`);
    const uiStagingDir = path.join(projectRoot, "build", "ui-staging");
    if (existsSync(uiStagingDir)) rmSync(uiStagingDir, { recursive: true, force: true });
    mkdirSync(uiStagingDir, { recursive: true });
    execFileSync(npmCommand, ["pack", `@paperclipai/ui@${uiVersion}`, "--pack-destination", uiStagingDir], { stdio: "inherit" });
    // Extract and copy dist/
    const tarballs = readdirSync(uiStagingDir)
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => path.join(uiStagingDir, entry));
    if (tarballs[0]) {
      execFileSync("tar", ["-xzf", tarballs[0], "-C", uiStagingDir], { stdio: "inherit" });
      const uiDist = path.join(uiStagingDir, "package", "dist");
      if (existsSync(path.join(uiDist, "index.html"))) {
        copyUiDistToBundles(uiDist);
        rmSync(uiStagingDir, { recursive: true, force: true });
        console.log("[build-ui] UI installed from npm. Done.");
        process.exit(0);
      }
    }
    rmSync(uiStagingDir, { recursive: true, force: true });
    console.log("[build-ui] npm package didn't contain usable UI dist, falling back to clone.");
  }
} catch {
  // @paperclipai/ui not on npm yet — expected, fall through to clone approach
}

// ── Clone upstream and build UI ─────────────────────────────────────────────

// Upstream tags use v{version} format (e.g. v2026.325.0)
const tagCandidates = [`v${serverVersion}`, serverVersion];

if (existsSync(cloneDir)) {
  rmSync(cloneDir, { recursive: true, force: true });
}

let cloneSuccess = false;
for (const tag of tagCandidates) {
  try {
    console.log(`[build-ui] Cloning upstream at tag ${tag}...`);
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--branch", tag, "https://github.com/paperclipai/paperclip.git", cloneDir],
      { stdio: "inherit", timeout: 120000 },
    );
    cloneSuccess = true;
    break;
  } catch {
    console.log(`[build-ui] Tag ${tag} not found, trying next...`);
    if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true });
  }
}

if (!cloneSuccess) {
  console.error(`[build-ui] ERROR: Could not clone upstream repo at any tag: ${tagCandidates.join(", ")}`);
  process.exit(1);
}

// ── Install dependencies and build UI ───────────────────────────────────────

console.log("[build-ui] Installing upstream dependencies...");
execFileSync(pnpmCommand, ["install", "--frozen-lockfile"], { cwd: cloneDir, stdio: "inherit", timeout: 300000 });

console.log("[build-ui] Building UI...");
execFileSync(pnpmCommand, ["--filter", "@paperclipai/ui", "build"], { cwd: cloneDir, stdio: "inherit", timeout: 300000 });

// ── Copy UI dist to server bundle ───────────────────────────────────────────

const uiDist = path.join(cloneDir, "ui", "dist");
if (!existsSync(path.join(uiDist, "index.html"))) {
  console.error("[build-ui] ERROR: UI build did not produce dist/index.html");
  process.exit(1);
}

copyUiDistToBundles(uiDist);

// ── Cleanup ─────────────────────────────────────────────────────────────────

console.log("[build-ui] Cleaning up upstream clone...");
rmSync(cloneDir, { recursive: true, force: true });

console.log("[build-ui] Done.");
