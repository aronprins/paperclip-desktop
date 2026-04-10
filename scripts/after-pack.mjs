import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, openSync, closeSync, readSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Remove broken symlinks recursively. codesign fails on dangling links. */
function removeBrokenSymlinks(dir) {
  if (!existsSync(dir)) return;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
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
        // best-effort cleanup
      }
    }
  }
}

function collectSignableBinaries(dir, out = []) {
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
    if (stat.isDirectory()) {
      collectSignableBinaries(full, out);
      continue;
    }

    const looksNativeBinary = entry.endsWith(".dylib") || entry.endsWith(".node") || (stat.mode & 0o111) !== 0;
    if (!looksNativeBinary || !isMachOBinary(full)) continue;

    out.push({ path: full, mode: stat.mode });
  }

  return out;
}

function stripBundleMetadata(appPath) {
  console.log("[after-pack] Cleaning broken symlinks...");
  removeBrokenSymlinks(join(appPath, "Contents"));

  console.log("[after-pack] Cleaning AppleDouble / .DS_Store files...");
  try {
    execFileSync("dot_clean", [appPath]);
  } catch {
    // best effort only
  }
  execFileSync("sh", ["-c", `find "${appPath}" -name "._*" -delete 2>/dev/null; find "${appPath}" -name ".DS_Store" -delete 2>/dev/null; true`]);

  console.log("[after-pack] Stripping extended attributes...");
  execFileSync("sh", ["-c", `find "${appPath}" ! -type l -print0 | xargs -0 -n 200 xattr -c 2>/dev/null; true`]);
}

function signTarget(target, identity, entitlements) {
  const args = ["--force", "--options", "runtime"];
  args.push("--timestamp");
  args.push("--sign", identity);
  if (entitlements) {
    args.push("--entitlements", entitlements);
  }
  args.push(target);

  console.log(`[after-pack]   codesign ${target}`);
  execFileSync("codesign", args, { stdio: "inherit" });
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const appServerPath = join(appPath, "Contents", "Resources", "app-server");
  const inheritedEntitlements = join(
    context.packager.info.buildResourcesDir,
    "entitlements.mac.inherit.plist",
  );
  const signingIdentity = (
    process.env.APPLE_CODESIGN_IDENTITY?.trim() ||
    process.env.CSC_NAME?.trim() ||
    ""
  );
  const allowUnsignedMacBuild = process.env.ALLOW_UNSIGNED_MACOS_BUILD === "true";

  stripBundleMetadata(appPath);

  if (!signingIdentity) {
    if (!allowUnsignedMacBuild) {
      throw new Error(
        "macOS release signing requires APPLE_CODESIGN_IDENTITY or CSC_NAME. " +
        "Set ALLOW_UNSIGNED_MACOS_BUILD=true only for explicit local unsigned builds.",
      );
    }

    console.log("[after-pack] Unsigned macOS build explicitly allowed, skipping nested runtime signing.");
    return;
  }

  if (!existsSync(appServerPath)) {
    console.log("[after-pack] No app-server bundle found, skipping nested runtime signing.");
    return;
  }

  const signableBinaries = collectSignableBinaries(appServerPath).sort((left, right) => {
    const leftIsLibrary = left.path.endsWith(".dylib") || left.path.endsWith(".node");
    const rightIsLibrary = right.path.endsWith(".dylib") || right.path.endsWith(".node");
    if (leftIsLibrary !== rightIsLibrary) return leftIsLibrary ? -1 : 1;

    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    return rightDepth - leftDepth;
  });

  console.log(`[after-pack] Signing ${signableBinaries.length} nested runtime binary/binaries...`);
  for (const { path: target, mode } of signableBinaries) {
    const isLibrary = target.endsWith(".dylib") || target.endsWith(".node");
    const needsEntitlements = !isLibrary && (mode & 0o111) !== 0;
    signTarget(target, signingIdentity, needsEntitlements ? inheritedEntitlements : undefined);
  }
}
