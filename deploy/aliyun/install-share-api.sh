#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root, for example: sudo DOMAIN=snapshots.example.com $0" >&2
  exit 1
fi

DOMAIN="${DOMAIN:-}"
if [[ -z "${DOMAIN}" ]]; then
  echo "Missing DOMAIN. Example: sudo DOMAIN=snapshots.example.com $0" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${APP_DIR:-/opt/agent-snapshots}"
ENV_DIR="/etc/agent-snapshots"
STATE_DIR="/var/lib/agent-snapshots"
SERVICE_PATH="/etc/systemd/system/agent-snapshot-share.service"
NGINX_DIR="/etc/nginx/conf.d"
NGINX_PATH="${NGINX_DIR}/agent-snapshots.conf"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
SITE_URL="${SNAPSHOT_SHARE_SITE_URL:-https://ffffhx.github.io/agent-snapshots/}"
API_URL="${SNAPSHOT_SHARE_PUBLIC_API_URL:-https://${DOMAIN}}"
TOKEN="${SNAPSHOT_SHARE_TOKEN:-}"
GITHUB_CLIENT_ID="${SNAPSHOT_GITHUB_CLIENT_ID:-}"
GITHUB_CLIENT_SECRET="${SNAPSHOT_GITHUB_CLIENT_SECRET:-}"
GITHUB_OWNER_LOGIN="${SNAPSHOT_GITHUB_OWNER_LOGIN:-${SNAPSHOT_GITHUB_OWNER:-}}"
GITHUB_OWNER_ID="${SNAPSHOT_GITHUB_OWNER_ID:-}"
SESSION_SECRET="${SNAPSHOT_SESSION_SECRET:-}"
AUTH_ALLOWED_ORIGINS="${SNAPSHOT_AUTH_ALLOWED_ORIGINS:-${SITE_URL%/}}"
SHARE_HOST="${HOST:-127.0.0.1}"
SHARE_PORT="${PORT:-${SNAPSHOT_SHARE_PORT:-8787}}"
PROXY_MODE="${SNAPSHOT_SHARE_PROXY_MODE:-auto}"
PUBLIC_PATH="${SNAPSHOT_SHARE_PUBLIC_PATH:-${SNAPSHOT_SHARE_PROXY_PATH:-}}"
CADDY_FILE="${SNAPSHOT_SHARE_CADDY_FILE:-/etc/caddy/Caddyfile}"
GITHUB_AUTH_ENABLED=0
if [[ -n "${GITHUB_CLIENT_ID}${GITHUB_CLIENT_SECRET}${GITHUB_OWNER_LOGIN}${GITHUB_OWNER_ID}" ]]; then
  GITHUB_AUTH_ENABLED=1
fi

if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 && "${TOKEN}" == "change-me" ]]; then
  TOKEN=""
fi

if [[ -z "${PUBLIC_PATH}" ]]; then
  PUBLIC_PATH="$(node -e 'const url = new URL(process.argv[1]); process.stdout.write(url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, ""));' "${API_URL}")"
fi

if [[ -n "${PUBLIC_PATH}" && "${PUBLIC_PATH}" != /* ]]; then
  PUBLIC_PATH="/${PUBLIC_PATH}"
fi

if [[ -z "${TOKEN}" && "${GITHUB_AUTH_ENABLED}" -ne 1 ]]; then
  TOKEN="$(openssl rand -base64 32)"
  echo "Generated SNAPSHOT_SHARE_TOKEN. Save it for your local publisher:"
  echo "${TOKEN}"
elif [[ -z "${TOKEN}" ]]; then
  echo "No SNAPSHOT_SHARE_TOKEN supplied; GitHub OAuth will authenticate publish/delete."
fi

if [[ -n "${TOKEN}" && ( "${TOKEN}" == *$'\n'* || "${TOKEN}" == *$'\r'* ) ]]; then
  echo "SNAPSHOT_SHARE_TOKEN must be a single-line value." >&2
  exit 1
fi

if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 ]]; then
  if [[ -z "${GITHUB_CLIENT_ID}" || -z "${GITHUB_CLIENT_SECRET}" ]]; then
    echo "GitHub OAuth needs SNAPSHOT_GITHUB_CLIENT_ID and SNAPSHOT_GITHUB_CLIENT_SECRET." >&2
    exit 1
  fi
  if [[ -z "${GITHUB_OWNER_LOGIN}${GITHUB_OWNER_ID}" ]]; then
    echo "GitHub OAuth needs SNAPSHOT_GITHUB_OWNER_LOGIN or SNAPSHOT_GITHUB_OWNER_ID so the site owner can delete any share." >&2
    exit 1
  fi
  if [[ -z "${SESSION_SECRET}" ]]; then
    SESSION_SECRET="$(openssl rand -base64 48)"
    echo "Generated SNAPSHOT_SESSION_SECRET for GitHub login cookies."
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to build and install agent-snapshots runtime dependencies." >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/dist/server/share-api.mjs" ]]; then
  (cd "${REPO_ROOT}" && pnpm install --frozen-lockfile && pnpm build)
fi

systemd_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\\$}"
  value="${value//\`/\\\`}"
  printf '"%s"' "${value}"
}

if ! id codexsnap >/dev/null 2>&1; then
  NOLOGIN_SHELL="/usr/sbin/nologin"
  if [[ ! -x "${NOLOGIN_SHELL}" && -x "/sbin/nologin" ]]; then
    NOLOGIN_SHELL="/sbin/nologin"
  fi
  useradd --system --home-dir "${STATE_DIR}" --shell "${NOLOGIN_SHELL}" codexsnap
fi

install -d -m 0755 "${APP_DIR}"
install -d -m 0750 -o codexsnap -g codexsnap "${STATE_DIR}"
install -d -m 0755 "${ENV_DIR}"
install -d -m 0755 "${NGINX_DIR}"

rsync -a --delete \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "node_modules" \
  --exclude ".agent-snapshots" \
  --exclude "backups" \
  --exclude "deploy/aliyun/deploy.env" \
  --exclude "*.pem" \
  --exclude "*.key" \
  "${REPO_ROOT}/" "${APP_DIR}/"

rm -f "${APP_DIR}/.env" "${APP_DIR}/deploy/aliyun/deploy.env"
rm -rf "${APP_DIR}/backups"

(cd "${APP_DIR}" && pnpm install --prod --frozen-lockfile)

{
  printf 'SNAPSHOT_SHARE_TOKEN=%s\n' "$(systemd_env_value "${TOKEN}")"
  printf 'HOST=%s\n' "$(systemd_env_value "${SHARE_HOST}")"
  printf 'PORT=%s\n' "$(systemd_env_value "${SHARE_PORT}")"
  printf 'SNAPSHOT_SHARE_SITE_URL=%s\n' "$(systemd_env_value "${SITE_URL}")"
  printf 'SNAPSHOT_SHARE_PUBLIC_API_URL=%s\n' "$(systemd_env_value "${API_URL}")"
  printf 'SNAPSHOT_SHARE_VIEWER_PATH=%s\n' "$(systemd_env_value "/share/")"
  printf 'SNAPSHOT_SHARE_DATA_FILE=%s\n' "$(systemd_env_value "${STATE_DIR}/shares.json")"
  printf 'SNAPSHOT_SHARE_ALLOW_ANONYMOUS=%s\n' "$(systemd_env_value "false")"
  if [[ -n "${GITHUB_CLIENT_ID}${GITHUB_CLIENT_SECRET}" ]]; then
    printf 'SNAPSHOT_GITHUB_CLIENT_ID=%s\n' "$(systemd_env_value "${GITHUB_CLIENT_ID}")"
    printf 'SNAPSHOT_GITHUB_CLIENT_SECRET=%s\n' "$(systemd_env_value "${GITHUB_CLIENT_SECRET}")"
    printf 'SNAPSHOT_SESSION_SECRET=%s\n' "$(systemd_env_value "${SESSION_SECRET}")"
    printf 'SNAPSHOT_GITHUB_OWNER_LOGIN=%s\n' "$(systemd_env_value "${GITHUB_OWNER_LOGIN}")"
    printf 'SNAPSHOT_GITHUB_OWNER_ID=%s\n' "$(systemd_env_value "${GITHUB_OWNER_ID}")"
    printf 'SNAPSHOT_AUTH_ALLOWED_ORIGINS=%s\n' "$(systemd_env_value "${AUTH_ALLOWED_ORIGINS}")"
  fi
} > "${ENV_DIR}/share-api.env"
chmod 0600 "${ENV_DIR}/share-api.env"
chown root:root "${ENV_DIR}/share-api.env"

install -m 0644 "${REPO_ROOT}/deploy/aliyun/agent-snapshot-share.service" "${SERVICE_PATH}"

systemctl daemon-reload
systemctl enable --now agent-snapshot-share.service

if [[ "${PROXY_MODE}" == "auto" ]]; then
  if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy; then
    PROXY_MODE="caddy"
  else
    PROXY_MODE="nginx"
  fi
fi

if [[ "${PROXY_MODE}" == "caddy" ]]; then
  if [[ -z "${PUBLIC_PATH}" ]]; then
    echo "SNAPSHOT_SHARE_PUBLIC_PATH is required for Caddy path proxy mode." >&2
    exit 1
  fi
  if [[ ! -f "${CADDY_FILE}" ]]; then
    echo "Caddyfile not found: ${CADDY_FILE}" >&2
    exit 1
  fi
  SNAPSHOT_SHARE_CADDY_FILE="${CADDY_FILE}" \
  SNAPSHOT_SHARE_PUBLIC_PATH="${PUBLIC_PATH}" \
  SNAPSHOT_SHARE_PORT="${SHARE_PORT}" \
  node <<'NODE'
const fs = require("node:fs");

const filePath = process.env.SNAPSHOT_SHARE_CADDY_FILE;
const publicPath = process.env.SNAPSHOT_SHARE_PUBLIC_PATH.replace(/\/+$/, "");
const port = process.env.SNAPSHOT_SHARE_PORT;
const markerStart = "\t# agent-snapshots-share start";
const markerEnd = "\t# agent-snapshots-share end";
const route = [
  markerStart,
  `\thandle_path ${publicPath}/* {`,
  `\t\treverse_proxy 127.0.0.1:${port}`,
  "\t}",
  markerEnd,
].join("\n");

let text = fs.readFileSync(filePath, "utf8");
text = text.replace(/\n\t# agent-snapshots-share start[\s\S]*?\n\t# agent-snapshots-share end\n?/g, "\n");

const start = text.indexOf("(room_services) {");
if (start === -1) {
  throw new Error("Could not find (room_services) block in Caddyfile.");
}

let depth = 0;
let insertAt = -1;
for (let index = start; index < text.length; index += 1) {
  const char = text[index];
  if (char === "{") {
    depth += 1;
  } else if (char === "}") {
    depth -= 1;
    if (depth === 0) {
      insertAt = index;
      break;
    }
  }
}

if (insertAt === -1) {
  throw new Error("Could not find end of (room_services) block in Caddyfile.");
}

text = `${text.slice(0, insertAt)}${route}\n${text.slice(insertAt)}`;
fs.writeFileSync(filePath, text);
NODE
  caddy fmt --overwrite "${CADDY_FILE}" >/dev/null || true
  caddy validate --config "${CADDY_FILE}"
  systemctl reload caddy || systemctl restart caddy
elif [[ "${PROXY_MODE}" == "nginx" ]]; then
  install -d -m 0755 "${NGINX_DIR}"
  if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
    NGINX_TEMPLATE="${REPO_ROOT}/deploy/aliyun/nginx-agent-snapshots.conf"
  else
    NGINX_TEMPLATE="${REPO_ROOT}/deploy/aliyun/nginx-agent-snapshots.bootstrap.conf"
    echo "TLS certificate not found at ${CERT_DIR}; installing HTTP bootstrap Nginx config."
    echo "After issuing a certificate, re-run this script to install the HTTPS config."
  fi

  sed "s/snapshots\\.example\\.com/${DOMAIN//\//\\/}/g" "${NGINX_TEMPLATE}" > "${NGINX_PATH}"

  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    systemctl reload nginx || systemctl restart nginx
  else
    echo "Nginx is not installed yet. Install nginx, then run: nginx -t && systemctl reload nginx"
  fi
elif [[ "${PROXY_MODE}" == "none" ]]; then
  echo "Skipped reverse proxy configuration."
else
  echo "Unknown SNAPSHOT_SHARE_PROXY_MODE: ${PROXY_MODE}" >&2
  exit 1
fi

echo "Share API service installed."
echo "Local health check: curl http://${SHARE_HOST}:${SHARE_PORT}/api/snapshots/health"
echo "Public health check: curl ${API_URL%/}/api/snapshots/health"
echo "Set GitHub repository variable AGENT_SNAPSHOTS_PUBLIC_API_URL=${API_URL}"
