import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function collectEsbuildBinaryTargets(rootDir, targets = []) {
  if (!existsSync(rootDir)) return targets;

  for (const entry of readdirSync(rootDir)) {
    const full = path.join(rootDir, entry);

    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;

    if (entry === "esbuild" && path.basename(path.dirname(full)) === "node_modules") {
      const packageJsonPath = path.join(full, "package.json");
      const binaryPath = path.join(full, "bin", "esbuild");
      if (!existsSync(packageJsonPath) || !existsSync(binaryPath)) continue;

      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof packageJson.version !== "string" || !packageJson.version) {
        throw new Error(`Unable to determine esbuild version from ${packageJsonPath}.`);
      }

      targets.push({
        packageDir: full,
        binaryPath,
        version: packageJson.version,
      });
      continue;
    }

    collectEsbuildBinaryTargets(full, targets);
  }

  return targets;
}

export function normalizeDarwinEsbuildBinaries({ bundleServerDir, arch, resolvePlatformBinary }) {
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported Darwin esbuild architecture '${arch}'.`);
  }

  const targets = collectEsbuildBinaryTargets(bundleServerDir);
  const sourceByVersion = new Map();

  for (const target of targets) {
    let sourceBinary = sourceByVersion.get(target.version);
    if (!sourceBinary) {
      sourceBinary = resolvePlatformBinary({ arch, version: target.version });
      if (!sourceBinary || !existsSync(sourceBinary)) {
        throw new Error(`Darwin ${arch} esbuild ${target.version} binary not found: ${sourceBinary ?? "unknown"}`);
      }
      sourceByVersion.set(target.version, sourceBinary);
    }

    cpSync(sourceBinary, target.binaryPath);
  }

  return targets;
}

export function installDarwinEsbuildBinary({ arch, version, cacheRootDir, execFileSync }) {
  const packageName = `@esbuild/darwin-${arch}`;
  const installDir = path.join(cacheRootDir, `${arch}-${version}`);
  const binaryPath = path.join(installDir, "package", "bin", "esbuild");

  if (existsSync(binaryPath)) return binaryPath;

  mkdirSync(installDir, { recursive: true });
  const packOutput = execFileSync(
    "npm",
    ["pack", `${packageName}@${version}`, "--pack-destination", installDir, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const packResult = JSON.parse(packOutput);
  const archiveName = packResult?.[0]?.filename;
  if (typeof archiveName !== "string" || !archiveName) {
    throw new Error(`npm pack did not return an archive for ${packageName}@${version}.`);
  }
  execFileSync(
    "tar",
    ["-xzf", path.join(installDir, archiveName), "-C", installDir],
    { stdio: "inherit" },
  );

  if (!existsSync(binaryPath)) {
    throw new Error(`npm pack did not contain ${packageName}@${version} at ${binaryPath}.`);
  }

  return binaryPath;
}
