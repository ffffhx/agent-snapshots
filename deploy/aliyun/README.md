# Deploy the Share API on Alibaba Cloud ECS

This deployment runs `agent-snapshot-share` on `127.0.0.1:8787`, exposes it through Nginx + HTTPS, and lets the GitHub Pages site list and render public sessions.

Replace these examples before running commands:

- `snapshots.example.com`: your public API domain
- `your-client-id` / `your-client-secret`: your GitHub OAuth App credentials
- `your-github-login`: your GitHub login; this account can delete any shared session
- `https://ffffhx.github.io/agent-snapshots/`: the public static site

## 1. Prepare Alibaba Cloud

1. Point a DNS `A` record for `snapshots.example.com` to the ECS public IP.
2. In the ECS security group, allow inbound TCP `80` and `443`.
3. Do not expose port `8787` publicly; the service binds to `127.0.0.1`.

## 2. Install host dependencies

On the ECS host, install Node.js 18 or newer, Nginx, Certbot, Git, OpenSSL, and rsync.

Ubuntu/Debian example:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx git openssl rsync
node --version
```

Alibaba Cloud Linux/RHEL-style systems usually use `dnf` or `yum` packages instead of `apt`.

You can also let the deploy helper install the common dependencies on Ubuntu/Debian, Alibaba Cloud Linux, or RHEL-style hosts:

```bash
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --install-deps \
  --configure-local
```

The helper installs Node.js 20 when the host does not already have Node.js 18+.

## 3. Deploy from your local machine

Optionally create a local deployment config so you do not have to type the long command each time:

```bash
cp deploy/aliyun/deploy.env.example deploy/aliyun/deploy.env
$EDITOR deploy/aliyun/deploy.env
deploy/aliyun/deploy-to-ecs.sh --config deploy/aliyun/deploy.env --dry-run
node deploy/aliyun/doctor.mjs --config deploy/aliyun/deploy.env
deploy/aliyun/deploy-to-ecs.sh --config deploy/aliyun/deploy.env
```

`deploy/aliyun/deploy.env` is ignored by git because it contains host details, OAuth secrets, and optional legacy token values.
The dry run validates that you replaced template values like `root@1.2.3.4`, `snapshots.example.com`, `change-me`, and `you@example.com` before anything connects to ECS.
The doctor command adds local readiness checks for DNS, local `ssh`/`rsync`/`node`, GitHub CLI when Pages auto-config is enabled, auth config, and the deploy dry run. Pass `--offline` if DNS has not propagated yet.
The deploy and install scripts also exclude local secret files such as `.env`, `deploy/aliyun/deploy.env`, private-key files, and local `backups/` from the ECS rsync payload.

Run the preflight check before deploying:

```bash
node deploy/aliyun/preflight.mjs \
  --domain snapshots.example.com \
  --ssh root@1.2.3.4
```

This checks DNS, SSH access, Node.js 18+, Nginx, Certbot, rsync, OpenSSL, systemd, and root/passwordless-sudo privileges on the ECS host.
When you deploy with `--issue-cert`, the deploy helper also checks that Certbot has the Nginx plugin.

After DNS points at the ECS public IP and SSH works, deploy the current checkout from your local machine:

```bash
SNAPSHOT_GITHUB_CLIENT_ID=your-client-id \
SNAPSHOT_GITHUB_CLIENT_SECRET=your-client-secret \
SNAPSHOT_SESSION_SECRET="$(openssl rand -base64 48)" \
SNAPSHOT_GITHUB_OWNER_LOGIN=your-github-login \
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --configure-local
```

This runs the preflight checks, rsyncs the repository to the ECS host, installs the systemd service, and writes the Nginx bootstrap config. If you have already checked the host and want to skip preflight, pass `--no-preflight`.
GitHub OAuth makes publish/delete use GitHub login instead of a shared token. The site owner in `SNAPSHOT_GITHUB_OWNER_LOGIN` can delete any shared session; other GitHub users can delete only their own sessions.
Keep the same `SNAPSHOT_SESSION_SECRET` across redeploys so existing login cookies remain valid. If you omit it while OAuth vars are present, the deploy helper generates one for that deploy.

After port `80` works, issue HTTPS and switch to the HTTPS proxy template:

```bash
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --issue-cert \
  --email you@example.com
```

The deploy script verifies the ECS API at the end. In GitHub OAuth mode it skips command-line token publishing because writes require a browser GitHub login; configure Pages in step 6, then run the public loop verification in step 7.

You can also let the deploy command configure GitHub Pages and the local publisher in the same run:

```bash
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --install-deps \
  --issue-cert \
  --email you@example.com \
  --configure-pages \
  --wait-pages \
  --configure-local \
  --reinstall-daemon
```

`--configure-pages` requires GitHub CLI auth on your local machine. With `--wait-pages`, the deploy script waits for the Pages workflow and then runs the full public verification.

## 4. Install the service manually

Clone this repository on the ECS host, then run the installer from the repository root:

```bash
git clone https://github.com/ffffhx/agent-snapshots.git
cd agent-snapshots

sudo DOMAIN=snapshots.example.com \
  SNAPSHOT_GITHUB_CLIENT_ID=your-client-id \
  SNAPSHOT_GITHUB_CLIENT_SECRET=your-client-secret \
  SNAPSHOT_SESSION_SECRET="$(openssl rand -base64 48)" \
  SNAPSHOT_GITHUB_OWNER_LOGIN=your-github-login \
  SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/agent-snapshots/ \
  SNAPSHOT_SHARE_PUBLIC_API_URL=https://snapshots.example.com \
  deploy/aliyun/install-share-api.sh
```

The first run installs an HTTP bootstrap Nginx config if a TLS certificate is not present yet.

## 5. Enable HTTPS manually

Issue a certificate after DNS and port `80` are working:

```bash
sudo certbot --nginx -d snapshots.example.com
```

Then re-run the installer so it switches Nginx to the committed HTTPS proxy template:

```bash
sudo DOMAIN=snapshots.example.com \
  SNAPSHOT_GITHUB_CLIENT_ID=your-client-id \
  SNAPSHOT_GITHUB_CLIENT_SECRET=your-client-secret \
  SNAPSHOT_SESSION_SECRET="$(openssl rand -base64 48)" \
  SNAPSHOT_GITHUB_OWNER_LOGIN=your-github-login \
  SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/agent-snapshots/ \
  SNAPSHOT_SHARE_PUBLIC_API_URL=https://snapshots.example.com \
  deploy/aliyun/install-share-api.sh
```

Verify:

```bash
curl https://snapshots.example.com/api/snapshots/health
curl https://snapshots.example.com/api/snapshots
```

## 6. Connect GitHub Pages

Set this repository variable in GitHub:

```text
AGENT_SNAPSHOTS_PUBLIC_API_URL=https://snapshots.example.com
```

You can set it and trigger the Pages workflow with GitHub CLI:

```bash
deploy/aliyun/configure-github-pages-api.sh \
  --api-url https://snapshots.example.com \
  --repo ffffhx/agent-snapshots
```

The helper refuses placeholder or local-only API URLs so the public site does not get configured to fetch from `127.0.0.1` or `snapshots.example.com`.
The Pages workflow runs the same validation before writing `site/assets/config.js`; empty is allowed, but invalid, example, localhost, and private-network API URLs fail the deploy step.

The Pages workflow writes `site/assets/config.js`, so the public homepage fetches:

```text
https://snapshots.example.com/api/snapshots
```

If this variable is missing, the public site shows that the share API is not configured instead of attempting to fetch from each visitor's `127.0.0.1`.

## 7. Verify the public loop

After the Pages workflow finishes, run the read-only checks:

```bash
node deploy/aliyun/verify-public-share.mjs \
  --api-url https://snapshots.example.com \
  --site-url https://ffffhx.github.io/agent-snapshots/
```

This proves:

- the ECS API is reachable over HTTPS
- public reads work
- CORS allows the public GitHub Pages site
- the static site config points at the ECS API

GitHub OAuth publishing is verified from the browser: open the local viewer, click “发布分享”, log in with GitHub when prompted, and confirm the shared session appears on the public site. For legacy token mode only, add `--publish --token <same-token>` to create one small verification snapshot from the command line.

To verify only the ECS API before Pages has deployed, add `--skip-site-config`.
After configuring the local publisher, add `--check-local-config` to prove that `~/.agent-snapshots-agent.json` also points at the same Aliyun API and public site.

## 8. Publish from your local viewer

Configure your local viewer with the public API and site:

```bash
SNAPSHOT_SHARE_API_URL=https://snapshots.example.com \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/agent-snapshots/ \
deploy/aliyun/configure-local-publisher.sh
```

The helper rejects placeholder and local-only API URLs before it writes `~/.agent-snapshots-agent.json`.
That file stores the public API/site URLs, so the local viewer knows which remote share API to use. With GitHub OAuth, the browser session cookie handles publish/delete auth after login.

Verify the local publisher config:

```bash
node deploy/aliyun/verify-public-share.mjs \
  --api-url https://snapshots.example.com \
  --site-url https://ffffhx.github.io/agent-snapshots/ \
  --skip-site-config \
  --check-local-config
```

Then start the local viewer:

```bash
pnpm snapshot serve --port 4321
```

For the macOS LaunchAgent, let the helper reinstall the daemon with the public API and site URLs:

```bash
SNAPSHOT_SHARE_API_URL=https://snapshots.example.com \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/agent-snapshots/ \
deploy/aliyun/configure-local-publisher.sh --reinstall-daemon
```

The local publisher config can also be edited manually in `~/.agent-snapshots-agent.json`:

```json
{
  "snapshotShareApiUrl": "https://snapshots.example.com",
  "snapshotShareSiteUrl": "https://ffffhx.github.io/agent-snapshots"
}
```

## Operations

Useful ECS commands:

```bash
sudo systemctl status agent-snapshot-share
sudo journalctl -u agent-snapshot-share -f
sudo nginx -t
sudo systemctl reload nginx
sudo cp /var/lib/agent-snapshots/shares.json ~/shares.json.backup
```

You can run the same health checks from your local machine:

```bash
deploy/aliyun/check-ecs-status.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com
```

This checks systemd status, local health, install-file permissions, that port `8787` is only listening locally, Nginx syntax/config, and the public `/api/snapshots/health` endpoint.

Back up the share data from ECS to your local checkout:

```bash
deploy/aliyun/backup-share-data.sh \
  --ssh root@1.2.3.4
```

Restore a local backup to ECS:

```bash
deploy/aliyun/restore-share-data.sh \
  --ssh root@1.2.3.4 \
  --file backups/agent-snapshots/shares-20260101T000000Z.json
```

The restore script validates the JSON locally and saves the previous remote file next to the live data before replacing it.

The share data is stored in:

```text
/var/lib/agent-snapshots/shares.json
```

Local publisher checks:

```bash
curl https://snapshots.example.com/api/snapshots/health
curl https://snapshots.example.com/api/snapshots
```
