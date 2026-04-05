#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);
const supportedArchs = ["x64", "arm64"];
const topLevelKeyOrder = ["version", "files", "path", "sha512", "releaseDate"];
const fileKeyOrder = ["url", "sha512", "size"];

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

function normalizeFileName(name) {
  return name.replace(/[ _]+/g, "-");
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseLatestMacManifest(text) {
  const lines = text.split(/\r?\n/);
  const manifest = { files: [] };
  let currentFile = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line) continue;

    if (!line.startsWith(" ")) {
      currentFile = null;
      if (line === "files:") {
        continue;
      }

      const separator = line.indexOf(":");
      if (separator === -1) {
        throw new Error(`Unable to parse latest-mac.yml line: ${line}`);
      }

      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      manifest[key] = parseScalar(value);
      continue;
    }

    if (line.startsWith("  - ")) {
      const entry = {};
      const pair = line.slice(4);
      const separator = pair.indexOf(":");
      if (separator === -1) {
        throw new Error(`Unable to parse latest-mac.yml file entry: ${line}`);
      }

      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      entry[key] = parseScalar(value);
      manifest.files.push(entry);
      currentFile = entry;
      continue;
    }

    if (line.startsWith("    ")) {
      if (!currentFile) {
        throw new Error(`Found nested latest-mac.yml value without a file entry: ${line}`);
      }

      const pair = line.trimStart();
      const separator = pair.indexOf(":");
      if (separator === -1) {
        throw new Error(`Unable to parse latest-mac.yml nested value: ${line}`);
      }

      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      currentFile[key] = parseScalar(value);
      continue;
    }

    throw new Error(`Unable to parse latest-mac.yml line: ${line}`);
  }

  return manifest;
}

function formatScalar(value) {
  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return `'${value}'`;
  }

  return String(value);
}

function serializeLatestMacManifest(manifest) {
  const lines = [];
  const topLevelKeys = [
    ...topLevelKeyOrder.filter((key) => key in manifest),
    ...Object.keys(manifest).filter((key) => !topLevelKeyOrder.includes(key)),
  ];

  for (const key of topLevelKeys) {
    if (key === "files") {
      lines.push("files:");
      for (const file of manifest.files) {
        const keys = [
          ...fileKeyOrder.filter((fileKey) => fileKey in file),
          ...Object.keys(file).filter((fileKey) => !fileKeyOrder.includes(fileKey)),
        ];

        keys.forEach((fileKey, index) => {
          const prefix = index === 0 ? "  - " : "    ";
          lines.push(`${prefix}${fileKey}: ${formatScalar(file[fileKey])}`);
        });
      }
      continue;
    }

    lines.push(`${key}: ${formatScalar(manifest[key])}`);
  }

  return `${lines.join("\n")}\n`;
}

function listFiles(dir, out = []) {
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
      listFiles(full, out);
      continue;
    }

    out.push(full);
  }

  return out;
}

function loadManifest(archDir) {
  const manifestPath = join(archDir, "latest-mac.yml");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing latest-mac.yml under ${archDir}.`);
  }

  const manifest = parseLatestMacManifest(readFileSync(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Invalid latest-mac.yml under ${archDir}.`);
  }

  return manifest;
}

function findSourceFile(archDir, targetName) {
  const matches = listFiles(archDir).filter((fullPath) => normalizeFileName(basename(fullPath)) === targetName);
  if (matches.length === 0) {
    throw new Error(`Unable to find source file for ${targetName} under ${archDir}.`);
  }

  if (matches.length > 1) {
    throw new Error(`Multiple source files matched ${targetName} under ${archDir}.`);
  }

  return matches[0];
}

function ensureUniqueUrls(files) {
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file.url !== "string") {
      throw new Error("Merged latest-mac.yml contains an entry without a url.");
    }

    if (seen.has(file.url)) {
      throw new Error(`Duplicate file url in merged latest-mac.yml: ${file.url}`);
    }

    seen.add(file.url);
  }
}

function latestDate(values) {
  return values
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1);
}

function ensureManifestMetadataParity(manifests) {
  const knownKeys = new Set(["version", "files", "path", "sha512", "releaseDate"]);
  const baseline = manifests[0].manifest;

  for (const { arch, manifest } of manifests.slice(1)) {
    const keys = new Set([
      ...Object.keys(baseline).filter((key) => !knownKeys.has(key)),
      ...Object.keys(manifest).filter((key) => !knownKeys.has(key)),
    ]);

    for (const key of keys) {
      const baselineValue = JSON.stringify(baseline[key]);
      const manifestValue = JSON.stringify(manifest[key]);
      if (baselineValue !== manifestValue) {
        throw new Error(`Cannot merge latest-mac.yml files with different ${key} values (x64 vs ${arch}).`);
      }
    }
  }
}

export function prepareMacosReleaseAssets({ inputRoot, outputDir }) {
  inputRoot = resolve(projectRoot, inputRoot);
  outputDir = resolve(projectRoot, outputDir);

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const manifests = supportedArchs.map((arch) => {
    const archDir = join(inputRoot, arch);
    if (!existsSync(archDir)) {
      throw new Error(`Missing macOS build output for ${arch}: ${archDir}`);
    }

    return {
      arch,
      archDir,
      manifest: loadManifest(archDir),
    };
  });

  const versions = new Set(manifests.map(({ manifest }) => manifest.version));
  if (versions.size !== 1) {
    throw new Error(`Cannot merge latest-mac.yml files with different versions: ${Array.from(versions).join(", ")}`);
  }
  ensureManifestMetadataParity(manifests);

  const mergedFiles = manifests.flatMap(({ manifest }) => {
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error("Each latest-mac.yml must contain a non-empty files array.");
    }
    return manifest.files;
  });
  ensureUniqueUrls(mergedFiles);

  for (const { archDir, manifest } of manifests) {
    for (const file of manifest.files) {
      const sourcePath = findSourceFile(archDir, file.url);
      const targetPath = join(outputDir, file.url);
      cpSync(sourcePath, targetPath);

      const blockMapName = `${file.url}.blockmap`;
      const blockMapPath = findSourceFile(archDir, blockMapName);
      cpSync(blockMapPath, join(outputDir, blockMapName));
    }
  }

  const preferredZip = mergedFiles.find((file) => typeof file.url === "string" && file.url.endsWith("-mac.zip") && !file.url.includes("arm64"))
    ?? mergedFiles.find((file) => typeof file.url === "string" && file.url.endsWith(".zip"))
    ?? mergedFiles[0];

  const mergedManifest = {
    ...manifests[0].manifest,
    version: manifests[0].manifest.version,
    files: mergedFiles,
    path: preferredZip.url,
    sha512: preferredZip.sha512,
    releaseDate: latestDate(manifests.map(({ manifest }) => manifest.releaseDate)),
  };

  writeFileSync(join(outputDir, "latest-mac.yml"), serializeLatestMacManifest(mergedManifest), "utf8");
  writeFileSync(
    join(outputDir, "mac-release-assets.json"),
    `${JSON.stringify({
      inputRoot,
      archs: supportedArchs,
      version: mergedManifest.version,
      files: mergedFiles.map((file) => file.url),
    }, null, 2)}\n`,
    "utf8",
  );
}

function main() {
  prepareMacosReleaseAssets({
    inputRoot: requireOption("--input-root"),
    outputDir: requireOption("--output-dir"),
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
