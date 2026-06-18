#!/usr/bin/env node

/**
 * Installs @paperclipai/server from npm into per-architecture staging
 * directories, then assembles the server bundle that electron-builder packages
 * into the app.
 */

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
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

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveLocalSkillsCatalogSource() {
  const envRoot = process.env.PAPERCLIP_MONOREPO_ROOT?.trim();
  const repoCandidates = [
    ...(envRoot ? [path.resolve(envRoot)] : []),
    path.resolve(projectRoot, "..", "paperclip-fork"),
    path.resolve(projectRoot, "..", "paperclip-upstream"),
    path.resolve(projectRoot, "..", "paperclip-development"),
  ];
  for (const repoRoot of repoCandidates) {
    const packageDir = path.join(repoRoot, "packages", "skills-catalog");
    const generatedCatalog = path.join(packageDir, "generated", "catalog.json");
    if (existsSync(generatedCatalog)) {
      return { repoRoot, packageDir, generatedCatalog };
    }
  }
  return null;
}

const localSkillsCatalogSource = resolveLocalSkillsCatalogSource();
if (localSkillsCatalogSource) {
  console.log(`[prepare-server] Using local skills catalog source: ${localSkillsCatalogSource.packageDir}`);
}

const projectPkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const serverVersion = projectPkg.devDependencies["@paperclipai/server"];
const skillsCatalogVersion = serverVersion;
if (!serverVersion) {
  console.error("[prepare-server] @paperclipai/server not found in devDependencies");
  process.exit(1);
}

console.log(`[prepare-server] Target server version: @paperclipai/server@${serverVersion}`);
console.log(`[prepare-server] Target skills catalog version: @paperclipai/skills-catalog@${skillsCatalogVersion}`);

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

  // Skip if source and destination are already the same file (same inode = hardlink,
  // or same resolved symlink path) — avoids EINVAL from cpSync.
  try {
    const srcStat = lstatSync(archEsbuildBin);
    const dstStat = lstatSync(esbuildBin);
    if (srcStat.ino === dstStat.ino && srcStat.dev === dstStat.dev) {
      console.log(`[prepare-server] esbuild binary already correct for darwin-${packageArch}, skipping.`);
      return;
    }
  } catch {
    // stat failed — fall through and let cpSync handle it
  }

  cpSync(archEsbuildBin, esbuildBin);
  console.log(`[prepare-server] Normalized esbuild binary for darwin-${packageArch}.`);
}

for (const arch of targetArches) {
  const variant = `${ebPlatform}-${arch}`;
  const stagingDir = path.join(stagingRootDir, variant);
  const bundleDir = path.join(bundleRootDir, variant);
  const bundleServerDir = path.join(bundleDir, "server");
  const bundlePackagesDir = path.join(bundleDir, "packages");
  const bundleSkillsCatalogDir = path.join(bundlePackagesDir, "skills-catalog");

  console.log(`[prepare-server] Installing runtime bundle for ${variant}...`);

  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(
    path.join(stagingDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: {
          "@paperclipai/server": serverVersion,
          ...(localSkillsCatalogSource ? {} : { "@paperclipai/skills-catalog": skillsCatalogVersion }),
        },
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
  const skillsCatalogPkgDir = path.join(stagingDir, "node_modules", "@paperclipai", "skills-catalog");

  cpSync(path.join(serverPkgDir, "dist"), path.join(bundleServerDir, "dist"), { recursive: true });
  cpSync(path.join(serverPkgDir, "package.json"), path.join(bundleServerDir, "package.json"));

  const skillsSrc = path.join(serverPkgDir, "skills");
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, path.join(bundleServerDir, "skills"), { recursive: true });
  }

  cpSync(path.join(stagingDir, "node_modules"), path.join(bundleServerDir, "node_modules"), { recursive: true });
  rmSync(path.join(bundleServerDir, "node_modules", ".bin"), { recursive: true, force: true });

  mkdirSync(bundlePackagesDir, { recursive: true });
  const resolvedSkillsCatalogSource = localSkillsCatalogSource?.packageDir ?? (existsSync(skillsCatalogPkgDir) ? skillsCatalogPkgDir : null);
  if (resolvedSkillsCatalogSource) {
    cpSync(resolvedSkillsCatalogSource, bundleSkillsCatalogDir, { recursive: true });
  } else {
    console.error(`[prepare-server] ERROR: @paperclipai/skills-catalog not found locally or at ${skillsCatalogPkgDir}`);
    process.exit(1);
  }

  const generatedCatalogPath = path.join(bundleSkillsCatalogDir, "generated", "catalog.json");
  if (!existsSync(generatedCatalogPath)) {
    console.error(`[prepare-server] ERROR: skills catalog manifest missing at ${generatedCatalogPath}`);
    process.exit(1);
  }
  console.log(`[prepare-server] Skills catalog manifest bundled: ${generatedCatalogPath}`);

  // The @paperclipai/server package currently ships with embedded-postgres 18.x
  // (beta), but existing data directories created by Docker or older Desktop
  // installations use PostgreSQL 17. Downgrade to the latest PG17 release so
  // that Desktop can open those data directories without a manual pg_upgrade.
  //
  // Once @paperclipai/server ships with PG17 by default this block can be removed.
  console.log(`[prepare-server] Pinning embedded-postgres to PG17 for ${variant}...`);
  execSync(
    `npm install embedded-postgres@17.10.0-beta.17 --save-exact --no-audit --os=${nodePlatform} --cpu=${arch} --arch=${arch}`,
    {
      cwd: bundleServerDir,
      stdio: "inherit",
      env: {
        ...process.env,
        npm_config_arch: arch,
        npm_config_platform: nodePlatform,
        npm_config_target_arch: arch,
      },
    },
  );
  console.log(`[prepare-server] embedded-postgres pinned to PG17 for ${variant}.`);

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

for (const arch of arches) {
  const destDir = path.join(nodeBinDir, `${ebPlatform}-${arch}`);
  const destBin = path.join(destDir, platform === "win32" ? "node.exe" : "node");

  if (existsSync(destBin)) {
    console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} already downloaded, skipping`);
    continue;
  }

  mkdirSync(destDir, { recursive: true });

  const ext = platform === "win32" ? "zip" : "tar.gz";
  const archiveName = `node-${NODE_VERSION}-${nodeDownloadPlatform}-${arch}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}.${ext}`;
  const archivePath = path.join(destDir, `node.${ext}`);

  console.log(`[prepare-server] Downloading Node ${NODE_VERSION} for ${nodeDownloadPlatform}-${arch}...`);

  if (platform === "win32") {
    execSync(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${archivePath}'"`, { stdio: "inherit" });
  } else {
    execSync(`curl -fsSL -o "${archivePath}" "${url}"`, { stdio: "inherit" });
  }

  if (platform === "win32") {
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: "inherit" });
    cpSync(path.join(destDir, archiveName, "node.exe"), destBin);
    rmSync(path.join(destDir, archiveName), { recursive: true, force: true });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}" --strip-components=2 "${archiveName}/bin/node"`, { stdio: "inherit" });
  }

  rmSync(archivePath, { force: true });
  console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} ready at ${destBin}`);
}

console.log("[prepare-server] Cleaning up staging directories...");
rmSync(stagingRootDir, { recursive: true, force: true });

console.log("[prepare-server] Done.");
