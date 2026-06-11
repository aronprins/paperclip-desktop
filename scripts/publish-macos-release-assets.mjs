#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function hasFlag(name) {
  return args.includes(name);
}

function requireOption(name) {
  const value = takeOption(name);
  if (!value) {
    throw new Error(`Missing required option ${name}.`);
  }
  return value;
}

function runGh(ghArgs, { allowFailure = false } = {}) {
  const result = spawnSync("gh", ghArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !allowFailure) {
    const stderr = (result.stderr || "").trim();
    throw new Error(stderr || `gh ${ghArgs.join(" ")} failed with exit code ${result.status}.`);
  }

  return result;
}

function listFiles(dir) {
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((fullPath) => existsSync(fullPath));
}

function findSingle(files, pattern, label) {
  const matches = files.filter((file) => pattern.test(basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in the mac release assets directory.`);
  }
  return matches[0];
}

function collectAssets(inputDir, mode) {
  const files = listFiles(inputDir);
  const assets = [
    findSingle(files, /^Paperclip-Desktop-.*(?<!arm64)-mac\.zip$/u, "x64 ZIP"),
    findSingle(files, /^Paperclip-Desktop-.*-arm64-mac\.zip$/u, "arm64 ZIP"),
    findSingle(files, /^Paperclip-Desktop-.*(?<!arm64)\.dmg$/u, "x64 DMG"),
    findSingle(files, /^Paperclip-Desktop-.*-arm64\.dmg$/u, "arm64 DMG"),
    findSingle(files, /^Paperclip-Desktop-.*(?<!arm64)-mac\.zip\.blockmap$/u, "x64 ZIP blockmap"),
    findSingle(files, /^Paperclip-Desktop-.*-arm64-mac\.zip\.blockmap$/u, "arm64 ZIP blockmap"),
    findSingle(files, /^Paperclip-Desktop-.*(?<!arm64)\.dmg\.blockmap$/u, "x64 DMG blockmap"),
    findSingle(files, /^Paperclip-Desktop-.*-arm64\.dmg\.blockmap$/u, "arm64 DMG blockmap"),
  ];

  if (mode === "final") {
    assets.push(findSingle(files, /^latest-mac\.yml$/u, "latest-mac.yml"));
  }

  return assets;
}

function getRelease(tag) {
  const result = runGh(["release", "view", tag, "--json", "isDraft,url"], { allowFailure: true });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    if (/not found|release not found/i.test(stderr)) {
      return null;
    }
    throw new Error(stderr || `gh release view ${tag} failed with exit code ${result.status ?? "unknown"}.`);
  }
  return JSON.parse(result.stdout);
}

function ensureDraftRelease(tag, notesFile) {
  const release = getRelease(tag);

  if (!release) {
    const createArgs = ["release", "create", tag, "--draft", "--title", tag, "--verify-tag"];
    if (notesFile) {
      createArgs.push("--notes-file", notesFile);
    }
    runGh(createArgs);
    return;
  }

  if (!release.isDraft) {
    throw new Error(`Release ${tag} is already published. Refusing to upload staging mac assets to a public release.`);
  }

  const editArgs = ["release", "edit", tag, "--draft", "--title", tag];
  if (notesFile) {
    editArgs.push("--notes-file", notesFile);
  }
  runGh(editArgs);
}

function ensureExistingDraftRelease(tag) {
  const release = getRelease(tag);
  if (!release) {
    throw new Error(`Release ${tag} does not exist. Create the draft release first.`);
  }
  if (!release.isDraft) {
    throw new Error(`Release ${tag} is already published. Refusing to publish final mac assets into a non-draft release.`);
  }
}

function uploadAssets(tag, assets) {
  runGh(["release", "upload", tag, ...assets, "--clobber"]);
}

export function publishMacosReleaseAssets({ mode, tag, inputDir, notesFile = null, publish = false }) {
  if (mode !== "staging" && mode !== "final") {
    throw new Error("--mode must be staging or final.");
  }

  inputDir = resolve(projectRoot, inputDir);
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  const assets = collectAssets(inputDir, mode);

  if (mode === "staging") {
    ensureDraftRelease(tag, notesFile);
    uploadAssets(tag, assets);
    return;
  }

  ensureExistingDraftRelease(tag);
  uploadAssets(tag, assets);

  const editArgs = ["release", "edit", tag];
  if (notesFile) {
    editArgs.push("--notes-file", notesFile);
  }
  if (publish) {
    editArgs.push("--draft=false");
  }
  if (editArgs.length > 3 || publish) {
    runGh(editArgs);
  }
}

function main() {
  publishMacosReleaseAssets({
    mode: requireOption("--mode"),
    tag: requireOption("--tag"),
    inputDir: requireOption("--input-dir"),
    notesFile: takeOption("--notes-file"),
    publish: hasFlag("--publish"),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
