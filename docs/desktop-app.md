# Desktop app (Electron)

The local viewer can run as a native desktop app. It reuses the exact same
local server (`agent-snapshot serve`) and web UI — the desktop shell just spawns
that server on a private localhost port and shows it in a native window.

## How it works

- `electron/main.mjs` is the Electron main process.
- On launch it picks a free loopback port, spawns the built CLI
  (`dist/cli/agent-snapshot.mjs serve`) using Electron's bundled Node runtime
  (`ELECTRON_RUN_AS_NODE=1`), waits for the server to answer, then opens a
  `BrowserWindow` pointed at `http://127.0.0.1:<port>/`.
- External links (share URLs, docs) open in your system browser; everything
  else stays in the window.
- The server child process is terminated when the app quits.

Because the desktop app just wraps the existing server, every feature of the
web viewer (search, semantic search, snapshot rendering, export, publish) works
identically, and redaction/security behaviour is unchanged.

## Develop

```bash
pnpm app:dev
```

Builds `dist/` and launches the app against your live sessions.

## Build a distributable

```bash
pnpm app:build        # current platform (macOS: .dmg + .zip)
pnpm app:build:mac    # macOS only
pnpm app:build:dir    # unpacked .app, fastest for testing
```

Output lands in `release/`. App icons are generated from the project logo by
`pnpm app:icon` (macOS tooling: `qlmanage` / `sips` / `iconutil`) into
`build/icon.png` and `build/icon.icns`.

## Notes

- `asar` is intentionally disabled so the spawned Node server process can read
  `dist/` and `node_modules/` directly (asar's filesystem shim is not active
  under `ELECTRON_RUN_AS_NODE`).
- Builds are unsigned by default. On first open, right‑click the app →
  **Open** to bypass Gatekeeper, or configure a signing identity via
  [electron-builder code signing](https://electron.build/code-signing).
- Windows (`nsis`) and Linux (`AppImage`) targets are configured but only
  exercised on those platforms.
