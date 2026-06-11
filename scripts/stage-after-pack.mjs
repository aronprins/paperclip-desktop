import { execFileSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

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

function stripBundleMetadata(appPath) {
  removeBrokenSymlinks(join(appPath, "Contents"));

  try {
    execFileSync("dot_clean", [appPath]);
  } catch {
    // Best effort only.
  }

  removeAppleMetadataFiles(appPath);
  clearExtendedAttributes(appPath);
}

function removeAppleMetadataFiles(dir) {
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

    if (entry.startsWith("._") || entry === ".DS_Store") {
      rmSync(full, { recursive: true, force: true });
      continue;
    }

    if (stat.isDirectory()) {
      removeAppleMetadataFiles(full);
    }
  }
}

function clearExtendedAttributes(dir) {
  if (!existsSync(dir)) return;

  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) return;

  try {
    execFileSync("xattr", ["-c", dir], { stdio: "ignore" });
  } catch {
    // Best effort only.
  }

  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(dir)) {
    clearExtendedAttributes(join(dir, entry));
  }
}

function dereferenceSymlinks(dir) {
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
      const resolved = target.startsWith("/") ? target : join(dirname(full), target);
      if (!existsSync(resolved)) {
        rmSync(full, { force: true });
        continue;
      }

      rmSync(full, { force: true });
      cpSync(resolved, full, {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
      });
      continue;
    }

    if (stat.isDirectory()) {
      dereferenceSymlinks(full);
    }
  }
}

function copyServerNodeModules(context, appServerPath) {
  const source = join(context.packager.projectDir, "app-server", "server", "node_modules");
  const target = join(appServerPath, "server", "node_modules");

  if (!existsSync(source)) {
    throw new Error(`Missing staged server node_modules at ${source}`);
  }

  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });
  dereferenceSymlinks(target);
  removeBrokenSymlinks(target);
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

    const looksNative = entry.endsWith(".dylib") || entry.endsWith(".node") || entry.endsWith(".bare") || (stat.mode & 0o111) !== 0;
    if (!looksNative || !isMachOBinary(full)) continue;

    out.push({ path: full, mode: stat.mode });
  }

  return out;
}

function signTarget(target, identity, entitlements) {
  const args = ["--force", "--options", "runtime"];
  args.push("--timestamp");
  args.push("--sign", identity);
  if (entitlements) {
    args.push("--entitlements", entitlements);
  }
  args.push(target);

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

  if (!signingIdentity) {
    throw new Error("staged macOS release signing requires APPLE_CODESIGN_IDENTITY or CSC_NAME.");
  }

  stripBundleMetadata(appPath);

  if (!existsSync(appServerPath)) {
    return;
  }

  copyServerNodeModules(context, appServerPath);

  const signableBinaries = collectSignableBinaries(appServerPath).sort((left, right) => {
    const leftIsLibrary = left.path.endsWith(".dylib") || left.path.endsWith(".node") || left.path.endsWith(".bare");
    const rightIsLibrary = right.path.endsWith(".dylib") || right.path.endsWith(".node") || right.path.endsWith(".bare");
    if (leftIsLibrary !== rightIsLibrary) return leftIsLibrary ? -1 : 1;

    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    return rightDepth - leftDepth;
  });

  for (const { path: target, mode } of signableBinaries) {
    const isLibrary = target.endsWith(".dylib") || target.endsWith(".node") || target.endsWith(".bare");
    const needsEntitlements = !isLibrary && (mode & 0o111) !== 0;
    signTarget(target, signingIdentity, needsEntitlements ? inheritedEntitlements : undefined);
  }
}
