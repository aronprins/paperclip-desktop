#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");

const PRODUCT_NAME = "Paperclip Desktop";
const APP_ID = "com.paperclipai.app";
const COPYRIGHT = "Copyright © 2026 Aron Prins";
const OWNER = "aronprins";
const REPO = "paperclip-desktop";
const args = process.argv.slice(2);

function readInstalledPackageVersion(name) {
  const installed = JSON.parse(
    readFileSync(join(projectRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"),
  );
  if (typeof installed.version !== "string" || !installed.version) {
    throw new Error(`Could not read installed version for ${name}.`);
  }
  return installed.version;
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function requireOption(name) {
  const value = takeOption(name);
  if (!value) {
    throw new Error(`Missing required option ${name}.`);
  }
  return value;
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

function buildConfig(arch, outputDir) {
  return {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    copyright: COPYRIGHT,
    directories: {
      output: outputDir,
      buildResources: "build",
    },
    publish: {
      provider: "github",
      owner: OWNER,
      repo: REPO,
      releaseType: "release",
    },
    mac: {
      category: "public.app-category.developer-tools",
      icon: "build/icon.png",
      target: [
        {
          target: "dmg",
          arch: [arch],
        },
        {
          target: "zip",
          arch: [arch],
        },
      ],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: false,
    },
    dmg: {
      contents: [
        { x: 130, y: 220 },
        { x: 410, y: 220, type: "link", path: "/Applications" },
      ],
    },
    electronVersion: readInstalledPackageVersion("electron"),
  };
}

function main() {
  const appPath = resolve(projectRoot, requireOption("--app"));
  const arch = requireOption("--arch");
  const outputDir = resolve(projectRoot, requireOption("--output-dir"));

  if (!["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported arch '${arch}'. Expected x64 or arm64.`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "paperclip-prepackaged-"));
  const configPath = join(tempDir, "electron-builder.prepackaged.json");

  try {
    writeFileSync(configPath, `${JSON.stringify(buildConfig(arch, outputDir), null, 2)}\n`, "utf8");

    run("pnpm", [
      "exec",
      "electron-builder",
      "--projectDir",
      projectRoot,
      "--config",
      configPath,
      "--prepackaged",
      appPath,
      "--mac",
      `--${arch}`,
      "--publish",
      "never",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
