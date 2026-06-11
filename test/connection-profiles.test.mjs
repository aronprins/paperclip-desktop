import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ConnectionStore,
  getConnectionsFilePath,
} = require("../dist/connection/profiles.js");
const { LOCAL_PROFILE_ID } = require("../dist/connection/types.js");

test("connection store persists remote profiles and startup preference", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-connections-"));
  const store = new ConnectionStore(getConnectionsFilePath(tempDir));

  const profile = store.saveRemoteProfile({
    name: "Home Server",
    remoteUrl: "https://paperclip-host.tailnet.ts.net/dashboard",
    now: "2026-04-06T10:00:00.000Z",
  });
  store.setRememberedProfile(profile.id, true);
  store.recordConnectionResult(profile.id, {
    ok: true,
    normalizedUrl: "https://paperclip-host.tailnet.ts.net/",
    origin: "https://paperclip-host.tailnet.ts.net",
    insecureTransport: false,
    paperclipDetected: true,
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    authReady: true,
    bootstrapStatus: null,
    bootstrapInviteActive: null,
    sessionState: "signed_out",
    version: "2026.403.0",
  });

  const reloaded = new ConnectionStore(getConnectionsFilePath(tempDir));
  const snapshot = reloaded.getSnapshot();

  assert.equal(snapshot.remoteProfiles.length, 1);
  assert.equal(snapshot.remoteProfiles[0].remoteUrl, "https://paperclip-host.tailnet.ts.net/");
  assert.equal(snapshot.remoteProfiles[0].lastHealth, "auth_required");
  assert.equal(reloaded.getStartupProfileId(), profile.id);
});

test("sanitizes tampered profile ids and de-duplicates on load (PD-011/PD-046)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-tampered-"));
  const filePath = getConnectionsFilePath(tempDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dupId = "11111111-1111-1111-1111-111111111111";
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      state: {},
      remoteProfiles: [
        { id: "../../../x", mode: "remote_existing", remoteUrl: "https://a.example.com" },
        { id: dupId, mode: "remote_existing", remoteUrl: "https://b.example.com" },
        { id: dupId, mode: "remote_existing", remoteUrl: "https://c.example.com" },
      ],
    }),
    "utf8",
  );

  const store = new ConnectionStore(filePath);
  const profiles = store.getSnapshot().remoteProfiles;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Tampered non-UUID id is regenerated; duplicate id collapses to one profile.
  assert.equal(profiles.length, 2);
  for (const profile of profiles) {
    assert.match(profile.id, uuid);
  }
  assert.equal(new Set(profiles.map((p) => p.id)).size, profiles.length);
});

test("preserves an unreadable connections file instead of clobbering it (PD-042)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-corrupt-"));
  const filePath = getConnectionsFilePath(tempDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{ this is not json", "utf8");

  // Loading falls back to defaults but first backs up the corrupt file.
  const store = new ConnectionStore(filePath);
  store.setChooserMode("local_embedded"); // triggers a persist()
  assert.equal(fs.existsSync(`${filePath}.bak`), true);
});

test("connection store keeps a synthetic local profile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-local-"));
  const store = new ConnectionStore(getConnectionsFilePath(tempDir));

  store.recordConnectionResult(LOCAL_PROFILE_ID, undefined, "2026-04-06T10:00:00.000Z");

  const localProfile = store.getProfile(LOCAL_PROFILE_ID);
  assert.equal(localProfile.mode, "local_embedded");
  assert.equal(localProfile.lastConnectedAt, "2026-04-06T10:00:00.000Z");
});

test("connection store duplicates and deletes remote profiles", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-dup-"));
  const store = new ConnectionStore(getConnectionsFilePath(tempDir));

  const profile = store.saveRemoteProfile({
    name: "Dev VM",
    remoteUrl: "https://dev.paperclip.internal",
  });
  const duplicate = store.duplicateRemoteProfile(profile.id, "2026-04-06T10:00:00.000Z");
  store.deleteRemoteProfile(profile.id);

  const profiles = store.listProfiles().filter((candidate) => candidate.mode === "remote_existing");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, duplicate.id);
  assert.match(profiles[0].name, /\(copy\)$/);
});

test("connection store requires explicit acknowledgement before saving an HTTP profile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-http-"));
  const store = new ConnectionStore(getConnectionsFilePath(tempDir));

  assert.throws(
    () => store.saveRemoteProfile({
      name: "Insecure",
      remoteUrl: "http://paperclip.example.com",
    }),
    /allow an insecure connection/i,
  );

  const profile = store.saveRemoteProfile({
    name: "Insecure",
    remoteUrl: "http://paperclip.example.com",
    allowInsecureHttp: true,
  });
  assert.equal(profile.allowInsecureHttp, true);

  const reloaded = new ConnectionStore(getConnectionsFilePath(tempDir));
  const saved = reloaded.getProfile(profile.id);
  assert.equal(saved.allowInsecureHttp, true);
});
