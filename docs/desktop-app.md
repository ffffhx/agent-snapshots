# 桌面应用与本地查看器

Agent Snapshots 的桌面应用是一个 Electron 壳：它启动同一套本地 `agent-snapshot serve` 服务，再把启动器和完整查看器放进原生窗口。会话读取、脱敏、搜索、导出、发布等行为仍由本地查看器提供。

## Electron 壳

启动时，`electron/main.mjs` 会优先使用 `127.0.0.1:4321`。如果端口不可用，会改用一个空闲本地端口。服务启动后，桌面应用默认打开 `/launcher` 启动器窗口。

托盘菜单包含：

- `显示/隐藏启动器 (⌥Space)`：切换启动器窗口。
- `打开完整视图`：打开完整本地查看器窗口。
- `在浏览器打开`：用系统浏览器打开本地查看器地址。
- `检查更新...`：打包版本通过 GitHub Releases 检查更新；开发模式会提示不支持。
- `最近会话`：每 30 秒刷新最近 8 个会话，点击后打开完整视图。
- `恢复上次中断的会话`：仅在检测到上次异常退出前仍有 live sessions 时出现，一次恢复全部会话。
- `完成提示音`：控制会话完成通知是否静音。
- `有会话运行时防止休眠`：有 live session 时启用 Electron `powerSaveBlocker`。
- `开机自启`：通过系统 login item 设置。
- `退出`：真正退出应用并停止本地 server。

窗口行为：

- 全局快捷键是 `Alt+Space`，在托盘、应用菜单和全局快捷键里都指向启动器切换。
- 启动器窗口关闭时只是隐藏，不退出应用；非 macOS 且没有托盘时，所有窗口关闭才会退出。
- 启动器窗口位置和大小会保存，下次打开复用；通过 `Alt+Space` 唤起时会居中到当前鼠标所在屏幕。
- 完整阅读视图从启动器或托盘打开，使用独立的大窗口。

深链接：

- `agent-snapshots://launcher` 打开启动器。
- `agent-snapshots://session/<ref>` 打开指定会话的完整视图。
- `agent-snapshots://session?ref=<ref>` 也可以传会话引用。

会话完成提醒：

- 桌面应用每 5 秒轮询进行中的会话。
- 第一次轮询只建立基线；之后如果某个 live session 消失，就认为它完成。
- 每次轮询还会把 Orca 中真实运行的 Codex / Claude 进程匹配到会话并原子写入 Electron 设置，避免把旧的未显式结束日志误判为 live；正常退出会标记监控已结束，异常退出时则把最后一次清单作为待恢复会话。
- 如果没有 Agent Snapshots 窗口处于焦点，会发出系统通知并增加 macOS Dock badge。
- 点击通知会打开对应会话；任意应用窗口重新获得焦点后会清空 Dock badge。

更新与设置：

- 自动更新只在 packaged build 中启用，使用 `electron-updater` 和 GitHub Releases（`ffffhx/agent-snapshots`）。
- 启动时会自动检查并通知；也可以从托盘或应用菜单手动检查。
- Electron 设置写在 `app.getPath("userData")/settings.json`。macOS 通常是 `~/Library/Application Support/Agent Snapshots/settings.json`。

## 启动器

`/launcher` 是桌面应用的快速入口，定位接近 Raycast / Spotlight：先找会话，再继续工作。

主要能力：

- 范围切换：`全部`、`Codex`、`Claude`，可用 `⌘1` 到 `⌘3` 切换。
- 搜索：输入关键词会调用本地 `/api/search`，包含工具文本但不包含完整工具输出。
- 空搜索状态会分组显示 `置顶`、`进行中`、`最近`。
- 启动器顶部会显示“崩溃恢复已开启”；如果上次运行异常中断且留下 live sessions，会变为待恢复提示，点击“全部恢复”会逐个在 Orca 中继续，失败的条目会保留供重试。
- 置顶会话最多保留 20 个，偏好写在 `~/.agent-snapshot/launcher-prefs.json`；可用 `AGENT_SNAPSHOT_PREFS_DIR` 改目录。
- 进行中的会话会被提到最近列表前面，并显示绿色 `进行中` dot。
- 底部会显示 Codex 配额仪表（5 小时窗口、周配额）和进行中会话计数；点击进行中计数会切到 live sessions。

会话操作：

- 点击 Codex / Claude 会话：优先在 Orca 中继续。
- Codex 会话默认以全权限模式恢复，执行 `codex resume --dangerously-bypass-approvals-and-sandbox <id>`；Claude 会话仍执行 `claude --resume <id>`。
- 如果 Orca 不可用，macOS 下会回退到 iTerm2（若正在运行）或 Terminal，并使用相同的恢复命令。
- 行内快捷操作包含：`⭐` 置顶/取消置顶、复制恢复命令、打开完整视图。
- `⌘↵` 打开完整视图；`⌘/` 打开快捷键说明；`Esc` 清空搜索或关闭快捷键说明。

## 完整查看器

`/` 是完整的只读查看器。它按来源标签页显示 `Codex`、`Claude Code`，再按项目分组。项目标题可以展开/收起；有项目路径的分组会提供项目范围搜索。

阅读体验：

- 视图详略：`标准`、`详细`、`摘要`，可在设置弹层里选择，也可用 `Ctrl+O` 循环。详细视图会展开工具/过程 details；摘要视图会隐藏过程、工具、interrupt 和 subagent 区块。
- 大纲：`Ctrl+M` 打开/收起。大纲来自用户消息和会话期间的 git commit 卡片，点击可跳转；`[` / `]` 跳到上一个/下一个用户回合。
- Live tail：进行中的 Codex / Claude 会话会轮询 `/api/session-head`，变化后追加新内容。滚动离开底部时会出现 `↓ 跟随最新` 按钮。
- 大会话会先渲染最近一段，再后台渐进补齐更早记录，避免打开时卡住。
- 绝对文件路径会变成可点击文本：点击复制路径，`⌘` + 点击在 Finder 中显示。

设置弹层：

- 主题：`纸`、`褐`、`暗`。
- 阅读字号：`85%` 到 `140%`。
- 密度：`宽松` / `紧凑`。
- 当前视图和默认视图：`标准` / `详细` / `摘要`。
- 大纲开关和“默认打开大纲”偏好。

搜索：

- `⌘K` 打开全局搜索。
- 支持关键词和语义两种模式，`Tab` 在搜索弹层内切换。
- 关键词搜索支持 `source:`、`role:`、`project:`、`before:`、`after:` 和 `-排除词`，还有区分大小写和整词匹配。
- 搜索结果可直接打开、会话内搜、在 Orca 继续、导出 HTML、复制项目路径。
- 当前会话顶部有“在当前 Session 里搜大意”的语义搜索入口，命中后可跳到对应 turn。

图库：

- `图库` 会扫描最近会话里的 inline 图片，支持 `全部` / `Codex` / `Claude` 筛选。
- 点击缩略图打开 lightbox，可用左右箭头切换。
- 点击图片卡片的文字区域会打开对应会话并跳到图片所在回合。

使用统计：

- `统计` 面板独立加载四块数据：Codex 配额、最近 26 周活跃度热力图、Top 项目、Token / 成本用量。
- 统计可按 `全部` / `Codex` / `Claude` 过滤。
- Codex 配额来自本地 Codex CLI session tail 中的 `rate_limits` 快照；Claude Code 没有对应的本地配额文件。
- Token 和项目成本估算来自本机搜索索引；首次打开会在后台补齐索引。

导出与分享：

- `导出 HTML` / `导出 Markdown` 从本地 `/export` 生成只读文件。
- `Gist` 会用 GitHub CLI 创建 secret Gist，内容是已脱敏的当前会话 HTML。需要先安装并登录 `gh`。
- `发布分享` 会把已脱敏快照发到配置好的分享 API，并在需要时引导 GitHub 登录。

## 本地 API

下面这些路由只存在于本地查看器 server，面向 `127.0.0.1` / `localhost` 使用。所有写操作都需要页面注入的 `x-agent-snapshot-csrf` token；公开分享站点不会暴露这些本机能力。

| 路由 | 方法 | 用途 | 本地性 |
| --- | --- | --- | --- |
| `/api/quota` | `GET` | 从本地 Codex session 日志尾部读取 Codex CLI 配额快照。 | local-only |
| `/api/activity` | `GET` | 扫描本地 Codex / Claude 会话，生成 26 周活跃度、小时分布和项目统计。 | local-only |
| `/api/images` | `GET` | 扫描最近会话中的 inline 图片，支持 `source`、`limit`、`offset`。 | local-only |
| `/api/image?ref=...` | `GET` | 按图片引用从本地会话重新读取图片 bytes。 | local-only |
| `/api/session-head?id=...` | `GET` | 返回轻量会话头部状态：是否完成、turn 数、最新事件时间，用于 live tail。 | local-only |
| `/api/launcher-prefs` | `GET` | 读取启动器置顶偏好。 | local-only |
| `/api/launcher-prefs/pin` | `POST` | 更新启动器置顶/取消置顶偏好，写入本机偏好文件。 | local-only |
| `/api/reveal-in-file?path=...` | `POST` | 在 Finder / Explorer / xdg-open 中显示本机绝对路径。 | local-only |
| `/api/publish-gist` | `POST` | 通过本机 GitHub CLI 发布当前会话的已脱敏 HTML 到 secret Gist。路由是本地的；用户主动触发后会把内容发送给 GitHub。 | local-only |

## 开发和构建

开发模式：

```bash
pnpm app:dev
```

构建桌面包：

```bash
pnpm app:build        # 当前平台，macOS 会产出 .dmg 和 .zip
pnpm app:build:mac    # 仅 macOS
pnpm app:build:dir    # 未打包 .app，适合快速测试
```

构建产物在 `release/`。图标由 `pnpm app:icon` 从项目 logo 生成到 `build/icon.png` 和 `build/icon.icns`。

实现备注：

- `asar` 关闭，因为 Electron 用 `ELECTRON_RUN_AS_NODE=1` 启动 `dist/cli/agent-snapshot.mjs serve`，需要直接读取 `dist/` 和 `node_modules/`。
- 默认构建未签名。macOS 首次打开可右键选择 **Open**，或按 electron-builder 文档配置签名。
- Windows (`nsis`) 和 Linux (`AppImage`) 目标已配置，但只在对应平台构建/验证。
