<p align="center">
  <strong>Paperclip Desktop</strong><br/>
  A one-click desktop app for <a href="https://github.com/paperclipai/paperclip">Paperclip</a>.
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>Paperclip (upstream)</strong></a> &middot;
  <a href="https://docs.paperclip.ing/"><strong>Docs</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<br/>

## What is this?

**Paperclip Desktop** is an unofficial [Electron](https://www.electronjs.org/) wrapper around [Paperclip](https://github.com/paperclipai/paperclip). It bundles Paperclip (via the official `@paperclipai/server` npm package) inside a native desktop app for macOS, Windows, and Linux.

The goal is simple: **make running Paperclip as easy as opening an app.**

- 🖱 **One click to launch** — double-click the app and Paperclip starts automatically. No terminal, no `pnpm install`, no Node.js setup.
- 🌐 **Remote connection mode** — connect the desktop shell to verified upstream Paperclip remotes in authenticated mode, with saved connections and quick reconnects.
- 📦 **Paperclip inside** — ships an unmodified build of the upstream Paperclip server and UI. What you get in the app is exactly what you'd get by cloning and running the main repo.
- 🔄 **Auto-updates** — pulls new desktop releases automatically via GitHub Releases.
- 🖥 **Native menus, windowing, and system tray** — the Paperclip UI, but as a real desktop app.
- 🪟 **Cross-platform** — macOS (Apple Silicon + Intel), Windows (x64), and Linux (x64).

1. Run the embedded local server flow
2. Or verify a remote Paperclip origin via `/api/health` and `/api/auth/get-session` before loading it in a restricted remote-safe Electron window

When local mode is active, the server is cleanly shut down when you quit the app.

> For everything Paperclip itself can do — orchestrating AI agents, running autonomous companies, governance, budgets, org charts, etc. — see the **[upstream Paperclip repo](https://github.com/paperclipai/paperclip)**. This project does not modify or extend Paperclip's functionality; it only packages it.

<br/>

## Relationship to upstream Paperclip

| This repo (`paperclip-desktop`)              | Upstream ([`paperclipai/paperclip`](https://github.com/paperclipai/paperclip)) |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron shell + installers                  | The actual Paperclip server, UI, and features                                  |
| Maintained by Aron Prins (community)         | Maintained by the Paperclip team                                               |
| Bundles `@paperclipai/server` as a dependency| Source of that package                                                         |
| MIT licensed                                 | MIT licensed                                                                   |

This is an **independent community distribution**. It is not an official Paperclip release. All credit for Paperclip itself goes to the upstream project and its authors.

<br/>

## Quickstart

### Install the desktop app

Download the latest installer for your platform from the [Releases page](https://github.com/aronprins/paperclip-desktop/releases):

- **macOS** — `.dmg` (Apple Silicon and Intel)
- **Windows** — `.exe` NSIS installer (x64)
- **Linux** — `.AppImage` or `.deb` (x64)

Open the app. Paperclip starts automatically and the dashboard opens in the app window. That's it.

```bash
npx paperclipai onboard --yes
```

Or:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

See [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip) for full docs.

<br/>

## Development

Requirements: Node.js 20+, pnpm 9.15+.

```bash
pnpm install           # Install deps
pnpm dev               # Run Electron in dev mode against the bundled server
pnpm build             # Compile the Electron main/preload TypeScript
pnpm test:connections  # Run connection persistence, preflight, and origin-policy tests
pnpm prepare-server    # Stage the Paperclip server bundle into build/
pnpm build-ui          # Stage the Paperclip UI
pnpm pack              # Build an unpacked app directory (no installer)
pnpm dist              # Build full installers for the current platform
pnpm dist:mac          # macOS (.dmg + .zip, signed/notarized via local script)
pnpm dist:win          # Windows (.exe NSIS installer + portable)
pnpm dist:linux        # Linux (.AppImage + .deb)
```

Key files:

- `src/main.ts` — Electron main process: launcher IPC, local/remote boot orchestration, menu actions, and server lifecycle
- `src/connection/` — Connection persistence, remote validation/preflight, and exact-origin window policy helpers
- `src/launcher-html.ts` — Internal launcher UI for the chooser, remote connect flow, saved connections, and local boot states
- `src/preload.ts` — Preload script for the renderer
- `src/updater.ts` — Auto-update wiring (`electron-updater` against GitHub Releases)
- `electron-builder.yml` — Packaging config; bundles the `@paperclipai/server` npm package plus a platform-specific Node.js binary
- `scripts/` — Build and release automation (server staging, packaging, notarization)

<br/>

## License

MIT © 2026 Aron Prins.

This project wraps a bundled copy of [Paperclip](https://github.com/paperclipai/paperclip), which is also MIT licensed © Paperclip. See [LICENSE](./LICENSE) for the full text. The upstream Paperclip license ships inside the packaged app alongside its source.

<br/>

## Disclaimer — use at your own risk

Paperclip Desktop is provided **"as is", without warranty of any kind**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.

By using this app you acknowledge that:

- It runs AI agents that can execute code, make API calls, and **spend money** on AI model providers on your behalf. You are solely responsible for any costs incurred.
- It is an **unofficial community distribution**. It is not endorsed by, affiliated with, or supported by the upstream Paperclip team.
- It wraps third-party software (Paperclip and its dependencies). The authors of this wrapper accept **no liability** for the behavior of the bundled Paperclip server, any agents you configure, or any outcomes produced by them.
- You are responsible for reviewing agent actions, setting budgets, and operating the software in accordance with the terms of any AI providers and services you connect to it.

If you do not accept these terms, do not install or use the app.

<br/>

## Credits

- **Paperclip** — the actual product: [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip)
- **Paperclip Desktop** — this Electron wrapper, maintained by [Aron Prins](https://github.com/aronprins)
