# Changelog

## 0.2.0 — 2026-07-08

桌面应用（Electron）大版本升级：对标 Agent Sessions、cmux、Conductor、官方 Codex/Claude Code 桌面端等同类产品，补齐桌面集成能力并大幅增强阅读、分析与实时体验。

### Electron 桌面集成
- 菜单栏托盘：显示/隐藏启动器、最近会话子菜单、失焦自动隐藏、开机自启、完成提示音、防休眠、检查更新
- 全局快捷键唤起启动器（macOS ⌥Space，可在托盘切换 ⌃⇧Space / ⌘⇧K / F19 / 禁用，冲突自动回退）
- 托盘快速预览弹层：配额仪表、进行中会话、最近会话、一键打开
- `agent-snapshots://` deep link（`session/<ref>`、`launcher`）
- 会话完成系统通知 + Dock 未读角标（前台自动抑制）
- 自动更新（electron-updater，GitHub Releases，打包版生效）
- 打包修复与跨平台守卫（Windows/Linux 快捷键、图标、平台 API 兜底）

### 启动器（Launcher）
- Trae 范围页签、⌘1-4 切换范围、⌘/ 快捷键表
- 进行中会话置顶显示（绿色脉冲点）、置顶（⭐）与常用度（frecency）排序
- 行内快捷操作：复制恢复命令 / 完整视图；会话预览窥视面板（→ / ⌘P）
- 底栏配额微型仪表（5h / 周）与进行中计数
- 列表自动刷新（watermark 轮询，保留选中与滚动位置）

### 阅读器（Viewer）
- 视图详略三档（标准/详细/摘要，Ctrl+O）、大纲导航（[ ] 跳转）
- 进行中会话实时追踪（live tail）+ 跟随最新
- 搜索结果精准锚定到命中回合，n/N 逐个跳转；回合级 token/耗时徽标
- 可点击文件路径（点击复制，⌘点击 Finder 定位）
- 跨会话图库（持久化索引、灯箱、引擎筛选）
- 会话备注（本地存储，不进入导出/分享）
- 设置面板整合外观选项；单会话发布 Gist
- 无障碍与键盘全面加强（焦点圈、ARIA、j/k/gg/G、跳过链接、reduced-motion）

### 统计与分析
- Codex 配额仪表（5 小时窗口 + 周配额，读取本地 rate-limit 快照）
- Claude Code 5 小时块燃烧参考
- 活跃度热力图（26 周）、按小时分布、项目排行、用量汇总
- 周报（界面查看 + Markdown 复制/下载）

### CLI
- `agent-snapshot digest`：输出周报 Markdown
- `agent-snapshot doctor`：环境诊断清单

### 数据与性能
- 会话列表持久化元数据缓存：冷启动首屏从数秒降至约 150ms
- 图库持久化索引：冷扫描从约 45s 降至约 100ms
- Codex 多 home 发现（自动识别 Orca codex-runtime-home，支持 `AGENT_SNAPSHOT_EXTRA_CODEX_HOMES`）
- 恢复会话在 Orca 不可用时回退到 Terminal/iTerm2

### 质量
- 三轮对抗性 review 加固（缓存竞态、HTML 转义、路径与 ref 校验、生命周期泄漏、IPC 防护等）
- 新增测试：desktop API 集成（15 项）、客户端 UI 逻辑（14 项）、Electron E2E 冒烟（Playwright）
- 阅读器 UI 从单文件 5900 行拆分为 viewer-ui 模块（渲染输出字节级一致）
