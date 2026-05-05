# PRD: Windows Release Readiness

## Summary

Paperclip Desktop can already target Windows in Electron Builder, but the repository is not yet ready for a proper public Windows release. The current state is build-capable rather than release-capable: there is a Windows packaging target, a Windows CI build job, and cross-platform runtime code, but there is no Windows-specific signing, verification, operator runbook, or release-quality validation flow.

This PRD defines the work required to ship a supported Windows release that users can install, trust, update, and recover from reliably.

For the concrete signing setup tutorial, see `docs/development/windows-signing-guide.md`.

## Problem

The macOS release path has received most of the repository's release engineering work. Windows currently lacks the same depth of packaging hardening, verification, support documentation, and release operations. Shipping an unsigned or lightly-tested `.exe` would create avoidable trust, support, and update problems.

## Objective

Ship a stable `x64` Windows release of Paperclip Desktop that:

- installs cleanly via a signed NSIS installer
- launches the bundled Paperclip server successfully on clean Windows machines
- persists user data in a well-defined location
- supports in-app updates through GitHub Releases
- has a documented release and support workflow

## Non-Goals

- Windows ARM64 support in the first release
- MSI, AppX, or Microsoft Store distribution in the first release
- feature parity work unrelated to packaging, startup, updates, or supportability
- a bespoke Windows-only UI or platform-specific product surface

## Users

- Paperclip users on Windows who want a one-click install
- maintainers who need a repeatable, low-risk Windows release process
- support operators who need clear locations for logs, data, and known failure modes

## Current State

The repository already has:

- a Windows target in `electron-builder.yml`
- a `pnpm dist:win` script
- a Windows CI build job in `.github/workflows/release.yml`
- server bundling logic in `scripts/prepare-server.mjs` that handles `win32`
- runtime logic in `src/main.ts` that can use a bundled `node.exe`

The repository does not yet have:

- Windows code-signing in CI
- Windows artifact verification after packaging
- Windows-specific smoke tests
- a Windows release runbook
- a Windows troubleshooting guide
- a Windows-only release path that is independent from the mac flow

## Requirements

### 1. Packaging and Installer

- Produce a signed NSIS installer for `x64`.
- Decide whether the portable build is supported, experimental, or removed from the public release.
- Ensure installer branding is complete and consistent.
- Confirm uninstall behavior preserves or removes app data according to an explicit product decision.

### 2. Runtime Reliability

- The packaged app must launch on a clean Windows machine without a local Node installation.
- The bundled server must start successfully with the bundled `node.exe`.
- Embedded Postgres and other native dependencies must work in the packaged Windows app.
- Quit and crash recovery behavior must be validated, including orphan cleanup and PID handling.

### 3. Windows Environment Handling

- Define the canonical Windows data directory for `PAPERCLIP_HOME`.
- Decide whether to reuse an existing CLI `.paperclip` home on Windows and implement it intentionally.
- Replace Unix/mac-oriented path assumptions with Windows-aware behavior where needed.
- Make PATH enrichment work with common Windows CLI install locations when the upstream server needs local tools.

### 4. Signing and Trust

- Add Windows certificate handling to CI.
- Use Authenticode signing for the installer and any shipped executable artifacts that need signing.
- Timestamp Windows signatures during signing.
- Verify signatures in CI after packaging.
- Document SmartScreen reputation behavior so signed builds are not mistaken for fully reputation-cleared builds on day one.
- Decide whether the release should use OV or EV signing based on cost, operator complexity, and trust goals.
- Document certificate setup and rotation requirements.

### 5. Updates

- Confirm that the published Windows assets match what `electron-updater` expects on Windows.
- Validate update download and install behavior from one released version to another.
- Document whether updates are supported for NSIS only or also for portable builds.

### 6. QA and Release Validation

- Add a Windows smoke-test checklist or automated verification step.
- Validate install, launch, update, relaunch, uninstall, and reinstall flows.
- Test on at least one clean Windows 11 environment before the first public release.
- Capture server logs and startup failures in a supportable location.

### 7. Documentation and Operations

- Add a Windows release runbook.
- Add a Windows troubleshooting guide.
- Update README and release messaging from "coming soon" to supported once release criteria are met.
- Document scope for the first release: architecture, installer type, and known limitations.

## Release Gates

The Windows release is ready only when all of the following are true:

- CI produces signed Windows artifacts successfully.
- A clean-machine install and first launch succeeds.
- The app reaches the Paperclip UI without requiring a preinstalled Node runtime.
- Auto-update is validated between two real release versions.
- Uninstall and reinstall behavior is understood and documented.
- Operator docs exist for release, rollback, logs, and user support.

## Workstreams

### Workstream A: Windows packaging hardening

- finalize installer target and public artifact set
- remove ambiguity around portable support
- verify packaged native runtime dependencies

### Workstream B: Windows runtime correctness

- fix `HOME` and shell-path assumptions in the Electron main process
- define Windows data and log locations
- validate orphan cleanup and shutdown flow

### Workstream C: Signing and CI

- add Windows cert secrets and signing configuration
- sign and verify Windows artifacts in CI
- add timestamping as part of the signing flow
- document SmartScreen expectations for maintainers and support
- support Windows-only release execution when needed

### Workstream D: QA and docs

- add smoke-test coverage
- write Windows runbook and troubleshooting docs
- update public-facing release documentation

## Risks

- Native dependencies may package successfully but fail at runtime on clean Windows systems.
- Unsigned builds will trigger SmartScreen trust issues and increase support burden.
- Portable builds may create support ambiguity if update and data behavior are not explicitly defined.
- Current Unix/mac assumptions in `src/main.ts` may lead to degraded Windows behavior even if startup succeeds.

## Success Metrics

- First public Windows release installs and launches successfully for test users on clean Windows 11 machines.
- No blocker-level startup failures are found during release validation.
- Update from version N to N+1 succeeds in a signed release path.
- Support docs are sufficient to diagnose install, launch, and update issues without source diving.

## Milestones

### Milestone 1: Build confidence

- package Windows app locally and in CI
- verify bundled runtime contents
- confirm server startup on Windows

### Milestone 2: Release confidence

- add signing
- add artifact verification
- validate updater behavior

### Milestone 3: Public readiness

- complete operator docs
- update README and release messaging
- publish first supported Windows release

## Resolved Decisions

These were Open Questions when this PRD was written. They are now resolved by what `electron-builder.yml` and `src/main.ts` actually ship today.

- **Portable artifact**: shipped alongside NSIS as `Paperclip-Desktop-Portable-${version}.exe`. Auto-update is wired only on the NSIS channel via `electron-updater`; the portable artifact is intentionally update-free and is treated as a "run-from-anywhere" fallback rather than a supported daily-use distribution.
- **Install scope**: per-user. `electron-builder.yml` sets `nsis.perMachine: false`, so installation lands under `%LOCALAPPDATA%\Programs\paperclip-desktop` and never prompts for UAC. Per-machine install is explicitly out of scope for v1.
- **Native runtime**: bundled `node.exe` only. `findNodeBinary()` looks for the bundled binary first and falls back to `node.exe` on PATH; no Windows-specific CLI discovery is performed and `resolveShellPath()` short-circuits to the existing `process.env.PATH` on `win32`.
- **CLI home reuse**: yes, opt-in by directory presence. `resolvePaperclipHome()` reuses `%USERPROFILE%\.paperclip` if `instances/default/db` already exists there (so existing Paperclip CLI users keep their data), otherwise it isolates desktop data under `%APPDATA%\Paperclip` (`app.getPath("userData")`).
- **Repair, logs, and uninstall affordances**: surfaced in the Help menu — `Open Application Logs`, `Reset Local Data (Repair)…`, and (Windows-only) `Uninstall Paperclip…`. The NSIS uninstaller adds an opt-in "also delete user data" prompt that defaults to No and is suppressed during silent updater self-replace via `${isUpdated}`.

## Open Questions

- Should v1 use Azure Artifact Signing or fall back to OV `.pfx` signing while identity validation completes? Both paths are documented in `docs/development/windows-signing-guide.md`; the actual choice depends on operator preference and certificate availability.
- Should the bundled `node.exe` and the `@embedded-postgres/windows-x64` native binaries be re-signed with the Paperclip publisher certificate, or is upstream Microsoft / npm signing sufficient for SmartScreen reputation?
- MSI / AppX / Microsoft Store distribution remains explicitly out of scope for v1, but should be revisited once SmartScreen reputation is established on the NSIS channel.
