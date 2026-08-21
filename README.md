# Agent Snapshots

面向 Codex 和 Claude Code 的本地优先、只读会话查看器与桌面应用。

它会把你电脑上的 agent 会话整理成可以浏览、搜索、导出、脱敏和分享的快照。适合复盘一次调试过程、沉淀问题排查记录，或者把一段 agent 协作过程发给同事看。

- 官网：<https://ffffhx.github.io/agent-snapshots/>
- npm：<https://www.npmjs.com/package/agent-snapshots>
- 仓库：<https://github.com/ffffhx/agent-snapshots>

## 它能做什么

- 读取本地 Codex、Claude Code 会话历史，并在浏览器里用只读界面查看。
- 按来源和项目组织会话，支持 Codex / Claude Code 标签页、正在进行的会话标记和实时跟随。
- 默认隐藏 system/developer/bootstrap 消息和工具输出，可在标准、详细、摘要视图之间切换。
- 支持全文搜索、语义搜索、会话内语义搜索、图片图库、使用统计和 Codex 配额仪表。
- 自动脱敏常见 token、密钥、Cookie、本地 home 路径等敏感信息。
- 支持导出 HTML / Markdown、本地发布到 GitHub secret Gist，或发布到配置好的分享服务。
- Electron 桌面应用提供托盘菜单、Alt+Space 启动器、完成通知、开机自启、自动更新和 `agent-snapshots://` 深链接。

Agent Snapshots 默认不会上传你的本地会话。只有你主动点击 `Gist` 或 `发布分享` 时，才会把已脱敏的当前快照发送到 GitHub Gist 或配置好的分享服务。

## 截图

### 本地查看器

![Agent Snapshots 本地查看器](docs/images/local-viewer.jpg)

### 官网首页

![Agent Snapshots 官网首页](docs/images/public-home.jpg)

### 公开分享列表

![Agent Snapshots 公开分享列表](docs/images/public-sessions.jpg)

## 快速开始

要求 Node.js 18 或更高版本。

不需要克隆仓库，直接运行：

```bash
npx agent-snapshots@latest serve --port 4321
```

然后打开 <http://127.0.0.1:4321/>。

如果你想长期使用，可以全局安装：

```bash
npm install -g agent-snapshots@latest
agent-snapshot serve --port 4321
```

旧命令 `codex-snapshot` / `codex-snapshots` 仍作为兼容别名保留。

## 怎么使用

1. 打开本地查看器：<http://127.0.0.1:4321/>。
2. 在左侧选择 Codex 或 Claude Code 标签页，再按项目选择会话。
3. 查看会话内容，按需切换 `脱敏`、主题、阅读字号、密度、视图详略和大纲。
4. 用 `⌘K` 搜索全部历史，或在当前会话里输入大意做语义搜索。
5. 点击 `导出 HTML`、`导出 Markdown`、`Gist` 或 `发布分享` 输出只读快照。

命令行也可以导出：

```bash
agent-snapshot export <session-id> --html -o snapshot.html
agent-snapshot export <session-id> --md -o snapshot.md
```

如果不想部署项目自带的分享服务，可以用 GitHub secret Gist 分享脱敏后的 HTML：

```bash
agent-snapshot export <session-id> --gist
```

这会调用 GitHub CLI 创建默认 secret gist，并打印 Gist 地址和 `gistpreview.github.io` 查看地址。需要先安装并登录：

```bash
brew install gh
gh auth login
```

加 `--gist-public` 会创建 public gist。`--gist` 默认脱敏；如果同时传 `--no-redact`，必须再显式传 `--allow-unredacted`。

默认读取这些本地目录：

- Codex：`$CODEX_HOME` 或 `~/.codex`
- Claude Code：`$CLAUDE_HOME` 或 `~/.claude`

## 桌面应用

桌面应用复用同一个本地查看器，但外面包了一层 Electron：

- 托盘菜单可显示/隐藏启动器、一键恢复电脑异常重启前仍在运行的会话、打开最近会话、切换开机自启、完成提示音、有会话运行时防休眠、检查更新和退出。
- 全局快捷键 `Alt+Space` 打开或隐藏启动器；启动器是常驻窗口，失焦不会自动隐藏，关闭窗口也不会退出应用。
- 启动器支持 全部 / Codex / Claude 范围和 `⌘1` 到 `⌘3` 切换，点击 Codex / Claude 会话会优先在 Orca 继续；Codex 默认以全权限模式恢复，Orca 不可用时在 macOS Terminal / iTerm2 使用相同命令回退打开。
- Agent Snapshots 会持续记录 Orca 当前真实运行的 Session；启动器顶部会显示恢复保护状态，异常退出或电脑崩溃后可点“全部恢复”，一次唤起上次中断的所有 Session。
- 支持 `agent-snapshots://launcher` 和 `agent-snapshots://session/<ref>` 深链接。
- 打包版本会通过 GitHub Releases 检查更新。

更多桌面端、启动器、查看器能力和本地 API 说明见 [docs/desktop-app.md](docs/desktop-app.md)。

## 常用快捷键

| 快捷键 | 位置 | 作用 |
| --- | --- | --- |
| `Alt+Space` | 桌面应用 | 显示/隐藏启动器 |
| `⌘1` - `⌘3` | 启动器 | 切换 全部 / Codex / Claude |
| `↑` / `↓` | 启动器、搜索弹层 | 移动选择 |
| 点击会话 | 启动器 | 在 Orca 继续 Codex / Claude 会话 |
| `⌘↵` | 启动器 | 打开完整视图 |
| `⌘/` | 启动器、查看器 | 打开快捷键说明 |
| `⌘K` | 查看器 | 搜索会话正文 |
| `Ctrl+O` | 查看器 | 在标准 / 详细 / 摘要视图之间切换 |
| `Ctrl+M` | 查看器 | 打开/收起大纲 |
| `[` / `]` | 查看器 | 跳到上一个/下一个用户回合 |
| 点击文件路径 | 查看器 | 复制绝对路径 |
| `⌘` + 点击文件路径 | 查看器 | 在 Finder 中显示 |

## 开发者运行

如果你想改代码，可以从源码启动本地查看器：

```bash
pnpm install
pnpm dev
```

本地查看器默认运行在 <http://127.0.0.1:4321/>。

官网静态站点默认运行在 <http://127.0.0.1:4322/>。

桌面应用开发模式：

```bash
pnpm app:dev
```

## 安全说明

- 默认以用户和助手消息为主展示。
- 默认跳过 developer、system 和 bootstrap 消息。
- 默认不加载完整工具输出；工具/过程详情可按视图详略折叠或展开。
- 默认开启常见敏感信息脱敏。
- 导出的快照是静态、只读内容，接收方不能操作原始 agent 线程。
- 本地查看器 API 只面向本机使用；会限制来源，写操作还需要页面内的 CSRF token。

脱敏不是绝对可靠。发布或发送快照前，请先在页面里快速复核正文和风险提示。

## License

MIT
