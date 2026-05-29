# Deploy the Share API on Alibaba Cloud ECS

This deployment runs `codex-snapshot-share` on `127.0.0.1:8787`, exposes it through Nginx + HTTPS, and lets the GitHub Pages site list and render public sessions.

Replace these examples before running commands:

- `snapshots.example.com`: your public API domain
- `change-me`: a strong shared publish token
- `https://ffffhx.github.io/codex-snapshots/`: the public static site

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
  --generate-token \
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

`deploy/aliyun/deploy.env` is ignored by git because it contains host details and the publish token.
The dry run validates that you replaced template values like `root@1.2.3.4`, `snapshots.example.com`, `change-me`, and `you@example.com` before anything connects to ECS.
The doctor command adds local readiness checks for DNS, local `ssh`/`rsync`/`node`, GitHub CLI when Pages auto-config is enabled, token source, and the deploy dry run. Pass `--offline` if DNS has not propagated yet.
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
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --generate-token \
  --configure-local
```

This runs the preflight checks, rsyncs the repository to the ECS host, installs the systemd service, and writes the Nginx bootstrap config. If you have already checked the host and want to skip preflight, pass `--no-preflight`.
`--generate-token` creates a strong publish token for the deployment. Pair it with `--configure-local` so the same token is written to `~/.codex-snapshots-agent.json` for the local “发布分享” button.

After port `80` works, issue HTTPS and switch to the HTTPS proxy template:

```bash
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --issue-cert \
  --email you@example.com
```

When `~/.codex-snapshots-agent.json` exists, the deploy script can reuse its token for follow-up deploys such as issuing HTTPS. The deploy script verifies the ECS API and an authenticated publish at the end. It skips the GitHub Pages config check because the Pages workflow may not have run yet. Configure Pages in step 6, then run the full public loop verification in step 7.

You can also let the deploy command configure GitHub Pages and the local publisher in the same run:

```bash
deploy/aliyun/deploy-to-ecs.sh \
  --ssh root@1.2.3.4 \
  --domain snapshots.example.com \
  --generate-token \
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
git clone https://github.com/ffffhx/codex-snapshots.git
cd codex-snapshots

sudo DOMAIN=snapshots.example.com \
  SNAPSHOT_SHARE_TOKEN=change-me \
  SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
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
  SNAPSHOT_SHARE_TOKEN=change-me \
  SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
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
CODEX_SNAPSHOTS_PUBLIC_API_URL=https://snapshots.example.com
```

You can set it and trigger the Pages workflow with GitHub CLI:

```bash
deploy/aliyun/configure-github-pages-api.sh \
  --api-url https://snapshots.example.com \
  --repo ffffhx/codex-snapshots
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
  --site-url https://ffffhx.github.io/codex-snapshots/
```

Then run the authenticated publish check:

```bash
node deploy/aliyun/verify-public-share.mjs \
  --api-url https://snapshots.example.com \
  --site-url https://ffffhx.github.io/codex-snapshots/ \
  --token change-me \
  --publish
```

This creates one small verification snapshot and proves:

- the ECS API is reachable over HTTPS
- public reads work
- authenticated writes work
- the returned share URL points at the GitHub Pages `/share/` viewer
- the static site config points at the ECS API

To verify only the ECS API before Pages has deployed, add `--skip-site-config`.
After configuring the local publisher, add `--check-local-config` to prove that `~/.codex-snapshots-agent.json` also points at the same Aliyun API and public site.

## 8. Publish from your local viewer

Configure your local publisher with the same token and public API:

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
SNAPSHOT_SHARE_API_URL=https://snapshots.example.com \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
deploy/aliyun/configure-local-publisher.sh
```

The helper also rejects placeholder tokens and local-only API URLs before it writes `~/.codex-snapshots-agent.json`.
That file stores the publish token plus the public API/site URLs, so the local viewer can publish to Aliyun without exporting environment variables every time.

Verify the local publisher config:

```bash
node deploy/aliyun/verify-public-share.mjs \
  --api-url https://snapshots.example.com \
  --site-url https://ffffhx.github.io/codex-snapshots/ \
  --skip-site-config \
  --check-local-config
```

Then start the local viewer:

```bash
pnpm snapshot serve --port 4321
```

For the macOS LaunchAgent, let the helper reinstall the daemon with the public API and site URLs:

```bash
SNAPSHOT_SHARE_TOKEN=change-me \
SNAPSHOT_SHARE_API_URL=https://snapshots.example.com \
SNAPSHOT_SHARE_SITE_URL=https://ffffhx.github.io/codex-snapshots/ \
deploy/aliyun/configure-local-publisher.sh --reinstall-daemon
```

The local publisher config can also be edited manually in `~/.codex-snapshots-agent.json`:

```json
{
  "snapshotShareToken": "change-me",
  "snapshotShareApiUrl": "https://snapshots.example.com",
  "snapshotShareSiteUrl": "https://ffffhx.github.io/codex-snapshots"
}
```

## Operations

Useful ECS commands:

```bash
sudo systemctl status codex-snapshot-share
sudo journalctl -u codex-snapshot-share -f
sudo nginx -t
sudo systemctl reload nginx
sudo cp /var/lib/codex-snapshots/shares.json ~/shares.json.backup
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
  --file backups/codex-snapshots/shares-20260101T000000Z.json
```

The restore script validates the JSON locally and saves the previous remote file next to the live data before replacing it.

The share data is stored in:

```text
/var/lib/codex-snapshots/shares.json
```

Local publisher checks:

```bash
curl https://snapshots.example.com/api/snapshots/health
curl https://snapshots.example.com/api/snapshots
```
