# Windows Troubleshooting Guide

Support-oriented guide for diagnosing Paperclip Desktop install, boot, and shutdown problems on Windows. The affordances described here ship in the app as of the Windows release work in `docs/prds/windows-release.md`.

## Where Logs Live

Paperclip writes two log streams on Windows. Both are useful, but the inner server log is the one that contains real boot errors and stack traces.

| Log | Path | What it contains |
| --- | --- | --- |
| Electron-side | `%APPDATA%\Paperclip\server.log` | One block per boot attempt: which `node.exe` was used, which server entrypoint was spawned, and a copy of every line emitted on stdout/stderr by the spawned server. |
| Server-side (pino) | `%USERPROFILE%\.paperclip\instances\default\logs\server.log` (or `%APPDATA%\Paperclip\instances\default\logs\server.log` if `~/.paperclip` is not in use) | The bundled `@paperclipai/server` writes here through pino. This is the only place you will see embedded-postgres init errors, migration failures, and most native-binary blocked-by-AV traces. |

The fastest way to open both is `Help → Open Application Logs` from the Paperclip menu bar. That opens `%APPDATA%\Paperclip` in Explorer; the server-side logs live one level deeper under `instances\default\logs`.

## Repair Flow

If Paperclip is stuck on a corrupt local database, an aborted migration, or a broken settings file, use `Help → Reset Local Data (Repair)…`. The dialog confirms exactly what will be deleted, then:

1. Stops the embedded server (`treeKill` of the spawned `node.exe` and its postgres child).
2. Recursively deletes `%APPDATA%\Paperclip` and `%USERPROFILE%\.paperclip`.
3. Relaunches Paperclip from scratch.

This is the same data the NSIS uninstaller's "also delete user data" prompt removes. Saved remote profiles, cached sessions, and the embedded postgres database are lost. Remote sign-ins on saved profiles will need to be repeated.

## Uninstall Flow

`Help → Uninstall Paperclip…` confirms intent, kills the embedded server, then hands off to the NSIS uninstaller (`Uninstall Paperclip Desktop.exe`) sitting next to the app `.exe`.

The uninstaller adds a second prompt: *"Also delete Paperclip's local data?"*. It defaults to **No** so a routine uninstall preserves data for a future reinstall. Choosing Yes wipes:

- `%APPDATA%\Paperclip`
- `%LOCALAPPDATA%\Paperclip`
- `%USERPROFILE%\.paperclip`

This prompt is **suppressed during silent updates** (the updater's own self-replace flow runs the uninstaller silently). The suppression is implemented in `build/installer.nsh` via the `${isUpdated}` guard, so installing a newer version on top of an older one will never accidentally wipe a user's databases.

If you launched the **portable** build, there is no uninstaller — delete the `.exe` to remove the app. Local data still lives at the paths above and must be cleared by hand if you no longer want it.

## Boot Error Dialogs

The app does an install pre-flight check before spawning the embedded server. Each pre-flight failure produces a structured dialog with a specific title; the table below maps those titles to the most likely causes and the right fix.

| Dialog title | Likely cause | Fix |
| --- | --- | --- |
| **Bundled Node.js runtime is missing** | Antivirus quarantined `resources\app-server\node-bin\node.exe`, or the install is partial. | Whitelist the install folder (`%LOCALAPPDATA%\Programs\paperclip-desktop` for per-user installs) in your AV product, then reinstall Paperclip. |
| **Server bundle is missing** | The `resources\app-server\server\dist` folder was deleted or never extracted (interrupted install, disk full during install). | Reinstall Paperclip from the same NSIS installer. |
| **Local data directory is not writable** | `%USERPROFILE%\.paperclip` or `%APPDATA%\Paperclip` is on a OneDrive-synced path that is currently read-only, or the parent folder permissions block writes. | Pause OneDrive sync on the affected folder, fix folder permissions, or set the `PAPERCLIP_HOME` environment variable to a writable directory and restart Paperclip. |
| **Could not launch the embedded server process** | The OS rejected the `spawn()` call, usually because AV blocked execution of the bundled `node.exe` even though it is readable. | Whitelist the install folder, including `resources\app-server\node-bin\node.exe`, then relaunch. |
| **Server failed to start in time** | First-run boot exceeded 5 minutes (unusual). On Windows, embedded-postgres `initdb` plus 75 schema migrations normally takes 90–180 seconds with Defender enabled, so timing out means something deeper is stuck. | Check the inner log tail shown in the dialog. The most common deeper causes are AV scanning every postgres binary on startup and a stale postgres process holding the port — reboot or kill stray `postgres.exe` processes via Task Manager and try again. |
| **Server crashed during startup** | The spawned `node.exe` exited before opening port `3100`. Almost always means a native binary in `@embedded-postgres\windows-x64\native\bin\*.exe` was blocked, removed, or crashed. | Check the dialog tail for the embedded-postgres error. Whitelist `resources\app-server\server\node_modules\@embedded-postgres\windows-x64\native\bin\*.exe` in your AV product. |

The dialog tail in the last two rows is the last ~2 KB of the **server-side pino log**, not the Electron log. That is intentional: the pino log is the one that contains the actual cause when boot fails.

## Common Non-Dialog Issues

Some problems do not surface as a labelled dialog. The patterns below are worth checking before filing an issue.

### Console window flashes on every launch

Should not happen on current builds — `windowsHide: true` is set on the embedded-server spawn. If it does, you are probably running a build older than the Windows reliability update; upgrade to the latest release.

### Update check downloads but never installs

`electron-updater` only handles the **NSIS** artifact; the portable build is intentionally update-free. If you installed the portable build, download a new portable from GitHub Releases manually, or migrate to the NSIS install (your data persists across the switch because both builds use the same `~/.paperclip` and `%APPDATA%\Paperclip` locations).

### "The embedded Paperclip server is no longer responding" mid-session

Health probe at `http://127.0.0.1:<port>/healthz` failed three intervals in a row. Pick **Restart Local** in the dialog. If it keeps recurring, capture the inner log (`%USERPROFILE%\.paperclip\instances\default\logs\server.log`) and file an issue — this usually means the embedded postgres is being killed by an external process (overzealous "process cleaner" tools or aggressive AV heuristics).

### Saved remote profile does not auto-launch

`Always Show Chooser On Launch` is enabled, or the profile's last connection failed. Open `Connection → Manage Connections` and check the profile's last health result.

## When To Capture For Support

A useful bug report on Windows includes:

1. The exact dialog title and detail text (the detail block contains the spawn paths, the timeout, and the log tail).
2. `%APPDATA%\Paperclip\server.log` — the latest "Server start" block.
3. `%USERPROFILE%\.paperclip\instances\default\logs\server.log` — the latest few hundred lines.
4. Output of `Get-AppxPackage *Paperclip*` and `(Get-Item "C:\Program Files\..." or "%LOCALAPPDATA%\Programs\paperclip-desktop").VersionInfo` for install scope and version.
5. Whether the install is the NSIS or portable build, and whether it was a fresh install or an update.

## Source References

- `src/main.ts` — `validateServerEnvironment()`, `tailInnerServerLog()`, `confirmAndResetLocalData()`, `launchWindowsUninstaller()`
- `build/installer.nsh` — `customUnInstall` macro and `${isUpdated}` guard
- `electron-builder.yml` — Windows packaging (`nsis`, `portable`, `differentialPackage`)
- `docs/prds/windows-release.md` — release-readiness PRD and resolved decisions
- `docs/development/windows-signing-guide.md` — Authenticode / Azure Artifact Signing setup
