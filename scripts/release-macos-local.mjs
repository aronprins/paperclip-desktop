#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const rootPackageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));

const DEFAULT_ARCHES = ["x64", "arm64"];
const PRODUCT_NAME = "Paperclip Desktop";
const APP_ID = "com.paperclipai.app";
const COPYRIGHT = "Copyright © 2026 Aron Prins";
const PUBLISH_OWNER = "aronprins";
const PUBLISH_REPO = "paperclip-desktop";

const args = process.argv.slice(2);

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

function runQuiet(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: projectRoot,
    ...options,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed.\n${output}`);
  }

  return result.stdout ?? "";
}

function parseTeamId(identityName) {
  return identityName.match(/\(([A-Z0-9]+)\)\s*$/)?.[1] ?? null;
}

function resolveMacSigningIdentity() {
  const explicitIdentity = process.env.APPLE_CODESIGN_IDENTITY?.trim() || process.env.CSC_NAME?.trim() || "";
  const explicitTeamId = process.env.APPLE_TEAM_ID?.trim() || null;

  if (explicitIdentity) {
    return {
      name: explicitIdentity,
      teamId: explicitTeamId || parseTeamId(explicitIdentity),
    };
  }

  const output = runQuiet("security", ["find-identity", "-v", "-p", "codesigning"]);
  const identities = output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\)\s+[0-9A-F]+\s+"(.+)"\s*$/))
    .filter(Boolean)
    .map((match) => match[1])
    .filter((name) => name.startsWith("Developer ID Application: "));

  const matchingIdentities = explicitTeamId
    ? identities.filter((name) => name.includes(`(${explicitTeamId})`))
    : identities;

  if (matchingIdentities.length === 0) {
    throw new Error("No Developer ID Application signing identity found in the active keychain.");
  }

  if (matchingIdentities.length > 1) {
    throw new Error(
      `Multiple Developer ID Application identities found (${matchingIdentities.join(", ")}). Set APPLE_CODESIGN_IDENTITY explicitly.`,
    );
  }

  return {
    name: matchingIdentities[0],
    teamId: explicitTeamId || parseTeamId(matchingIdentities[0]),
  };
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function removeGeneratedMetadata(dir) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;

    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      removeGeneratedMetadata(full);
      continue;
    }

    if (entry === ".DS_Store" || entry === "builder-debug.yml") {
      rmSync(full, { force: true });
    }
  }
}

function removeBrokenSymlinks(dir) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;

    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      try {
        const target = readlinkSync(full);
        const resolved = target.startsWith("/") ? target : join(dir, target);
        if (!existsSync(resolved)) {
          rmSync(full, { force: true });
        }
      } catch {
        rmSync(full, { force: true });
      }
      continue;
    }

    if (stat.isDirectory()) {
      removeBrokenSymlinks(full);
    }
  }
}

function pruneNodeBinShims(dir) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;

    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) continue;

    if (entry === ".bin" && full.includes("/node_modules/")) {
      rmSync(full, { recursive: true, force: true });
      continue;
    }

    pruneNodeBinShims(full);
  }
}

function relativizeCopiedSymlinks(dir, sourceRoot, targetRoot) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;

    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      const target = readlinkSync(full);
      if (target.startsWith(sourceRoot)) {
        const mappedTarget = join(targetRoot, target.slice(sourceRoot.length).replace(/^\/+/, ""));
        const relativeTarget = relative(dirname(full), mappedTarget) || ".";
        rmSync(full, { force: true });
        symlinkSync(relativeTarget, full);
      }
      continue;
    }

    if (stat.isDirectory()) {
      relativizeCopiedSymlinks(full, sourceRoot, targetRoot);
    }
  }
}

function copyReleaseContents(fromDir, toDir) {
  ensureDir(toDir);
  for (const entry of readdirSync(fromDir)) {
    run("ditto", [join(fromDir, entry), join(toDir, entry)]);
  }
}

function generateIcns(sourcePng, targetIcns, stageRoot) {
  const iconsetDir = join(stageRoot, "icon.iconset");
  ensureDir(iconsetDir);

  for (const size of [16, 32, 128, 256, 512]) {
    run("sips", ["-z", String(size), String(size), sourcePng, "--out", join(iconsetDir, `icon_${size}x${size}.png`)]);
    const retinaSize = size * 2;
    run(
      "sips",
      [
        "-z",
        String(retinaSize),
        String(retinaSize),
        sourcePng,
        "--out",
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ],
    );
  }

  run("iconutil", ["-c", "icns", iconsetDir, "-o", targetIcns]);
}

function readInstalledPackageVersion(name) {
  const installed = JSON.parse(
    readFileSync(join(projectRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"),
  );
  if (typeof installed.version !== "string" || !installed.version) {
    throw new Error(`Could not read installed version for ${name}.`);
  }
  return installed.version;
}

function buildStagePackageJson() {
  const runtimeDependencies = Object.fromEntries(
    Object.keys(rootPackageJson.dependencies ?? {}).map((name) => [name, readInstalledPackageVersion(name)]),
  );

  return {
    name: rootPackageJson.name,
    version: rootPackageJson.version,
    private: true,
    description: rootPackageJson.description,
    author: rootPackageJson.author,
    homepage: rootPackageJson.homepage,
    main: "dist/main.js",
    dependencies: runtimeDependencies,
  };
}

function buildStageConfig(arch) {
  return {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    copyright: COPYRIGHT,
    afterPack: join(projectRoot, "scripts", "stage-after-pack.mjs"),
    directories: {
      output: "release",
      buildResources: "build",
    },
    files: [
      "dist/**/*",
      "package.json",
    ],
    extraResources: [
      {
        from: "app-server/server",
        to: "app-server/server",
        filter: ["**/*"],
      },
      {
        from: "app-server/node-bin",
        to: "app-server/node-bin",
        filter: ["**/*"],
      },
    ],
    publish: {
      provider: "github",
      owner: PUBLISH_OWNER,
      repo: PUBLISH_REPO,
      releaseType: "release",
    },
    mac: {
      category: "public.app-category.developer-tools",
      icon: "build/icon.icns",
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
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.inherit.plist",
      signIgnore: [
        "/Contents/Resources/app-server/.*",
      ],
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

function ensureProjectDependencies(skipInstall) {
  if (skipInstall) return;
  if (existsSync(join(projectRoot, "node_modules", ".bin", "electron-builder"))) {
    return;
  }

  console.log("[release-local] Installing root dependencies...");
  run("pnpm", ["install", "--frozen-lockfile"]);
}

function buildProjectArtifacts(skipBuild) {
  if (skipBuild) return;

  console.log("[release-local] Building desktop TypeScript...");
  run("pnpm", ["build"]);

  console.log("[release-local] Preparing bundled server runtimes...");
  run("pnpm", ["prepare-server"]);

  console.log("[release-local] Building bundled UI...");
  run("pnpm", ["build-ui"]);
}

function assertExists(target, label) {
  if (!existsSync(target)) {
    throw new Error(`${label} not found: ${target}`);
  }
}

function stageRuntimeFiles(stageAppDir, arch, stageRoot) {
  const buildResourcesDir = join(stageAppDir, "build");
  const stageServerDir = join(stageAppDir, "app-server", "server");
  const stageNodeDir = join(stageAppDir, "app-server", "node-bin");

  const desktopDistDir = join(projectRoot, "dist");
  const bundleServerDir = join(projectRoot, "build", "server-bundle", `mac-${arch}`, "server");
  const nodeRuntimeDir = join(projectRoot, "build", "node-bin", `mac-${arch}`);

  assertExists(desktopDistDir, "Desktop build output");
  assertExists(bundleServerDir, `Server bundle for mac-${arch}`);
  assertExists(nodeRuntimeDir, `Node runtime for mac-${arch}`);

  cpSync(desktopDistDir, join(stageAppDir, "dist"), { recursive: true });
  cpSync(bundleServerDir, stageServerDir, { recursive: true });
  cpSync(nodeRuntimeDir, stageNodeDir, { recursive: true });
  relativizeCopiedSymlinks(stageServerDir, bundleServerDir, stageServerDir);
  pruneNodeBinShims(stageServerDir);
  removeBrokenSymlinks(stageServerDir);

  ensureDir(buildResourcesDir);
  cpSync(join(projectRoot, "build", "icon.png"), join(buildResourcesDir, "icon.png"));
  cpSync(join(projectRoot, "build", "entitlements.mac.plist"), join(buildResourcesDir, "entitlements.mac.plist"));
  cpSync(
    join(projectRoot, "build", "entitlements.mac.inherit.plist"),
    join(buildResourcesDir, "entitlements.mac.inherit.plist"),
  );
  generateIcns(join(buildResourcesDir, "icon.png"), join(buildResourcesDir, "icon.icns"), stageRoot);
}

function installStageRuntimeDependencies(stageAppDir) {
  console.log(`[release-local] Installing staged runtime dependencies in ${stageAppDir}...`);
  run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: stageAppDir,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  rmSync(join(stageAppDir, "package-lock.json"), { force: true });
}

function buildStage(stageAppDir, arch, signingInfo) {
  console.log(`[release-local] Packaging staged macOS ${arch} build...`);

  const env = {
    ...process.env,
    APPLE_CODESIGN_IDENTITY: signingInfo.name,
  };
  if (signingInfo.teamId) {
    env.APPLE_TEAM_ID = signingInfo.teamId;
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === "") {
    delete env.CSC_IDENTITY_AUTO_DISCOVERY;
  }

  run(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--projectDir",
      stageAppDir,
      "--config",
      join(stageAppDir, "electron-builder.json"),
      "--mac",
      `--${arch}`,
      "--publish",
      "never",
    ],
    {
      env,
    },
  );
}

function verifyStageArtifacts(archOutputDir, signingInfo) {
  console.log(`[release-local] Verifying staged macOS artifacts in ${archOutputDir}...`);
  run("node", ["scripts/verify-macos-release.mjs", archOutputDir], {
    cwd: projectRoot,
    env: {
      ...process.env,
      APPLE_CODESIGN_IDENTITY: signingInfo.name,
      ...(signingInfo.teamId ? { APPLE_TEAM_ID: signingInfo.teamId } : {}),
    },
  });
}

function collectArtifacts(archOutputDir) {
  return readdirSync(archOutputDir)
    .filter((entry) => !entry.endsWith(".json"))
    .map((entry) => join(archOutputDir, entry))
    .sort();
}

function buildArch(arch, outputRoot, keepStage, signingInfo) {
  const stageRoot = mkdtempSync(join(tmpdir(), `paperclip-macos-stage-${arch}-`));
  const stageAppDir = join(stageRoot, "app");
  const archOutputDir = join(outputRoot, arch);

  rmSync(archOutputDir, { recursive: true, force: true });
  ensureDir(stageAppDir);

  try {
    console.log(`[release-local] Staging macOS ${arch} app in ${stageRoot}...`);
    stageRuntimeFiles(stageAppDir, arch, stageRoot);

    writeFileSync(
      join(stageAppDir, "package.json"),
      `${JSON.stringify(buildStagePackageJson(), null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      join(stageAppDir, "electron-builder.json"),
      `${JSON.stringify(buildStageConfig(arch), null, 2)}\n`,
      "utf8",
    );

    installStageRuntimeDependencies(stageAppDir);
    buildStage(stageAppDir, arch, signingInfo);

    const stageReleaseDir = join(stageAppDir, "release");
    assertExists(stageReleaseDir, `Release output for ${arch}`);
    copyReleaseContents(stageReleaseDir, archOutputDir);
    removeGeneratedMetadata(archOutputDir);
    verifyStageArtifacts(archOutputDir, signingInfo);

    const stageManifest = {
      arch,
      stageRoot,
      stageAppDir,
      outputDir: archOutputDir,
      kept: keepStage,
    };
    writeFileSync(join(archOutputDir, "stage-manifest.json"), `${JSON.stringify(stageManifest, null, 2)}\n`, "utf8");

    return {
      arch,
      outputDir: archOutputDir,
      stageRoot,
      artifacts: collectArtifacts(archOutputDir),
    };
  } finally {
    if (!keepStage) {
      rmSync(stageRoot, { recursive: true, force: true });
    }
  }
}

function resolveArches() {
  const arch = takeOption("--arch");
  if (!arch) return DEFAULT_ARCHES;
  if (!DEFAULT_ARCHES.includes(arch)) {
    throw new Error(`Unsupported arch '${arch}'. Expected one of: ${DEFAULT_ARCHES.join(", ")}.`);
  }
  return [arch];
}

function main() {
  const arches = resolveArches();
  const outputRoot = resolve(projectRoot, takeOption("--output-root") || "release/local-macos");
  assertRepoContainedOutput(outputRoot, "--output-root");
  const keepStage = hasFlag("--keep-stage");
  const skipInstall = hasFlag("--skip-install");
  const skipBuild = hasFlag("--skip-build");
  const signingInfo = resolveMacSigningIdentity();

  ensureProjectDependencies(skipInstall);
  buildProjectArtifacts(skipBuild);

  console.log(`[release-local] Using macOS signing identity: ${signingInfo.name}`);
  if (signingInfo.teamId) {
    console.log(`[release-local] Using Apple team ID: ${signingInfo.teamId}`);
  }

  const results = [];
  for (const arch of arches) {
    results.push(buildArch(arch, outputRoot, keepStage, signingInfo));
  }

  console.log("[release-local] Built staged macOS artifacts:");
  for (const result of results) {
    console.log(`[release-local]   ${result.arch}: ${result.outputDir}`);
    for (const artifact of result.artifacts) {
      console.log(`[release-local]     - ${artifact}`);
    }
    if (keepStage) {
      console.log(`[release-local]     stage: ${result.stageRoot}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
