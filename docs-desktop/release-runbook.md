# Desktop Release Runbook

This is the repeatable operator guide for shipping `paperclip-desktop`.

It documents the exact release path now in use:

1. pin the desktop app to the desired upstream Paperclip version
2. build signed staged macOS artifacts locally
3. publish the signed mac release immediately if needed
4. submit the shipped mac ZIPs to Apple notarization without waiting
5. monitor notarization status separately
6. staple the approved app bundles locally
7. repackage final notarized ZIP/DMG assets from the stapled apps
8. replace the GitHub release assets with the notarized versions

This avoids:

- rebuilding a different app for notarization
- waiting on Apple during the main release path
- burning GitHub-hosted macOS minutes on long notarization waits
- accidental multi-platform release runs when only mac is needed

## Current Release Model

Current state of the repo:

- `.github/workflows/release.yml` is manual-only
- a normal tag push no longer starts a release workflow
- macOS release packaging uses the staged flow in `scripts/release-macos-local.mjs`
- notarization submission is separate from the build
- notarization status checks are separate from submission

Manual workflows available in GitHub Actions:

- `Release Desktop`
- `Submit macOS Release for Notarization`
- `Check macOS Notarization Status`

## Prerequisites

Local machine:

- macOS
- Xcode command line tools
- `pnpm`
- access to the Developer ID signing identity in Keychain
- access to the App Store Connect API key for notarization monitoring if checking locally

GitHub repository secrets:

- `APPLE_CODESIGN_IDENTITY`
- `APPLE_TEAM_ID`
- `MAC_CERTIFICATE_P12_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_P8`

Local notarization profile setup, once per machine:

```bash
xcrun notarytool store-credentials paperclip-notary \
  --key /path/to/AuthKey_<KEY_ID>.p8 \
  --key-id <KEY_ID> \
  --issuer <ISSUER_UUID>
```

Validate that setup:

```bash
xcrun notarytool history --keychain-profile paperclip-notary
```

## Step 1: Pin To The Desired Upstream Paperclip Version

Check the latest stable upstream server version:

```bash
npm view @paperclipai/server version
```

Set the desktop repo to that version:

```bash
pnpm pkg set "devDependencies.@paperclipai/server=<VERSION>"
pnpm install
```

Confirm the lockfile moved cleanly:

```bash
rg -n "<VERSION>|canary" package.json pnpm-lock.yaml
```

If you are intentionally shipping stable, there should be no lingering `canary` references in the Paperclip dependency graph.

## Step 2: Build Signed Staged macOS Artifacts Locally

Run the staged mac build locally:

```bash
pnpm release:mac:local:x64
pnpm release:mac:local:arm64
```

This produces:

- `release/local-macos/x64`
- `release/local-macos/arm64`

Expected outputs per arch:

- `.app`
- `.dmg`
- `.zip`
- `latest-mac.yml`
- `.blockmap`
- `verification-summary.json`
- `stage-manifest.json`

Verify the embedded upstream Paperclip version:

```bash
node -e "const p=require('./build/server-bundle/mac-x64/server/package.json'); console.log(p.version)"
node -e "const p=require('./build/server-bundle/mac-arm64/server/package.json'); console.log(p.version)"
```

Verify signing:

```bash
codesign -dvv 'release/local-macos/x64/mac/Paperclip Desktop.app'
codesign -dvv 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app'
```

The authority should be your `Developer ID Application` identity.

## Step 3: Publish The Signed Mac Release

If you need to release before notarization finishes, publish the signed mac assets first.

First prepare the updater-compatible release bundle:

```bash
node scripts/prepare-macos-release-assets.mjs \
  --input-root release/local-macos \
  --output-dir release/local-macos/release-assets
```

This produces one merged `latest-mac.yml` plus hyphenated asset names that match what `electron-updater` requests.

Create or update the GitHub release manually:

```bash
gh release edit v<DESKTOP_VERSION> --notes-file /path/to/notes.md

gh release upload v<DESKTOP_VERSION> \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>.dmg \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>.dmg.blockmap \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-mac.zip \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-mac.zip.blockmap \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64.dmg \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64.dmg.blockmap \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64-mac.zip \
  release/local-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64-mac.zip.blockmap \
  release/local-macos/release-assets/latest-mac.yml \
  --clobber
```

At this stage the app is:

- signed
- not yet notarized
- suitable for immediate release if needed, with the usual Gatekeeper caveat until notarization is complete

## Step 4: Submit To Apple Notarization Without Waiting

Preferred path:

- use the GitHub `Submit macOS Release for Notarization` workflow
- do not use `--wait`
- let Apple process asynchronously

Trigger it:

```bash
gh workflow run notarize-submit.yml --ref master -f tag=v<DESKTOP_VERSION>
```

Then inspect the run:

```bash
gh run list --workflow 'Submit macOS Release for Notarization' --limit 1
gh run watch <RUN_ID> --interval 10
```

This workflow:

- downloads the live release ZIP assets
- submits `x64` and `arm64` ZIPs to Apple with `--no-wait`
- stores the Apple submission IDs as an artifact

## Step 5: Monitor Apple Status

There are two valid ways to monitor.

### Option A: monitor locally

This is preferred after your local `paperclip-notary` profile is stored.

Check each submission directly:

```bash
xcrun notarytool info <X64_SUBMISSION_ID> \
  --keychain-profile paperclip-notary \
  --output-format json

xcrun notarytool info <ARM64_SUBMISSION_ID> \
  --keychain-profile paperclip-notary \
  --output-format json
```

Example loop:

```bash
while true; do
  date
  xcrun notarytool info <X64_SUBMISSION_ID> --keychain-profile paperclip-notary --output-format json | jq '{id,status}'
  xcrun notarytool info <ARM64_SUBMISSION_ID> --keychain-profile paperclip-notary --output-format json | jq '{id,status}'
  sleep 3600
done
```

Stop the loop with `Ctrl+C`.

### Option B: monitor via GitHub workflow

If the local profile is unavailable, use the manual status workflow:

```bash
gh workflow run notarize-status.yml --ref master \
  -f x64_submission_id=<X64_SUBMISSION_ID> \
  -f arm64_submission_id=<ARM64_SUBMISSION_ID>
```

Then:

```bash
gh run list --workflow 'Check macOS Notarization Status' --limit 1
gh run watch <RUN_ID> --interval 10
```

Only use this when local monitoring is not available. Local monitoring is cheaper.

## Step 6: Staple The Approved App Bundles

Once both submissions show `Accepted`, staple the exact approved app bundles:

```bash
xcrun stapler staple -v 'release/local-macos/x64/mac/Paperclip Desktop.app'
xcrun stapler validate -v 'release/local-macos/x64/mac/Paperclip Desktop.app'

xcrun stapler staple -v 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app'
xcrun stapler validate -v 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app'
```

Do not rebuild before stapling. Staple the exact app bundles that correspond to the notarized ZIP submissions.

## Step 7: Repackage Final Notarized Assets

Build final distributables from the stapled apps:

```bash
rm -rf release/notarized-macos
mkdir -p release/notarized-macos

node scripts/repackage-prebuilt-macos.mjs \
  --app 'release/local-macos/x64/mac/Paperclip Desktop.app' \
  --arch x64 \
  --output-dir 'release/notarized-macos/x64'

node scripts/repackage-prebuilt-macos.mjs \
  --app 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app' \
  --arch arm64 \
  --output-dir 'release/notarized-macos/arm64'
```

Copy the stapled `.app` bundles into those final output directories so verification can inspect the full payload:

```bash
mkdir -p 'release/notarized-macos/x64/mac' 'release/notarized-macos/arm64/mac-arm64'
ditto 'release/local-macos/x64/mac/Paperclip Desktop.app' 'release/notarized-macos/x64/mac/Paperclip Desktop.app'
ditto 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app' 'release/notarized-macos/arm64/mac-arm64/Paperclip Desktop.app'
```

Prepare the updater-compatible notarized release bundle:

```bash
node scripts/prepare-macos-release-assets.mjs \
  --input-root release/notarized-macos \
  --output-dir release/notarized-macos/release-assets
```

## Step 8: Verify The Final Notarized Outputs

Run the stapled verifier:

```bash
node scripts/verify-macos-release.mjs release/notarized-macos/x64 --require-stapled
node scripts/verify-macos-release.mjs release/notarized-macos/arm64 --require-stapled
```

Expected final output directories:

- `release/notarized-macos/x64`
- `release/notarized-macos/arm64`
- `release/notarized-macos/release-assets`

Expected final artifacts:

- `Paperclip Desktop-<DESKTOP_VERSION>.dmg`
- `Paperclip Desktop-<DESKTOP_VERSION>-mac.zip`
- `Paperclip Desktop-<DESKTOP_VERSION>-arm64.dmg`
- `Paperclip Desktop-<DESKTOP_VERSION>-arm64-mac.zip`
- `Paperclip-Desktop-<DESKTOP_VERSION>.dmg`
- `Paperclip-Desktop-<DESKTOP_VERSION>-mac.zip`
- `Paperclip-Desktop-<DESKTOP_VERSION>-arm64.dmg`
- `Paperclip-Desktop-<DESKTOP_VERSION>-arm64-mac.zip`
- `latest-mac.yml`
- `verification-summary.json`

## Step 9: Replace The GitHub Release Assets

Update release notes to reflect notarization completion, then upload the stapled assets with `--clobber`:

```bash
gh release edit v<DESKTOP_VERSION> --notes-file /path/to/notarized-notes.md

gh release upload v<DESKTOP_VERSION> \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>.dmg \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>.dmg.blockmap \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-mac.zip \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-mac.zip.blockmap \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64.dmg \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64.dmg.blockmap \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64-mac.zip \
  release/notarized-macos/release-assets/Paperclip-Desktop-<DESKTOP_VERSION>-arm64-mac.zip.blockmap \
  release/notarized-macos/release-assets/latest-mac.yml \
  --clobber
```

At that point the public release is:

- signed
- notarized
- stapled
- repackaged from the approved notarized app bundles

## Optional: Run The Build Workflow Manually

If you want GitHub to build a release manually instead of local packaging:

Mac only:

```bash
gh workflow run release.yml --ref master -f ref=v<DESKTOP_VERSION> -f platforms=mac
```

All platforms:

```bash
gh workflow run release.yml --ref master -f ref=v<DESKTOP_VERSION> -f platforms=all
```

Important:

- nothing auto-runs on tag push anymore
- manual invocation is required

## Recommended Short Path For Mac-Only Releases

For the common case, use this order:

1. pin upstream version
2. `pnpm release:mac:local:x64`
3. `pnpm release:mac:local:arm64`
4. publish signed mac release
5. submit ZIPs for notarization asynchronously
6. monitor until both are `Accepted`
7. staple local `.app` bundles
8. repackage notarized ZIP/DMG
9. prepare the merged mac updater bundle
10. replace release assets

## Guardrails

- Do not re-enable automatic tag-triggered release runs unless there is a clear reason.
- Do not wait on notarization in the main release path.
- Do not notarize both the app and the DMG in separate passes.
- Do not rebuild a different app for notarization replacement.
- Do not staple a rebuilt app that is not the one Apple accepted.
- Do not replace the release assets until the stapled outputs have passed local verification.

## File References

Primary scripts and workflows:

- `.github/workflows/release.yml`
- `.github/workflows/notarize-submit.yml`
- `.github/workflows/notarize-status.yml`
- `scripts/release-macos-local.mjs`
- `scripts/repackage-prebuilt-macos.mjs`
- `scripts/prepare-macos-release-assets.mjs`
- `scripts/verify-macos-release.mjs`

Background docs:

- `docs-desktop/macos-staged-release.md`
- `docs-desktop/release-automation-log.md`
