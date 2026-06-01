# Codex Snapshots

面向 Codex、Claude Code 和 Trae 的本地优先、只读会话快照工具。

这个项目从 Garden Lab 中拆分出来，让会话快照查看器可以作为独立工具使用。它会扫描本地 agent 历史记录，在浏览器中提供审阅界面，导出静态 HTML/Markdown 快照，自动脱敏常见密钥，并支持把已脱敏的快照发布到一个轻量的独立分享 API。

网站：<https://ffffhx.github.io/codex-snapshots/>

## 快速开始

临时审阅适合偶尔查看一次会话快照，不需要克隆仓库，可以直接通过已发布的 npm 包启动本地查看器。命令运行期间 4321 端口可用，关闭终端或停止进程后服务就会结束：

```bash
npx codex-snapshots@latest serve --port 4321
```

打开 <http://127.0.0.1:4321/>。

也可以全局安装 npm 包后手动启动：

```bash
npm install -g codex-snapshots
codex-snapshot serve --port 4321
```

如果需要在 macOS 登录后自动保持查看器可用，全局安装 npm 包后可以注册为用户级 LaunchAgent。安装完成后服务会在后台监听 4321，直到你卸载 daemon 或停止服务：

```bash
npm install -g codex-snapshots
codex-snapshot daemon install
codex-snapshot daemon status
```

要求 Node.js 18 或更高版本。

## 从源码运行

```bash
pnpm install
pnpm build
pnpm dev
```

打开 <http://127.0.0.1:4321/>。

如果想在本地预览公开静态网站：

```bash
pnpm build:site
pnpm site:dev
```

打开 <http://127.0.0.1:4322/>。

## 命令行

全局安装或通过 `npx` 使用时：

```bash
codex-snapshot list --source all
codex-snapshot preview <session-id>
codex-snapshot export <session-id> --html --output snapshot.html
codex-snapshot export <session-id> --md --output snapshot.md
codex-snapshot serve --port 4321
codex-snapshot record-trae --port 4732
```

从源码运行时，也可以使用对应的 pnpm 脚本：

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

启动可选的分享 API。未配置 GitHub OAuth 时，可以继续用本地/兼容模式的分享 token：

```bash
SNAPSHOT_SHARE_TOKEN=change-me codex-snapshot-share
```

如果还没有全局安装，可以用：

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
npx -p codex-snapshots@latest codex-snapshot-share
```

从源码运行：

```bash
SNAPSHOT_SHARE_TOKEN=change-me pnpm share:server
```

生产公网分享建议改用 GitHub OAuth。先在 GitHub OAuth App 中配置 callback URL：

```text
https://your-share-api.example.com/api/auth/github/callback
```

然后启动分享 API：

```bash
SNAPSHOT_GITHUB_CLIENT_ID=your-client-id \
SNAPSHOT_GITHUB_CLIENT_SECRET=your-client-secret \
SNAPSHOT_SESSION_SECRET="$(openssl rand -base64 48)" \
SNAPSHOT_GITHUB_OWNER_LOGIN=your-github-login \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
SNAPSHOT_SHARE_PUBLIC_API_URL=https://your-share-api.example.com \
SNAPSHOT_SHARE_VIEWER_PATH=/share/ \
SNAPSHOT_SHARE_ALLOW_ANONYMOUS=false \
codex-snapshot-share
```

配置 GitHub OAuth 后，发布和删除都需要 GitHub 登录：发布记录会保存发布者 GitHub 账号，站长账号可以删除任何分享，其他用户只能删除自己发布的分享。旧的 `SNAPSHOT_SHARE_TOKEN` 只在未启用 GitHub OAuth 时默认生效。

兼容模式下也可以从命令行发布已脱敏的快照：

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
codex-snapshot publish <session-id> \
  --api-url http://127.0.0.1:8787 \
  --site-url http://127.0.0.1:8787
```

服务端默认把分享内容保存在 `.codex-snapshots/shares.json`。如果需要使用其他路径，可以配置 `SNAPSHOT_SHARE_DATA_FILE`。

公开列表接口会返回最近发布的分享摘要，不包含完整会话内容：

```bash
curl http://127.0.0.1:8787/api/snapshots
```

兼容模式下删除已发布的分享快照需要同一个分享 token：

```bash
curl -X DELETE \
  -H "Authorization: Bearer change-me" \
  http://127.0.0.1:8787/api/snapshots/snap_...
```

官网首页会使用同一个分享 API 地址展示“公开 Session”卡片列表。启用 GitHub OAuth 后，首页会显示 GitHub 登录状态，并只给站长或分享发布者显示删除入口。

如果要让发布的 Session 出现在公开官网上，需要把分享 API 部署到公网，并让 GitHub Pages 默认读取这个公网 API。`127.0.0.1` 只对本机可见，不能作为公开分享地址。

公网分享服务至少需要配置：

```bash
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
SNAPSHOT_SHARE_PUBLIC_API_URL=https://your-share-api.example.com \
SNAPSHOT_SHARE_VIEWER_PATH=/share/ \
codex-snapshot-share
```

然后在 GitHub 仓库变量中设置：

```text
CODEX_SNAPSHOTS_PUBLIC_API_URL=https://your-share-api.example.com
```

Pages 部署时会写入 `site/assets/config.js`，官网首页和 `/share/` 页面会默认读取这个公网 API。发布时本地查看器也需要指向同一个公网 API，可以写入本地发布配置：

```bash
SNAPSHOT_SHARE_API_URL=https://your-share-api.example.com \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
deploy/aliyun/configure-local-publisher.sh
```

这个配置会写入 `~/.codex-snapshots-agent.json`。之后直接启动本地查看器即可：

```bash
codex-snapshot serve --port 4321
```

本地查看器里的“发布分享”按钮会先检查公网分享 API 的 GitHub 登录态；没有登录时会跳转到 GitHub 登录，登录后浏览器带着 session cookie 直接发布脱敏快照。页面发布状态会显示当前目标 API，方便确认没有仍然指向 `127.0.0.1`。
公开官网如果没有配置 `CODEX_SNAPSHOTS_PUBLIC_API_URL`，会显示“公开分享 API 尚未配置”，不会回退请求访问者自己的 `127.0.0.1`。
Pages workflow 会校验 `CODEX_SNAPSHOTS_PUBLIC_API_URL`，拒绝 localhost、示例域名、内网 IP 和非 http/https 地址。

阿里云 ECS 的 systemd、Nginx、SSH 部署脚本、部署前检查脚本、公网验证脚本、GitHub Pages 配置脚本和本地发布配置脚本见 [`deploy/aliyun`](deploy/aliyun/README.md)。

## macOS LaunchAgent

全局安装 npm 包后，可以把本地查看器安装为用户级 LaunchAgent：

```bash
npm install -g codex-snapshots
codex-snapshot daemon install
codex-snapshot daemon status
codex-snapshot daemon logs
codex-snapshot daemon uninstall
```

从源码运行时，也可以使用对应的 pnpm 脚本：

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
