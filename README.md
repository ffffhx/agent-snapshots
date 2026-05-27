# Codex Snapshots

面向 Codex、Claude Code 和 Trae 的本地优先、只读会话快照工具。

这个项目从 Garden Lab 中拆分出来，让会话快照查看器可以作为独立工具使用。它会扫描本地 agent 历史记录，在浏览器中提供审阅界面，导出静态 HTML/Markdown 快照，自动脱敏常见密钥，并支持把已脱敏的快照发布到一个轻量的独立分享 API。

网站：<https://ffffhx.github.io/codex-snapshots/>

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:4321/>。

如果想在本地预览公开静态网站：

```bash
pnpm site:dev
```

打开 <http://127.0.0.1:4323/>。

## 命令行

```bash
pnpm snapshot list --source all
pnpm snapshot preview <session-id>
pnpm snapshot export <session-id> --html --output snapshot.html
pnpm snapshot export <session-id> --md --output snapshot.md
pnpm snapshot serve --port 4321
pnpm snapshot record-trae --port 4732
```

默认读取以下目录：

- Codex：`$CODEX_HOME` 或 `~/.codex`
- Claude Code：`$CLAUDE_HOME` 或 `~/.claude`
- Trae：`$TRAE_HOME` 或 `~/.trae-cn`
- Trae 应用数据：`$TRAE_APP_HOME` 或 `~/Library/Application Support/Trae CN`

## 云端分享服务

启动可选的分享 API：

```bash
SNAPSHOT_SHARE_TOKEN=change-me pnpm share:server
```

发布已脱敏的快照：

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
pnpm snapshot publish <session-id> \
  --api-url http://127.0.0.1:8787 \
  --site-url http://127.0.0.1:8787
```

服务端默认把分享内容保存在 `.codex-snapshots/shares.json`。如果需要使用其他路径，可以配置 `SNAPSHOT_SHARE_DATA_FILE`。

## macOS LaunchAgent

把本地查看器安装为用户级 LaunchAgent：

```bash
pnpm snapshot:install-daemon
pnpm snapshot:daemon:status
pnpm snapshot:daemon:logs
pnpm snapshot:uninstall-daemon
```

安装后，LaunchAgent 会在登录后保持 <http://127.0.0.1:4321/> 可用。

## 安全模型

- 默认导出用户和助手消息。
- 跳过 developer、system 和 bootstrap 消息。
- 除非传入 `--include-tools`，否则隐藏工具调用。
- 除非传入 `--include-tool-output`，否则隐藏工具输出。
- 自动脱敏常见密钥、Bearer token、JWT、私钥块、Cookie 和本地 home 路径。
- 生成静态、只读快照；接收方无法恢复或操作原始 agent 线程。
- 除非显式允许，否则拒绝把未脱敏快照发布到云端。

脱敏器会尽量保守处理，但并不完美。分享前请务必查看风险面板。
