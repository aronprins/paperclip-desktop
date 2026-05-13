# Desktop Release Runbook

This is the repeatable operator guide for shipping `paperclip-desktop`.

It documents the safe default stable release path now in use:

1. set the desktop version and pin the desired upstream Paperclip version
2. build signed staged macOS artifacts locally
3. verify the exact built artifacts locally
4. create or update a draft GitHub release for staging
5. submit the staged mac ZIPs to Apple notarization without waiting
6. monitor notarization status separately
7. staple the approved app bundles locally
8. repackage final notarized ZIP/DMG assets from the stapled apps
9. replace the draft release assets with the notarized versions
10. publish the release only after the final notarized assets are uploaded

This avoids:

- rebuilding a different app for notarization
- waiting on Apple during the main release path
- burning GitHub-hosted macOS minutes on long notarization waits
- accidental multi-platform release runs when only mac is needed
- exposing pre-notarized builds to auto-update users

## Current Release Model

Current state of the repo:

- `.github/workflows/release.yml` is manual-only
- a normal tag push no longer starts a release workflow
- macOS release packaging uses the staged flow in `scripts/release-macos-local.mjs`
- notarization submission is separate from the build
- notarization status checks are separate from submission
- `latest-mac.yml` is the mac auto-update activation switch and must only be published with the final notarized assets

Safe default policy for stable mac releases:

- do the mac build locally with the staged flow
- create a draft GitHub release for notarization staging
- do not publish `latest-mac.yml` before notarization is complete
- do not publish the GitHub release before the final notarized assets are uploaded
- treat any pre-notarization release assets as internal staging assets only
- use `scripts/publish-macos-release-assets.mjs` for mac GitHub release uploads so staging uploads cannot accidentally include `latest-mac.yml`

Manual workflows available in GitHub Actions:

- `Release Desktop`
- `Submit macOS Release for Notarization`
- `Check macOS Notarization Status`

## Release Notes Style

For stable releases, use short user-friendly GitHub release notes rather than an internal changelog dump.

Default style:

- one short opening sentence about the release
- a `What’s new` section with the most user-visible changes
- the bundled upstream Paperclip version
- a short macOS trust/distribution note
- an optional rollout note if `stagingPercentage` is being used

Use plain language. Prefer user impact over implementation detail.

Recommended draft release notes template:

```md
Paperclip Desktop <DESKTOP_VERSION>

This release is being prepared for public launch.

What’s new:
- <user-facing improvement 1>
- <user-facing improvement 2>
- <user-facing improvement 3>

Bundled upstream Paperclip:
- <UPSTREAM_VERSION>

Status:
- macOS assets are signed and in notarization staging
```

Recommended final release notes template:

```md
Paperclip Desktop <DESKTOP_VERSION>

This release improves reliability and polish across the desktop app, with a safer and more stable update experience on macOS.

What’s new:
- <user-facing improvement 1>
- <user-facing improvement 2>
- <user-facing improvement 3>

Bundled upstream Paperclip:
- <UPSTREAM_VERSION>

macOS:
- Signed with Developer ID
- Notarized by Apple
- Stapled and repackaged from the approved notarized app bundles
```

If a staged rollout is being used, append:

```md
Rollout:
- This update is rolling out gradually to macOS users.
```

Avoid:

- internal implementation details unless they matter to end users
- commit-by-commit summaries
- workflow or CI details
- mentioning draft or staging mechanics in the final public release notes

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

## Step 1: Set Desktop And Upstream Versions

Check the latest stable upstream server version:

```bash
npm view @paperclipai/server version
```

Set the desktop app version and the upstream Paperclip version:

```bash
pnpm pkg set "version=<DESKTOP_VERSION>"
pnpm pkg set "devDependencies.@paperclipai/server=<UPSTREAM_VERSION>"
pnpm install
```

Confirm the package metadata and lockfile moved cleanly:

```bash
rg -n "\"version\": \"<DESKTOP_VERSION>\"|<UPSTREAM_VERSION>|canary" package.json pnpm-lock.yaml
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

## Step 3: Verify The Exact Built Artifacts Locally

Before anything is uploaded:

- launch and test the exact packaged `.app` bundles
- confirm the upstream Paperclip version in the built payload
- confirm the app version shown in the bundle metadata matches `package.json`
- confirm signatures are valid on both architectures

Do not submit or publish artifacts you have not tested locally.

## Step 4: Create A Draft GitHub Release For Staging

Create and push the release tag before attempting the draft release upload:

```bash
git tag -a v<DESKTOP_VERSION> -m "v<DESKTOP_VERSION>"
git push origin v<DESKTOP_VERSION>
```

The mac release upload script creates the draft release with `gh release create --verify-tag`, so the tag must already exist on GitHub.

Prepare the release-asset bundle that uses the public updater-compatible file names:

```bash
node scripts/prepare-macos-release-assets.mjs \
  --input-root release/local-macos \
  --output-dir release/local-macos/release-assets
```

This produces one merged `latest-mac.yml` plus hyphenated asset names that match what `electron-updater` requests.

Create or update a draft GitHub release and upload only the staging-safe assets:

```bash
pnpm publish-release-assets:mac -- \
  --mode staging \
  --tag v<DESKTOP_VERSION> \
  --input-dir release/local-macos/release-assets \
  --notes-file /path/to/draft-notes.md
```

At this stage the release must remain a draft.

Do not upload `latest-mac.yml` yet.

Why:

- signed
- not yet notarized
- not safe for public auto-update discovery yet
- the notarization submit workflow only needs the ZIP assets from the draft release

`latest-mac.yml` is what makes mac auto-update discover the release. Publishing it too early can cause clients to download a signed but not-yet-notarized build.

## Step 5: Submit To Apple Notarization Without Waiting

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

- downloads the draft release ZIP assets
- submits `x64` and `arm64` ZIPs to Apple with `--no-wait`
- stores the Apple submission IDs as an artifact

## Step 6: Monitor Apple Status

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

## Step 7: Staple The Approved App Bundles

Once both submissions show `Accepted`, staple the exact approved app bundles:

```bash
xcrun stapler staple -v 'release/local-macos/x64/mac/Paperclip Desktop.app'
xcrun stapler validate -v 'release/local-macos/x64/mac/Paperclip Desktop.app'

xcrun stapler staple -v 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app'
xcrun stapler validate -v 'release/local-macos/arm64/mac-arm64/Paperclip Desktop.app'
```

Do not rebuild before stapling. Staple the exact app bundles that correspond to the notarized ZIP submissions.

## Step 8: Repackage Final Notarized Assets

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

This is the first point at which `latest-mac.yml` is allowed to be published.

Optional staged rollout:

If you want the new stable version to reach only a subset of users at first, set a rollout percentage while generating the final merged `latest-mac.yml`:

```bash
node scripts/prepare-macos-release-assets.mjs \
  --input-root release/notarized-macos \
  --output-dir release/notarized-macos/release-assets \
  --staging-percentage 10
```

Example values:

- `10` for a 10% rollout
- `25` for a 25% rollout
- `100` for full rollout

Only change the rollout percentage on the final notarized release assets.

## Step 9: Verify The Final Notarized Outputs

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

## Step 10: Replace The Draft Release Assets And Publish The Release

Update release notes to reflect notarization completion, upload the stapled assets including `latest-mac.yml`, then publish the draft release:

```bash
pnpm publish-release-assets:mac -- \
  --mode final \
  --tag v<DESKTOP_VERSION> \
  --input-dir release/notarized-macos/release-assets \
  --notes-file /path/to/final-notes.md \
  --publish
```

At that point the public release is:

- signed
- notarized
- stapled
- repackaged from the approved notarized app bundles
- visible to auto-update clients only after the final notarized assets exist

## Optional: Run The Build Workflow Manually For Verification Only

If you want GitHub to build artifacts manually instead of local packaging, use the workflow for verification builds only.

For stable mac releases, do not use `Release Desktop` against a version tag before final notarized assets are ready. If you run it with `ref=v<DESKTOP_VERSION>`, the workflow can publish release assets too early.

Safe uses:

Mac only:

```bash
gh workflow run release.yml --ref master -f ref=<NON_TAG_REF> -f platforms=mac
```

Windows only:

```bash
gh workflow run release.yml --ref master -f ref=<NON_TAG_REF> -f platforms=windows
```

Linux only:

```bash
gh workflow run release.yml --ref master -f ref=<NON_TAG_REF> -f platforms=linux
```

All platforms:

```bash
gh workflow run release.yml --ref master -f ref=<NON_TAG_REF> -f platforms=all
```

Important:

- nothing auto-runs on tag push anymore
- manual invocation is required
- use non-tag refs for verification-only builds
- stable mac releases should follow the draft-release flow in this runbook instead of tag-publishing from the workflow
- the workflow no longer publishes when mac artifacts are included in the run

## Recommended Short Path For Mac-Only Releases

For the common case, use this order:

1. set the desktop version and upstream version
2. `pnpm release:mac:local:x64`
3. `pnpm release:mac:local:arm64`
4. test the exact local `.app` bundles
5. create and push `v<DESKTOP_VERSION>`
6. prepare `release/local-macos/release-assets`
7. create or update a draft release and upload ZIP/DMG assets only
8. submit ZIPs for notarization asynchronously
9. monitor until both are `Accepted`
10. staple the exact local `.app` bundles
11. repackage notarized ZIP/DMG
12. prepare the final merged mac updater bundle, optionally with `--staging-percentage <N>`
13. upload final assets including `latest-mac.yml`
14. publish the draft release

## Guardrails

- Do not re-enable automatic tag-triggered release runs unless there is a clear reason.
- Do not wait on notarization in the main release path.
- Do not notarize both the app and the DMG in separate passes.
- Do not rebuild a different app for notarization replacement.
- Do not staple a rebuilt app that is not the one Apple accepted.
- Do not publish macOS assets until `scripts/verify-macos-release.mjs` passes for each architecture; it verifies that packaged native Mach-O payloads match the bundled Node architecture, which catches cases like an arm64 app shipping an x64 `.node` binding.
- Do not publish macOS assets unless the verifier confirms `Contents/Resources/app-server/server/ui-dist/index.html` is present; missing UI assets make the server boot in API-only mode and Electron shows a 404 error page.
- Do not publish `latest-mac.yml` until the stapled outputs have passed local verification.
- Do not publish a stable GitHub release before the final notarized assets are uploaded.
- Do not use a public release plus `latest-mac.yml` as a staging mechanism.
- Do not run `Release Desktop` against a stable version tag unless you intentionally want it to publish final release assets.
- Do not change `stagingPercentage` on pre-notarization assets.

## File References

Primary scripts and workflows:

- `.github/workflows/release.yml`
- `.github/workflows/notarize-submit.yml`
- `.github/workflows/notarize-status.yml`
- `scripts/release-macos-local.mjs`
- `scripts/repackage-prebuilt-macos.mjs`
- `scripts/prepare-macos-release-assets.mjs`
- `scripts/publish-macos-release-assets.mjs`
- `scripts/verify-macos-release.mjs`

Background docs:

- `docs/development/macos-staged-release.md`
- `docs/development/release-automation-log.md`
