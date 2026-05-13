import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const outputDir = resolve(process.argv[2] || "release/local-macos");
const requireStapled = process.argv.includes("--require-stapled");
const expectedIdentity = process.env.APPLE_CODESIGN_IDENTITY?.trim() || null;
const expectedTeamId = process.env.APPLE_TEAM_ID?.trim() || null;
const MACH_O_MAGICS = new Set([
  "feedface",
  "cefaedfe",
  "feedfacf",
  "cffaedfe",
  "cafebabe",
  "bebafeca",
  "cafebabf",
  "bfbafeca",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.status !== 0) {
    const message = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed.\n${message}`);
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
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

    if (stat.isSymbolicLink()) continue;
    out.push(full);

    if (stat.isDirectory()) {
      walk(full, out);
    }
  }

  return out;
}

function relative(target) {
  return target.replace(`${outputDir}/`, "");
}

function codesignMetadata(target) {
  const { stderr } = run("codesign", ["-dvv", target]);
  const lines = stderr.split(/\r?\n/);
  const authority = lines.find((line) => line.startsWith("Authority="))?.replace(/^Authority=/, "") || null;
  const teamIdentifier = lines.find((line) => line.startsWith("TeamIdentifier="))?.replace(/^TeamIdentifier=/, "") || null;
  const identifier = lines.find((line) => line.startsWith("Identifier="))?.replace(/^Identifier=/, "") || null;

  if (expectedIdentity && authority !== expectedIdentity) {
    throw new Error(`Unexpected signing identity for ${target}: ${authority ?? "missing"} != ${expectedIdentity}`);
  }

  if (expectedTeamId && teamIdentifier !== expectedTeamId) {
    throw new Error(`Unexpected team identifier for ${target}: ${teamIdentifier ?? "missing"} != ${expectedTeamId}`);
  }

  return {
    authority,
    teamIdentifier,
    identifier,
  };
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function isMachOBinary(target) {
  let fd;

  try {
    fd = openSync(target, "r");
    const header = Buffer.alloc(4);
    const bytesRead = readSync(fd, header, 0, header.length, 0);
    if (bytesRead < header.length) return false;
    return MACH_O_MAGICS.has(header.toString("hex"));
  } catch {
    return false;
  } finally {
    if (typeof fd === "number") {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

function verifyCodesign(target, deep = false) {
  const args = ["--verify", "--strict", "--verbose=2"];
  if (deep) {
    args.splice(1, 0, "--deep");
  }
  args.push(target);
  run("codesign", args);
}

function machOArchitectures(target) {
  return run("lipo", ["-archs", target]).stdout.trim().split(/\s+/).filter(Boolean);
}

function verifyBundledNativeArchitectures(nodeBinary, targets) {
  if (!nodeBinary) return;

  const expectedArchitectures = machOArchitectures(nodeBinary);
  if (expectedArchitectures.length === 0) {
    throw new Error(`Unable to determine bundled Node architecture for ${nodeBinary}.`);
  }

  for (const target of targets) {
    const architectures = machOArchitectures(target);
    const hasCompatibleArchitecture = expectedArchitectures.some((arch) => architectures.includes(arch));
    if (!hasCompatibleArchitecture) {
      throw new Error(
        `Packaged native binary architecture mismatch: ${relative(target)} has [${architectures.join(", ")}], ` +
        `but bundled Node has [${expectedArchitectures.join(", ")}].`,
      );
    }
  }
}

function isDormantAlternateArchBinary(target, expectedArchitectures) {
  if (expectedArchitectures.includes("x86_64")) return false;
  return (
    target.includes("/prebuilds/darwin-x64/") ||
    target.includes("/prebuilds/ios-x64-simulator/") ||
    target.includes("/node_modules/@esbuild/darwin-x64/") ||
    target.includes("/node_modules/esbuild/lib/downloaded-@esbuild-darwin-x64-")
  );
}

function dependencyPath(nodeModulesDir, dependencyName) {
  return join(nodeModulesDir, ...dependencyName.split("/"), "package.json");
}

function verifyServerRuntimeDependencies(appPath) {
  const serverDir = join(appPath, "Contents", "Resources", "app-server", "server");
  const packagePath = join(serverDir, "package.json");
  if (!existsSync(packagePath)) return null;

  const uiIndexPath = join(serverDir, "ui-dist", "index.html");
  if (!existsSync(uiIndexPath)) {
    throw new Error(`Packaged server is missing bundled UI: ${uiIndexPath}`);
  }

  const nodeModulesDir = join(serverDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    throw new Error(`Packaged server is missing node_modules: ${nodeModulesDir}`);
  }

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {}).sort();
  const missing = dependencies.filter((dependency) => !existsSync(dependencyPath(nodeModulesDir, dependency)));
  if (missing.length > 0) {
    throw new Error(`Packaged server is missing runtime dependencies: ${missing.join(", ")}`);
  }

  return {
    path: relative(serverDir),
    dependencyCount: dependencies.length,
    uiDist: relative(uiIndexPath),
  };
}

function collectChecks(appPath) {
  const allEntries = walk(appPath);
  const helperExecutables = allEntries.filter((entry) => /\/Contents\/Frameworks\/.+\.app\/Contents\/MacOS\/.+$/.test(entry));
  const nodeBinary = allEntries.find((entry) => entry.endsWith("/Contents/Resources/app-server/node-bin/node")) || null;
  const postgresBinaries = allEntries.filter((entry) => /@embedded-postgres\/darwin-[^/]+\/native\/bin\/[^/]+$/.test(entry));
  const nativeNodeModules = allEntries.filter((entry) => entry.endsWith(".node") && isMachOBinary(entry));
  const nativeBareModules = allEntries.filter((entry) => entry.endsWith(".bare") && isMachOBinary(entry));
  const nativeDylibs = allEntries.filter((entry) => entry.endsWith(".dylib") && isMachOBinary(entry));
  const mainExecutables = allEntries.filter((entry) => /\/Contents\/MacOS\/[^/]+$/.test(entry) && !entry.includes("/Contents/Frameworks/"));
  const appServerMachOBinaries = allEntries.filter((entry) => {
    if (!entry.includes("/Contents/Resources/app-server/")) return false;
    if (entry.endsWith(".node") || entry.endsWith(".bare") || entry.endsWith(".dylib")) return false;
    if (entry === nodeBinary || postgresBinaries.includes(entry)) return false;
    return isMachOBinary(entry);
  });

  const expectedArchitectures = nodeBinary ? machOArchitectures(nodeBinary) : [];
  const architectureTargets = [
    ...postgresBinaries,
    ...nativeNodeModules,
    ...nativeDylibs,
    ...appServerMachOBinaries,
  ].filter((target) => !isDormantAlternateArchBinary(target, expectedArchitectures));
  verifyBundledNativeArchitectures(nodeBinary, architectureTargets);

  const namedChecks = [
    ["appBundle", [appPath]],
    ["mainExecutable", mainExecutables],
    ["helperExecutable", helperExecutables],
    ["nodeBinary", nodeBinary ? [nodeBinary] : []],
    ["postgresBinary", postgresBinaries],
    ["nativeNodeModule", nativeNodeModules],
    ["nativeBareModule", nativeBareModules],
    ["nativeDylib", nativeDylibs],
    ["appServerMachOBinary", appServerMachOBinaries],
  ];

  const checks = {};

  for (const [label, targets] of namedChecks) {
    if (targets.length === 0) continue;

    checks[label] = targets.map((target) => {
      verifyCodesign(target, label === "appBundle");
      return {
        path: relative(target),
        ...codesignMetadata(target),
      };
    });
  }

  const serverRuntime = verifyServerRuntimeDependencies(appPath);
  if (serverRuntime) {
    checks.serverRuntime = [serverRuntime];
  }

  return checks;
}

const entries = walk(outputDir);
const appBundles = entries.filter((entry) => entry.endsWith(".app") && !entry.includes("/Contents/Frameworks/"));
const dmgArtifacts = entries.filter((entry) => entry.endsWith(".dmg") && !entry.includes(".app/"));
const zipArtifacts = entries.filter((entry) => entry.endsWith(".zip") && !entry.includes(".app/"));

if (appBundles.length === 0) {
  throw new Error(`No macOS app bundle found under ${outputDir}.`);
}

if (dmgArtifacts.length === 0) {
  throw new Error(`No DMG artifact found under ${outputDir}.`);
}

if (zipArtifacts.length === 0) {
  throw new Error(`No ZIP artifact found under ${outputDir}.`);
}

const verification = {
  outputDir,
  requireStapled,
  appBundles: [],
  dmgArtifacts: [],
  zipArtifacts: [],
};

for (const appPath of appBundles) {
  if (requireStapled) {
    run("xcrun", ["stapler", "validate", "-v", appPath]);
  }

  verification.appBundles.push({
    path: relative(appPath),
    checks: collectChecks(appPath),
  });
}

for (const dmgPath of dmgArtifacts) {
  const verificationResult = tryRun("codesign", ["--verify", "--strict", "--verbose=2", dmgPath]);
  const metadataResult = tryRun("codesign", ["-dvv", dmgPath]);
  const entry = {
    path: relative(dmgPath),
    signed: verificationResult.ok && metadataResult.ok,
  };

  if (entry.signed) {
    if (requireStapled) {
      run("xcrun", ["stapler", "validate", "-v", dmgPath]);
    }
    Object.assign(entry, codesignMetadata(dmgPath));
  } else {
    entry.error = [verificationResult.stdout, verificationResult.stderr, metadataResult.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  verification.dmgArtifacts.push(entry);
}

for (const zipPath of zipArtifacts) {
  const extractDir = mkdtempSync(join(tmpdir(), "paperclip-zip-verify-"));
  let extractedApp = null;

  try {
    run("ditto", ["-x", "-k", zipPath, extractDir]);
    extractedApp = walk(extractDir).find((entry) => entry.endsWith(".app") && !entry.includes("/Contents/Frameworks/")) || null;
    if (!extractedApp) {
      throw new Error(`No .app bundle found inside ${zipPath}`);
    }

    if (requireStapled) {
      run("xcrun", ["stapler", "validate", "-v", extractedApp]);
    }

    verification.zipArtifacts.push({
      path: relative(zipPath),
      basename: basename(zipPath),
      extractedApp: extractedApp.replace(`${extractDir}/`, ""),
      checks: collectChecks(extractedApp),
    });
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

mkdirSync(outputDir, { recursive: true });
const reportPath = join(outputDir, "verification-summary.json");
writeFileSync(reportPath, `${JSON.stringify(verification, null, 2)}\n`, "utf8");

console.log(`Verified macOS artifacts in ${outputDir}`);
console.log(`App bundles: ${appBundles.map(relative).join(", ")}`);
console.log(`DMGs: ${dmgArtifacts.map(relative).join(", ")}`);
console.log(`ZIPs: ${zipArtifacts.map(relative).join(", ")}`);
console.log(`Verification summary: ${reportPath}`);
