import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DESKTOP_USER_DATA_DIR_ENV,
  PAPERCLIP_HOME_ENV,
  REQUIRE_ISOLATED_DATA_ENV,
  applyDesktopUserDataOverride,
  assertIsolatedRuntimePaths,
  productionPaperclipDataPaths,
  resolvePaperclipHomePath,
} = require("../dist/runtime-safety.js");

test("desktop user data override sets Electron userData before startup", () => {
  const override = path.join(process.cwd(), "tmp", "user-data");
  const calls = [];
  const app = {
    getPath() {
      throw new Error("getPath should not be called");
    },
    setPath(name, value) {
      calls.push({ name, value });
    },
  };

  const result = applyDesktopUserDataOverride(app, {
    [DESKTOP_USER_DATA_DIR_ENV]: override,
  });

  assert.equal(result, override);
  assert.deepEqual(calls, [{ name: "userData", value: override }]);
});

test("runtime path overrides must be absolute", () => {
  const app = {
    getPath() {
      throw new Error("getPath should not be called");
    },
    setPath() {
      throw new Error("setPath should not be called");
    },
  };

  assert.throws(
    () => applyDesktopUserDataOverride(app, { [DESKTOP_USER_DATA_DIR_ENV]: "relative/path" }),
    /absolute path/i,
  );
  assert.throws(
    () => resolvePaperclipHomePath({
      env: { [PAPERCLIP_HOME_ENV]: "relative/path" },
      homePath: "/tmp/home",
      userDataPath: "/tmp/user-data",
    }),
    /absolute path/i,
  );
});

test("PAPERCLIP_HOME override wins over legacy default home detection", () => {
  const override = path.join(process.cwd(), "tmp", "paperclip-home");
  const resolved = resolvePaperclipHomePath({
    env: { [PAPERCLIP_HOME_ENV]: override },
    homePath: "/Users/example",
    userDataPath: "/Users/example/Library/Application Support/Paperclip",
    pathExists: () => true,
  });

  assert.equal(resolved, override);
});

test("legacy PAPERCLIP_HOME fallback is unchanged without override", () => {
  const resolvedExisting = resolvePaperclipHomePath({
    env: {},
    homePath: "/Users/example",
    userDataPath: "/Users/example/Library/Application Support/Paperclip",
    pathExists: (target) => target.endsWith("/.paperclip/instances/default/db"),
  });
  const resolvedMissing = resolvePaperclipHomePath({
    env: {},
    homePath: "/Users/example",
    userDataPath: "/Users/example/Library/Application Support/Paperclip",
    pathExists: () => false,
  });

  assert.equal(resolvedExisting, "/Users/example/.paperclip");
  assert.equal(resolvedMissing, "/Users/example/Library/Application Support/Paperclip");
});

test("isolated data mode requires both explicit data roots", () => {
  assert.throws(
    () => assertIsolatedRuntimePaths({
      env: { [REQUIRE_ISOLATED_DATA_ENV]: "1" },
      userDataPath: "/tmp/user-data",
      paperclipHome: "/tmp/paperclip-home",
      homePath: "/Users/example",
      platform: "darwin",
    }),
    /requires both/i,
  );
});

test("isolated data mode rejects production Paperclip paths", () => {
  const homePath = "/Users/example";
  const [productionUserData] = productionPaperclipDataPaths("darwin", homePath);

  assert.throws(
    () => assertIsolatedRuntimePaths({
      env: {
        [REQUIRE_ISOLATED_DATA_ENV]: "1",
        [DESKTOP_USER_DATA_DIR_ENV]: productionUserData,
        [PAPERCLIP_HOME_ENV]: "/tmp/paperclip-home",
      },
      userDataPath: productionUserData,
      paperclipHome: "/tmp/paperclip-home",
      homePath,
      platform: "darwin",
    }),
    /refused to use production Paperclip data path/i,
  );
});

test("isolated data mode requires actual paths to match overrides", () => {
  assert.throws(
    () => assertIsolatedRuntimePaths({
      env: {
        [REQUIRE_ISOLATED_DATA_ENV]: "1",
        [DESKTOP_USER_DATA_DIR_ENV]: "/tmp/paperclip-smoke/user-data",
        [PAPERCLIP_HOME_ENV]: "/tmp/paperclip-smoke/paperclip-home",
      },
      userDataPath: "/tmp/other-user-data",
      paperclipHome: "/tmp/paperclip-smoke/paperclip-home",
      homePath: "/Users/example",
      platform: "darwin",
    }),
    /expected userData/i,
  );
});

test("isolated data mode allows explicit temporary roots", () => {
  assert.doesNotThrow(() => assertIsolatedRuntimePaths({
    env: {
      [REQUIRE_ISOLATED_DATA_ENV]: "1",
      [DESKTOP_USER_DATA_DIR_ENV]: "/tmp/paperclip-smoke/user-data",
      [PAPERCLIP_HOME_ENV]: "/tmp/paperclip-smoke/paperclip-home",
    },
    userDataPath: "/tmp/paperclip-smoke/user-data",
    paperclipHome: "/tmp/paperclip-smoke/paperclip-home",
    homePath: "/Users/example",
    platform: "darwin",
  }));
});
