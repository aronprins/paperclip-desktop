import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareMacosReleaseAssets } from "../scripts/prepare-macos-release-assets.mjs";

function writeArchFixture(rootDir, arch, { zipName, dmgName, zipSha, dmgSha, releaseDate }) {
  const archDir = join(rootDir, arch);
  mkdirSync(archDir, { recursive: true });
  const zipUrl = zipName.replace(/[ _]+/g, "-");
  const dmgUrl = dmgName.replace(/[ _]+/g, "-");

  writeFileSync(join(archDir, zipName), `${arch}-zip\n`, "utf8");
  writeFileSync(join(archDir, `${zipName}.blockmap`), `${arch}-zip-blockmap\n`, "utf8");
  writeFileSync(join(archDir, dmgName), `${arch}-dmg\n`, "utf8");
  writeFileSync(join(archDir, `${dmgName}.blockmap`), `${arch}-dmg-blockmap\n`, "utf8");

  writeFileSync(
    join(archDir, "latest-mac.yml"),
    [
      "version: 1.2.3",
      "files:",
      `  - url: ${zipUrl}`,
      `    sha512: ${zipSha}`,
      "    size: 101",
      "    minimumSystemVersion: '13.0.0'",
      `  - url: ${dmgUrl}`,
      `    sha512: ${dmgSha}`,
      "    size: 202",
      "minimumSystemVersion: '13.0.0'",
      "stagingPercentage: 25",
      `path: ${zipUrl}`,
      `sha512: ${zipSha}`,
      `releaseDate: '${releaseDate}'`,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("prepareMacosReleaseAssets merges both architectures and preserves manifest metadata", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "paperclip-release-assets-test-"));
  const inputRoot = join(tempRoot, "input");
  const outputDir = join(tempRoot, "output");

  try {
    writeArchFixture(inputRoot, "x64", {
      zipName: "Paperclip Desktop-1.2.3-mac.zip",
      dmgName: "Paperclip Desktop-1.2.3.dmg",
      zipSha: "x64zipsha",
      dmgSha: "x64dmgsha",
      releaseDate: "2026-04-05T10:00:00.000Z",
    });

    writeArchFixture(inputRoot, "arm64", {
      zipName: "Paperclip Desktop-1.2.3-arm64-mac.zip",
      dmgName: "Paperclip Desktop-1.2.3-arm64.dmg",
      zipSha: "armzipsha",
      dmgSha: "armdmgsha",
      releaseDate: "2026-04-05T11:00:00.000Z",
    });

    prepareMacosReleaseAssets({ inputRoot, outputDir });

    const manifest = readFileSync(join(outputDir, "latest-mac.yml"), "utf8");
    assert.match(manifest, /minimumSystemVersion: 13\.0\.0/);
    assert.match(manifest, /stagingPercentage: 25/);
    assert.match(manifest, /Paperclip-Desktop-1\.2\.3-mac\.zip/);
    assert.match(manifest, /Paperclip-Desktop-1\.2\.3-arm64-mac\.zip/);
    assert.match(manifest, /releaseDate: '2026-04-05T11:00:00\.000Z'/);
    assert.match(manifest, /path: Paperclip-Desktop-1\.2\.3-mac\.zip/);

    assert.equal(readFileSync(join(outputDir, "Paperclip-Desktop-1.2.3-mac.zip"), "utf8"), "x64-zip\n");
    assert.equal(readFileSync(join(outputDir, "Paperclip-Desktop-1.2.3-arm64-mac.zip"), "utf8"), "arm64-zip\n");
    assert.equal(readFileSync(join(outputDir, "Paperclip-Desktop-1.2.3-mac.zip.blockmap"), "utf8"), "x64-zip-blockmap\n");
    assert.equal(readFileSync(join(outputDir, "Paperclip-Desktop-1.2.3-arm64-mac.zip.blockmap"), "utf8"), "arm64-zip-blockmap\n");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("prepareMacosReleaseAssets rejects mismatched preserved metadata", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "paperclip-release-assets-test-"));
  const inputRoot = join(tempRoot, "input");
  const outputDir = join(tempRoot, "output");

  try {
    writeArchFixture(inputRoot, "x64", {
      zipName: "Paperclip Desktop-1.2.3-mac.zip",
      dmgName: "Paperclip Desktop-1.2.3.dmg",
      zipSha: "x64zipsha",
      dmgSha: "x64dmgsha",
      releaseDate: "2026-04-05T10:00:00.000Z",
    });

    writeArchFixture(inputRoot, "arm64", {
      zipName: "Paperclip Desktop-1.2.3-arm64-mac.zip",
      dmgName: "Paperclip Desktop-1.2.3-arm64.dmg",
      zipSha: "armzipsha",
      dmgSha: "armdmgsha",
      releaseDate: "2026-04-05T11:00:00.000Z",
    });

    writeFileSync(
      join(inputRoot, "arm64", "latest-mac.yml"),
      readFileSync(join(inputRoot, "arm64", "latest-mac.yml"), "utf8").replace("stagingPercentage: 25", "stagingPercentage: 50"),
      "utf8",
    );

    assert.throws(
      () => prepareMacosReleaseAssets({ inputRoot, outputDir }),
      /different stagingPercentage values/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
