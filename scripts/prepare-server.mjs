#!/usr/bin/env node

/**
 * Installs @paperclipai/server from npm into per-architecture staging
 * directories, then assembles the server bundle that electron-builder packages
 * into the app.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const stagingRootDir = path.join(projectRoot, "build", "server-staging");
const bundleRootDir = path.join(projectRoot, "build", "server-bundle");

const projectPkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const serverVersion = projectPkg.devDependencies["@paperclipai/server"];
if (!serverVersion) {
  console.error("[prepare-server] @paperclipai/server not found in devDependencies");
  process.exit(1);
}

console.log(`[prepare-server] Target server version: @paperclipai/server@${serverVersion}`);

const platform = process.platform;
const nodePlatform = platform === "win32" ? "win32" : platform;
const ebPlatform = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
const targetArches = platform === "darwin" ? ["x64", "arm64"] : ["x64"];

rmSync(stagingRootDir, { recursive: true, force: true });
rmSync(bundleRootDir, { recursive: true, force: true });

mkdirSync(stagingRootDir, { recursive: true });
mkdirSync(bundleRootDir, { recursive: true });

function fixDylibSymlinks(libDir) {
  if (!existsSync(libDir)) return;

  for (const file of readdirSync(libDir)) {
    const match = file.match(/^(lib[^.]+)\.(\d+)(\.\d+)+\.dylib$/);
    if (!match) continue;

    const base = match[1];
    const major = match[2];

    for (const alias of [`${base}.${major}.dylib`, `${base}.dylib`]) {
      const aliasPath = path.join(libDir, alias);
      try {
        lstatSync(aliasPath);
        rmSync(aliasPath, { force: true });
      } catch {
        // ignore missing alias
      }

      symlinkSync(file, aliasPath);
      console.log(`[prepare-server]   ${alias} -> ${file}`);
    }
  }
}

function removeFinderDuplicates(rootDir) {
  function* walkDir(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);

      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }

      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        yield* walkDir(full);
      } else {
        yield full;
      }
    }
  }

  const duplicates = [];
  for (const file of walkDir(rootDir)) {
    const base = path.basename(file);
    if (/ \d+(\.[^/]+)?$/.test(base) && / \d+/.test(base)) {
      duplicates.push(file);
    }
  }

  if (duplicates.length === 0) {
    console.log("[prepare-server] No Finder duplicates found.");
    return;
  }

  console.warn(`[prepare-server] WARNING: found ${duplicates.length} Finder duplicate file(s). Removing them now.`);
  for (const file of duplicates) {
    rmSync(file, { force: true });
    console.warn(`[prepare-server]   removed: ${path.relative(rootDir, file)}`);
  }
}

function validateMigrations(bundleServerDir) {
  const migrationsDir = path.join(
    bundleServerDir,
    "node_modules",
    "@paperclipai",
    "db",
    "dist",
    "migrations",
  );

  if (!existsSync(migrationsDir)) {
    console.error(`[prepare-server] ERROR: Migrations directory not found at ${migrationsDir}`);
    process.exit(1);
  }

  const sqlFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  console.log(`[prepare-server] Migration files validated: ${sqlFiles.length} SQL file(s) present.`);
  if (sqlFiles.length === 0) {
    console.error("[prepare-server] ERROR: No migration SQL files found in @paperclipai/db. The app will fail to initialise the database.");
    process.exit(1);
  }
}

function normalizeEsbuildBinary(bundleServerDir, arch) {
  const packageArch = arch === "x64" ? "x64" : "arm64";
  const esbuildBin = path.join(bundleServerDir, "node_modules", "esbuild", "bin", "esbuild");
  const archEsbuildBin = path.join(
    bundleServerDir,
    "node_modules",
    "@esbuild",
    `darwin-${packageArch}`,
    "bin",
    "esbuild",
  );

  if (!existsSync(esbuildBin) || !existsSync(archEsbuildBin)) return;

  cpSync(archEsbuildBin, esbuildBin);
  console.log(`[prepare-server] Normalized esbuild binary for darwin-${packageArch}.`);
}

for (const arch of targetArches) {
  const variant = `${ebPlatform}-${arch}`;
  const stagingDir = path.join(stagingRootDir, variant);
  const bundleDir = path.join(bundleRootDir, variant);
  const bundleServerDir = path.join(bundleDir, "server");

  console.log(`[prepare-server] Installing runtime bundle for ${variant}...`);

  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(
    path.join(stagingDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: { "@paperclipai/server": serverVersion },
        overrides: {
          // cssstyle currently resolves a 5.x css-color release that trips
          // Node 22's ERR_REQUIRE_ASYNC_MODULE path in the packaged runtime.
          "@asamuzakjp/css-color": "4.1.2",
        },
      },
      null,
      2,
    ),
  );

  execSync(
    `npm install --production --os=${nodePlatform} --cpu=${arch} --arch=${arch}`,
    {
      cwd: stagingDir,
      stdio: "inherit",
      env: {
        ...process.env,
        npm_config_arch: arch,
        npm_config_platform: nodePlatform,
        npm_config_target_arch: arch,
      },
    },
  );

  console.log(`[prepare-server] Assembling server bundle for ${variant}...`);
  mkdirSync(bundleServerDir, { recursive: true });

  const serverPkgDir = path.join(stagingDir, "node_modules", "@paperclipai", "server");

  cpSync(path.join(serverPkgDir, "dist"), path.join(bundleServerDir, "dist"), { recursive: true });
  cpSync(path.join(serverPkgDir, "package.json"), path.join(bundleServerDir, "package.json"));

  const skillsSrc = path.join(serverPkgDir, "skills");
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, path.join(bundleServerDir, "skills"), { recursive: true });
  }

  cpSync(path.join(stagingDir, "node_modules"), path.join(bundleServerDir, "node_modules"), { recursive: true });
  rmSync(path.join(bundleServerDir, "node_modules", ".bin"), { recursive: true, force: true });

  if (platform === "darwin") {
    console.log(`[prepare-server] Fixing dylib symlinks for ${variant} embedded-postgres...`);
    const embeddedPgScope = path.join(bundleServerDir, "node_modules", "@embedded-postgres");
    if (existsSync(embeddedPgScope)) {
      for (const pkgArch of readdirSync(embeddedPgScope)) {
        const libDir = path.join(embeddedPgScope, pkgArch, "native", "lib");
        fixDylibSymlinks(libDir);
      }
    }
    normalizeEsbuildBinary(bundleServerDir, arch);
  }

  console.log(`[prepare-server] Scanning ${variant} bundle for Finder duplicate files...`);
  removeFinderDuplicates(bundleDir);
  validateMigrations(bundleServerDir);
}

const NODE_VERSION = "v22.15.0";
const arches = platform === "darwin" ? ["x64", "arm64"] : ["x64"];
const nodeDownloadPlatform = platform === "win32" ? "win" : platform;
const nodeBinDir = path.join(projectRoot, "build", "node-bin");

// Verify the downloaded archive against Node's published SHASUMS256.txt before it
// is extracted and bundled into the signed app. HTTPS alone does not defend
// against CDN compromise / corporate MITM root CAs / content substitution.
function verifyArchiveChecksum(archivePath, archiveFileName) {
  const sumsPath = `${archivePath}.SHASUMS256.txt`;
  const sumsUrl = `https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`;
  if (platform === "win32") {
    execSync(`powershell -Command "Invoke-WebRequest -Uri '${sumsUrl}' -OutFile '${sumsPath}'"`, { stdio: "inherit" });
  } else {
    execSync(`curl -fsSL -o "${sumsPath}" "${sumsUrl}"`, { stdio: "inherit" });
  }

  const sums = readFileSync(sumsPath, "utf8");
  rmSync(sumsPath, { force: true });

  const expectedLine = sums.split("\n").find((line) => line.trim().endsWith(`  ${archiveFileName}`));
  if (!expectedLine) {
    throw new Error(`[prepare-server] No SHASUMS256 entry found for ${archiveFileName}`);
  }
  const expected = expectedLine.trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `[prepare-server] Node archive checksum mismatch for ${archiveFileName}: expected ${expected}, got ${actual}`,
    );
  }
  console.log(`[prepare-server] Verified ${archiveFileName} sha256=${actual}`);
}

for (const arch of arches) {
  const destDir = path.join(nodeBinDir, `${ebPlatform}-${arch}`);
  const destBin = path.join(destDir, platform === "win32" ? "node.exe" : "node");
  // The cache key must include the version: a bare existsSync(destBin) would keep
  // shipping a stale binary after a NODE_VERSION bump (e.g. a security patch).
  // Kept as a sibling (not inside destDir) so it isn't copied into the app bundle.
  const versionMarker = path.join(nodeBinDir, `.${ebPlatform}-${arch}.node-version`);

  if (existsSync(destBin) && existsSync(versionMarker) && readFileSync(versionMarker, "utf8").trim() === NODE_VERSION) {
    console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} already downloaded, skipping`);
    continue;
  }

  // Stale or unverified cache: rebuild from scratch.
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const ext = platform === "win32" ? "zip" : "tar.gz";
  const archiveName = `node-${NODE_VERSION}-${nodeDownloadPlatform}-${arch}`;
  const archiveFileName = `${archiveName}.${ext}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveFileName}`;
  const archivePath = path.join(destDir, `node.${ext}`);

  console.log(`[prepare-server] Downloading Node ${NODE_VERSION} for ${nodeDownloadPlatform}-${arch}...`);

  if (platform === "win32") {
    execSync(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${archivePath}'"`, { stdio: "inherit" });
  } else {
    execSync(`curl -fsSL -o "${archivePath}" "${url}"`, { stdio: "inherit" });
  }

  verifyArchiveChecksum(archivePath, archiveFileName);

  if (platform === "win32") {
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: "inherit" });
    cpSync(path.join(destDir, archiveName, "node.exe"), destBin);
    rmSync(path.join(destDir, archiveName), { recursive: true, force: true });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}" --strip-components=2 "${archiveName}/bin/node"`, { stdio: "inherit" });
  }

  rmSync(archivePath, { force: true });
  writeFileSync(versionMarker, `${NODE_VERSION}\n`, "utf8");
  console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} ready at ${destBin}`);
}

console.log("[prepare-server] Cleaning up staging directories...");
rmSync(stagingRootDir, { recursive: true, force: true });

console.log("[prepare-server] Done.");
