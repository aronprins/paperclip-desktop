# Paperclip Desktop — Architecture & Operations Guide

## Overview

Paperclip Desktop is a standalone Electron wrapper around the [Paperclip](https://github.com/paperclipai/paperclip) server. It consumes `@paperclipai/server` and related packages from npm — it does **not** contain the engine source code.

The Electron app spawns the Paperclip server as a child process and loads the UI via HTTP on localhost. It ships a bundled Node.js binary so end users don't need Node installed.

## Repository structure

```
paperclip-desktop/
  src/
    main.ts              Electron main process — window lifecycle, server spawn, splash screen
    preload.ts           Renderer preload — exposes updater IPC to the UI
    splash-preload.ts    Splash window preload — status update IPC
    updater.ts           Auto-updater — checks GitHub Releases every 4h
  scripts/
    prepare-server.mjs   Installs @paperclipai/server from npm, bundles node_modules + Node binary
    build-ui.mjs         Clones upstream repo, builds the UI, copies dist into the server bundle
    release-macos-local.mjs  Builds staged local macOS release artifacts per arch
    after-pack.mjs       Repo-root macOS afterPack hook — requires real signing identity
    stage-after-pack.mjs Staged macOS afterPack hook — signs nested runtime binaries in app-server
    dev.mjs              Dev script — compiles TS and launches Electron
  build/
    entitlements.mac.plist   macOS hardened runtime entitlements
    icon.png                 macOS/Linux app icon
    icon.ico                 Windows app icon
  .github/workflows/
    release.yml              Builds desktop binaries on v* tag push
    sync-upstream.yml        Polls npm every 6h for @paperclipai/server updates
  docs-desktop/              Documentation (this directory)
  electron-builder.yml       electron-builder config (targets, signing, publish)
  package.json               Dependencies and scripts
  tsconfig.json              TypeScript configuration
```

For the current macOS packaging flow, see `docs-desktop/macos-staged-release.md`.
For the current release automation decision log, see `docs-desktop/release-automation-log.md`.
For the repeatable operator checklist, see `docs-desktop/release-runbook.md`.

## How it works

### Packaged app (production)

```
Contents/Resources/
  app-server/
    server/
      dist/index.js      ← @paperclipai/server entry point (spawned by Electron)
      ui-dist/            ← built React UI (served by the Express server)
      node_modules/       ← all production deps (flat npm install)
      package.json
    node-bin/
      node               ← bundled Node.js v22.15.0
  app/
    dist/main.js         ← Electron main process
    dist/preload.js
    dist/updater.js
    package.json
```

1. Electron starts, creates a splash window with progress steps
2. Finds a free TCP port (starting from 3100)
3. Spawns `node server/dist/index.js` with env vars: `PORT`, `PAPERCLIP_HOME`, `PAPERCLIP_MIGRATION_AUTO_APPLY=true`, enriched `PATH`
4. Waits for the server to accept connections (60s timeout)
5. Creates the main BrowserWindow, loads `http://localhost:{port}`
6. Destroys the splash, shows the main window
7. Initialises the auto-updater (checks GitHub Releases)

### Dev mode

In dev mode (`pnpm dev`), the server is spawned from `node_modules/@paperclipai/server/dist/index.js` directly. The UI may not be available (the npm package doesn't include `ui-dist/`), so dev mode is primarily for working on the Electron shell itself. Use `pnpm pack` for full integration testing with the UI.

## Dependencies

### Runtime (bundled into the app)

| Package | Purpose |
|---------|---------|
| `tree-kill` | Kill server process tree on quit |
| `electron-updater` | Check GitHub Releases for updates, download, prompt restart |
| `electron-log` | Structured logging for the updater |

### Dev only

| Package | Purpose |
|---------|---------|
| `@paperclipai/server` | Used by `prepare-server.mjs` to resolve the version to install |
| `electron` | Electron framework |
| `electron-builder` | Packages the app for macOS/Windows/Linux |
| `typescript` | Compiles `src/*.ts` to `dist/*.js` |

`@paperclipai/server` is a **devDependency** because the Electron main process never `require()`s it. It is only referenced by `prepare-server.mjs` to know which version to install in the server bundle. At runtime, Electron spawns the bundled Node binary against the bundled `server/dist/index.js`.

## Build pipeline

### Full build (what `pnpm pack` and `pnpm dist` do)

```
pnpm build              →  tsc: compiles src/*.ts to dist/*.js
pnpm prepare-server     →  installs @paperclipai/server from npm into build/server-bundle/
                            downloads Node.js v22.15.0 binaries to build/node-bin/
                            validates migration SQL files
pnpm build-ui           →  clones upstream repo at matching tag
                            runs pnpm --filter @paperclipai/ui build
                            copies ui/dist/ into build/server-bundle/server/ui-dist/
electron-builder        →  packages everything into .dmg/.exe/.AppImage
```

### Staged macOS local release flow

The repo now uses a staged packaging flow for local macOS release work:

```bash
pnpm release:mac:local:x64
pnpm release:mac:local:arm64
```

That flow:

1. Builds the desktop TypeScript, bundled server, and bundled UI
2. Creates a temporary per-arch stage directory
3. Copies only the real runtime payload into the stage
4. Generates a minimal stage `package.json` and `electron-builder.json`
5. Installs only runtime dependencies inside the stage
6. Runs Electron Builder from the stage directory, not from the repo root
7. Exports signed local artifacts into `release/local-macos/{arch}/`
8. Verifies the built app bundle and nested native binaries with `codesign`

This is the preferred local macOS release path because it packages the exact app payload we intend to ship, while keeping the packaging surface small and auditable.

### Release automation split

The repository also now has a documented two-phase release automation model:

1. build signed staged macOS artifacts for review
2. notarize approved prebuilt macOS app bundles later

This avoids paying the notarization cost during every build verification run and prevents duplicate notarization passes on CI.

For the full rationale and operator instructions, see `docs-desktop/release-automation-log.md`.

### `scripts/prepare-server.mjs` in detail

1. Reads `@paperclipai/server` version from `package.json` devDependencies
2. Creates `build/server-staging/` with a minimal package.json
3. Runs `npm install --production` to get the server + all transitive deps
4. Copies server dist, package.json, skills, and node_modules into `build/server-bundle/server/`
5. Fixes macOS dylib soname symlinks for `@embedded-postgres` (needed by dyld)
6. Downloads Node.js v22.15.0 for current platform architectures
7. Removes macOS Finder duplicate files (iCloud sync artifacts)
8. Validates that `@paperclipai/db/dist/migrations/*.sql` files are present
9. Cleans up the staging directory

### `scripts/build-ui.mjs` in detail

1. Checks if `build/server-bundle/server/ui-dist/index.html` already exists (skip if so)
2. **Future-proof check:** tries to install `@paperclipai/ui` from npm (not published yet)
3. Falls back to cloning `paperclipai/paperclip` at the matching git tag (`v{version}`)
4. Runs `pnpm install` + `pnpm --filter @paperclipai/ui build` in the clone
5. Copies the built `ui/dist/` into the server bundle
6. Removes the clone

When `@paperclipai/ui` is eventually published to npm, step 2 will succeed and the clone step is skipped automatically.

## Auto-updater

The app uses `electron-updater` to check for new versions via GitHub Releases.

### How it works

- On app launch (after the main window shows), `initAutoUpdater()` is called
- Checks for updates immediately, then every 4 hours
- If an update is found, it auto-downloads in the background
- Once downloaded, shows a dialog: "Paperclip v{version} has been downloaded. Restart now to apply the update?"
- User can choose "Restart" (applies immediately) or "Later" (applies on next quit)
- Skipped entirely in dev mode (`!app.isPackaged`)

### How it finds updates

`electron-builder.yml` has a `publish` section:

```yaml
publish:
  provider: github
  owner: aronprins
  repo: paperclip-desktop
  releaseType: release
```

`electron-builder` generates `latest.yml` / `latest-mac.yml` / `latest-linux.yml` manifests alongside the release assets. For macOS this repo merges the per-arch outputs into one published `latest-mac.yml` so both `x64` and `arm64` installs can resolve the correct ZIP from the same GitHub release. `electron-updater` fetches these manifests to determine if a newer version is available.

### Renderer integration

The updater sends status events to the renderer via IPC:

```typescript
// In the renderer (via window.paperclip.updater):
window.paperclip.updater.onStatus((data) => {
  // data.status: "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "error"
  // data.version?: string (when status is "available" or "downloaded")
  // data.percent?: number (when status is "downloading")
});
```

## Data and state

### PAPERCLIP_HOME

The app resolves `PAPERCLIP_HOME` at startup:

1. If `~/.paperclip/instances/default/db` exists → uses `~/.paperclip` (shares data with the CLI)
2. Otherwise → uses the Electron `userData` directory (`~/Library/Application Support/Paperclip` on macOS)

This ensures the desktop app and CLI share the same database when both are installed.

### PID file

Writes `paperclip-electron.pid` to the `userData` directory. On startup, checks for an orphaned server process from a previous crash and kills it.

### Server log

Server stdout/stderr is written to `{userData}/server.log` (appended on each launch).

## PATH enrichment

Electron apps launched from Finder/Dock inherit a minimal PATH. The app:

1. Probes the user's login shell PATH (`$SHELL -lc 'echo $PATH'`)
2. Merges well-known directories: `~/.local/bin`, `~/.npm-global/bin`, NVM bin, `/opt/homebrew/bin`, etc.
3. Passes the enriched PATH to the server process

This ensures tools like `claude` CLI are discoverable by the server.

---

## Scripts reference

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Compile TS + launch Electron (dev mode, no UI) |
| `pnpm build` | Compile TypeScript only |
| `pnpm prepare-server` | Install server from npm + download Node binary |
| `pnpm build-ui` | Clone upstream + build UI |
| `pnpm pack` | Full build → packaged app in `release/` (unpacked) |
| `pnpm dist` | Full build → distributable installers in `release/` |
| `pnpm dist:mac` | Staged macOS local release flow → signed `.dmg` + `.zip` in `release/local-macos/` |
| `pnpm release:mac:local` | Build staged local macOS artifacts for both `x64` and `arm64` |
| `pnpm release:mac:local:x64` | Build staged local macOS artifacts for `x64` only |
| `pnpm release:mac:local:arm64` | Build staged local macOS artifacts for `arm64` only |
| `pnpm dist:win` | Full build → Windows NSIS + portable |
| `pnpm dist:linux` | Full build → Linux AppImage + .deb |

---

## Releases

### How automated releases work

```
┌─────────────────────────────────────────────────────────┐
│              sync-upstream (every 6h via cron)           │
│                                                         │
│  npm: @paperclipai/server → new version?                │
│       │                              │         │        │
│       │ no change            success ↓         ↓ fail   │
│       └→ skip          commit + tag v*    open issue    │
└───────────────────────────────┼──────────────────────────┘
                                │
                       push tag v*
                                │
                                ▼
┌─────────────────────────────────────────────────────────┐
│              release (triggered by v* tag)               │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐           │
│  │  macOS   │  │ Windows │  │    Linux     │           │
│  │ dmg+zip  │  │  nsis   │  │ AppImage+deb │           │
│  └────┬─────┘  └────┬────┘  └──────┬───────┘           │
│       └──────────────┼─────────────┘                    │
│                      ▼                                  │
│          GitHub Release + assets                        │
│        (latest.yml / latest-mac.yml)                    │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│            Electron app (user's machine)                │
│                                                         │
│  electron-updater checks GitHub Releases → download     │
│  → prompt "Restart to update?" → install                │
└─────────────────────────────────────────────────────────┘
```

### Creating a release manually

1. Make sure all changes are committed
2. Bump the version:
   ```bash
   pnpm version patch   # or minor/major
   ```
3. Push the tag:
   ```bash
   git push origin master --tags
   ```
4. Run the manual `release.yml` workflow when you are ready to publish binaries to GitHub Releases

### Checking for upstream updates manually

To check if a new `@paperclipai/server` version is available without waiting for the cron:

```bash
# Check what's on npm vs what's in package.json
CURRENT=$(node -p "require('./package.json').devDependencies['@paperclipai/server']")
LATEST=$(pnpm view @paperclipai/server version)
echo "Current: $CURRENT"
echo "Latest:  $LATEST"
```

To manually trigger the sync workflow from the command line:

```bash
gh workflow run sync-upstream.yml
```

Or with force (even if version hasn't changed):

```bash
gh workflow run sync-upstream.yml -f force=true
```

### Updating the upstream dependency manually

If you prefer to update manually instead of waiting for automation:

```bash
# Update to latest
pnpm pkg set "devDependencies.@paperclipai/server=$(pnpm view @paperclipai/server version)"
pnpm install

# Test the build
pnpm build && pnpm prepare-server && pnpm build-ui && pnpm pack

# If it works, commit and tag
git add -A
git commit -m "chore: sync upstream @paperclipai/server to $(pnpm view @paperclipai/server version)"
pnpm version patch
git push origin master --tags
```

### Code signing and notarization

Local macOS release builds are now signed during packaging. The staged local flow resolves a `Developer ID Application` identity from the login keychain, uses Electron Builder for normal app signing, and then verifies the finished app bundle plus the nested `app-server` runtime payload.

The local flow intentionally does **not** notarize or staple. That remains a separate approval step after artifact testing.

When enabling CI notarization later:

1. Add these secrets to the GitHub repo (Settings → Secrets → Actions):

   | Secret | Purpose |
   |--------|---------|
   | `MAC_CERTIFICATE` | Base64-encoded .p12 Apple Developer cert |
   | `MAC_CERTIFICATE_PASSWORD` | Password for the .p12 |
   | `APPLE_ID` | Apple ID email for notarization |
   | `APPLE_APP_PASSWORD` | App-specific password |
   | `APPLE_TEAM_ID` | Apple Developer Team ID |
   | `WIN_CERTIFICATE` | Base64-encoded .pfx code signing cert |
   | `WIN_CERTIFICATE_PASSWORD` | Password for the .pfx |

2. Uncomment the corresponding env vars in `.github/workflows/release.yml`

For the complete local signing and staged packaging workflow, see `docs-desktop/macos-staged-release.md`.
For the release-automation split between build verification and approved notarization, see `docs-desktop/release-automation-log.md`.

### GitHub repo setup for releases

Create these issue labels (used by the sync workflow when builds fail):
- `upstream-sync`
- `bug`

---

## Troubleshooting

### Server doesn't start

Check `~/Library/Application Support/Paperclip/server.log` (macOS) for the server output. Common issues:
- Port 3100 already in use (the app will try the next 100 ports)
- Database corruption — delete `~/.paperclip/instances/default/db/` to reset
- Migration failure — check the log for SQL errors

### Orphaned server process

If the app crashed and a server is still running:
- The app detects this on next launch via the PID file and kills it
- Manual cleanup: `kill $(cat ~/Library/Application\ Support/Paperclip/paperclip-electron.pid)`

### Build fails on macOS with codesign errors

The current staged macOS flow requires a real `Developer ID Application` identity and signs the nested runtime binaries inside `Contents/Resources/app-server`. If it fails:
- Ensure Xcode Command Line Tools are installed: `xcode-select --install`
- Ensure `security find-identity -v -p codesigning` shows a `Developer ID Application` identity
- Re-run the staged build for a single arch to isolate the issue:
  `pnpm release:mac:local:x64` or `pnpm release:mac:local:arm64`
- Check `release/local-macos/{arch}/verification-summary.json`
- See `docs-desktop/macos-staged-release.md` for the full troubleshooting flow

### UI not loading

In the packaged app, the server looks for UI files at `server/ui-dist/index.html`. If this is missing:
- Re-run `pnpm build-ui` to rebuild from upstream
- Check that the upstream tag matches the server version

---

## Future: when @paperclipai/ui is published

When the upstream project publishes `@paperclipai/ui` to npm, `scripts/build-ui.mjs` will automatically detect it and install from npm instead of cloning the repo. No code changes needed — the future-proof check is already in the script.

At that point, you can optionally simplify `build-ui.mjs` by removing the clone fallback, and add `@paperclipai/ui` as an explicit devDependency in `package.json`.
