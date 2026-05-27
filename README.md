# Codex Snapshots

Local-first, read-only session snapshots for Codex, Claude Code, and Trae.

This project was split out of Garden Lab so the snapshot viewer can live as its own tool. It scans local agent history, renders a browser review UI, exports static HTML/Markdown snapshots, redacts common secrets, and can publish redacted snapshots to a small standalone share API.

Website: <https://ffffhx.github.io/codex-snapshots/>

## Quick Start

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:4321/>.

To preview the public static website locally:

```bash
pnpm site:dev
```

Open <http://127.0.0.1:4323/>.

## CLI

```bash
pnpm snapshot list --source all
pnpm snapshot preview <session-id>
pnpm snapshot export <session-id> --html --output snapshot.html
pnpm snapshot export <session-id> --md --output snapshot.md
pnpm snapshot serve --port 4321
pnpm snapshot record-trae --port 4732
```

The default homes are:

- Codex: `$CODEX_HOME` or `~/.codex`
- Claude Code: `$CLAUDE_HOME` or `~/.claude`
- Trae: `$TRAE_HOME` or `~/.trae-cn`
- Trae app data: `$TRAE_APP_HOME` or `~/Library/Application Support/Trae CN`

## Cloud Share Server

Start the optional share API:

```bash
SNAPSHOT_SHARE_TOKEN=change-me pnpm share:server
```

Publish a redacted snapshot:

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
pnpm snapshot publish <session-id> \
  --api-url http://127.0.0.1:8787 \
  --site-url http://127.0.0.1:8787
```

The server stores shares in `.codex-snapshots/shares.json` by default. Configure `SNAPSHOT_SHARE_DATA_FILE` for another file path.

## macOS LaunchAgent

Install the local viewer as a user LaunchAgent:

```bash
pnpm snapshot:install-daemon
pnpm snapshot:daemon:status
pnpm snapshot:daemon:logs
pnpm snapshot:uninstall-daemon
```

The LaunchAgent keeps <http://127.0.0.1:4321/> available after login.

## Safety Model

- Exports user and assistant messages by default.
- Skips developer/system/bootstrap messages.
- Hides tool calls unless `--include-tools` is passed.
- Hides tool output unless `--include-tool-output` is passed.
- Redacts common secrets, bearer tokens, JWTs, private key blocks, cookies, and local home paths.
- Produces static/read-only snapshots; recipients cannot resume or operate the original agent thread.
- Refuses cloud publishing of unredacted snapshots unless explicitly allowed.

The redactor is intentionally conservative but not perfect. Always review the risk panel before sharing.
