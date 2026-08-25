import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeDarwinEsbuildBinaries } from "../scripts/esbuild-normalization.mjs";

function writeEsbuildFixture(rootDir, relativeDir, version, contents = "wrong-architecture") {
  const packageDir = join(rootDir, relativeDir, "node_modules", "esbuild");
  mkdirSync(join(packageDir, "bin"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify({ name: "esbuild", version })}\n`, "utf8");
  writeFileSync(join(packageDir, "bin", "esbuild"), contents, "utf8");
  return join(packageDir, "bin", "esbuild");
}

test("normalizeDarwinEsbuildBinaries replaces every nested esbuild binary with the target architecture", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "paperclip-esbuild-normalization-test-"));

  try {
    const firstTarget = writeEsbuildFixture(tempRoot, "", "0.28.2");
    const secondTarget = writeEsbuildFixture(tempRoot, "node_modules/@paperclipai/adapter-utils", "0.28.2");
    const thirdTarget = writeEsbuildFixture(tempRoot, "node_modules/example", "0.27.0");
    const sourceByVersion = new Map();
    const resolveCalls = [];

    for (const version of ["0.28.2", "0.27.0"]) {
      const source = join(tempRoot, "platform-binaries", version, "esbuild");
      mkdirSync(join(tempRoot, "platform-binaries", version), { recursive: true });
      writeFileSync(source, `darwin-arm64-${version}`, "utf8");
      sourceByVersion.set(version, source);
    }

    const targets = normalizeDarwinEsbuildBinaries({
      bundleServerDir: tempRoot,
      arch: "arm64",
      resolvePlatformBinary: ({ arch, version }) => {
        resolveCalls.push({ arch, version });
        return sourceByVersion.get(version);
      },
    });

    assert.equal(targets.length, 3);
    assert.deepEqual(resolveCalls, [
      { arch: "arm64", version: "0.28.2" },
      { arch: "arm64", version: "0.27.0" },
    ]);
    assert.equal(readFileSync(firstTarget, "utf8"), "darwin-arm64-0.28.2");
    assert.equal(readFileSync(secondTarget, "utf8"), "darwin-arm64-0.28.2");
    assert.equal(readFileSync(thirdTarget, "utf8"), "darwin-arm64-0.27.0");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("normalizeDarwinEsbuildBinaries rejects unsupported architectures", () => {
  assert.throws(
    () =>
      normalizeDarwinEsbuildBinaries({
        bundleServerDir: "/unused",
        arch: "ia32",
        resolvePlatformBinary: () => "/unused",
      }),
    /Unsupported Darwin esbuild architecture/,
  );
});
