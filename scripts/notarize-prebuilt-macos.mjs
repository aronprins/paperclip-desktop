#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const PRODUCT_NAME = "Paperclip Desktop";
const args = process.argv.slice(2);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function hasFlag(name) {
  return args.includes(name);
}

function assertRepoContainedOutput(targetPath, optionName) {
  const relativePath = relative(projectRoot, targetPath);
  const insideProject = relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  if (!insideProject && !hasFlag("--allow-external-output")) {
    throw new Error(
      `${optionName} must resolve inside the project directory. ` +
      "Pass --allow-external-output to intentionally write elsewhere.",
    );
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;

    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      out.push(full);
      walk(full, out);
    }
  }

  return out;
}

function findAppBundle(rootDir, arch) {
  const appBundleName = `${PRODUCT_NAME}.app`;
  const candidates = [
    join(rootDir, arch, arch === "arm64" ? "mac-arm64" : "mac", appBundleName),
    join(rootDir, "local-macos", arch, arch === "arm64" ? "mac-arm64" : "mac", appBundleName),
    join(rootDir, "release", "local-macos", arch, arch === "arm64" ? "mac-arm64" : "mac", appBundleName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const discovered = walk(rootDir).find((entry) =>
    entry.endsWith(arch === "arm64" ? `/mac-arm64/${appBundleName}` : `/mac/${appBundleName}`)
      && entry.includes(`/${arch}/`),
  );

  if (discovered) {
    return discovered;
  }

  throw new Error(`Unable to find the prebuilt ${arch} app bundle under ${rootDir}.`);
}

function notarizeApp(appPath, logDir) {
  const stagingDir = mkdtempSync(join(tmpdir(), "paperclip-notary-prebuilt-"));
  const archivePath = join(stagingDir, `${basename(appPath, ".app")}.zip`);
  const submitLogPath = join(logDir, `${basename(appPath, ".app")}.submit.json`);

  try {
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath], {
      stdio: "inherit",
    });

    const submitOutput = execFileSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        archivePath,
        "--key",
        requireEnv("APPLE_API_KEY"),
        "--key-id",
        requireEnv("APPLE_API_KEY_ID"),
        "--issuer",
        requireEnv("APPLE_API_ISSUER"),
        "--wait",
        "--output-format",
        "json",
      ],
      { encoding: "utf8" },
    );

    writeFileSync(submitLogPath, submitOutput.endsWith("\n") ? submitOutput : `${submitOutput}\n`, "utf8");

    const result = JSON.parse(submitOutput);
    const status = result.status || result.statusSummary || "unknown";
    if (status !== "Accepted") {
      throw new Error(`Apple notarization failed for ${appPath}: ${status}`);
    }

    execFileSync("xcrun", ["stapler", "staple", "-v", appPath], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "validate", "-v", appPath], { stdio: "inherit" });
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function repackageApp(appPath, arch, outputDir) {
  run("node", [
    "scripts/repackage-prebuilt-macos.mjs",
    "--app",
    appPath,
    "--arch",
    arch,
    "--output-dir",
    outputDir,
  ]);
}

function verifyOutput(outputDir) {
  run("node", [
    "scripts/verify-macos-release.mjs",
    outputDir,
    "--require-stapled",
  ]);
}

function main() {
  const inputRoot = resolve(projectRoot, takeOption("--input-root") || "release/local-macos");
  const outputRoot = resolve(projectRoot, takeOption("--output-root") || "release/notarized-macos");
  assertRepoContainedOutput(outputRoot, "--output-root");
  const skipNotarize = hasFlag("--skip-notarize");
  const archs = takeOption("--arch") ? [takeOption("--arch")] : ["x64", "arm64"];

  mkdirSync(outputRoot, { recursive: true });

  for (const arch of archs) {
    if (!["x64", "arm64"].includes(arch)) {
      throw new Error(`Unsupported arch '${arch}'. Expected x64 or arm64.`);
    }

    const appPath = findAppBundle(inputRoot, arch);
    const archOutputDir = join(outputRoot, arch);
    const logDir = join(archOutputDir, "notarization");

    rmSync(archOutputDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });

    if (!skipNotarize) {
      notarizeApp(appPath, logDir);
    }

    repackageApp(appPath, arch, archOutputDir);
    verifyOutput(archOutputDir);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
