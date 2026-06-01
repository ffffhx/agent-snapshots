#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${CODEX_SNAPSHOTS_ALIYUN_CONFIG:-}"

for ((index = 1; index <= $#; index += 1)); do
  if [[ "${!index}" == "--config" ]]; then
    next_index=$((index + 1))
    CONFIG_FILE="${!next_index:-}"
    break
  fi
done

if [[ -n "${CONFIG_FILE}" ]]; then
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Config file not found: ${CONFIG_FILE}" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "${CONFIG_FILE}"
fi

SSH_TARGET="${SSH_TARGET:-${ALIYUN_SSH_TARGET:-}}"
DOMAIN="${DOMAIN:-${ALIYUN_DOMAIN:-}}"
SITE_URL="${SITE_URL:-${SNAPSHOT_SHARE_SITE_URL:-https://ffffhx.github.io/codex-snapshots/}}"
API_URL="${API_URL:-${SNAPSHOT_SHARE_PUBLIC_API_URL:-}}"
TOKEN="${TOKEN:-${SNAPSHOT_SHARE_TOKEN:-}}"
GITHUB_CLIENT_ID="${SNAPSHOT_GITHUB_CLIENT_ID:-${GITHUB_CLIENT_ID:-}}"
GITHUB_CLIENT_SECRET="${SNAPSHOT_GITHUB_CLIENT_SECRET:-${GITHUB_CLIENT_SECRET:-}}"
GITHUB_OWNER_LOGIN="${SNAPSHOT_GITHUB_OWNER_LOGIN:-${SNAPSHOT_GITHUB_OWNER:-}}"
GITHUB_OWNER_ID="${SNAPSHOT_GITHUB_OWNER_ID:-}"
SESSION_SECRET="${SNAPSHOT_SESSION_SECRET:-}"
AUTH_ALLOWED_ORIGINS="${SNAPSHOT_AUTH_ALLOWED_ORIGINS:-}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/codex-snapshots-deploy}"
SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE:-${ALIYUN_SSH_IDENTITY_FILE:-}}"
SSH_PORT="${SSH_PORT:-${ALIYUN_SSH_PORT:-}}"
SHARE_PORT="${SHARE_PORT:-${SNAPSHOT_SHARE_PORT:-8787}}"
PROXY_MODE="${PROXY_MODE:-${SNAPSHOT_SHARE_PROXY_MODE:-auto}}"
PUBLIC_PATH="${PUBLIC_PATH:-${SNAPSHOT_SHARE_PUBLIC_PATH:-}}"
GENERATE_TOKEN="${GENERATE_TOKEN:-0}"
ISSUE_CERT="${ISSUE_CERT:-0}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
RUN_VERIFY="${RUN_VERIFY:-1}"
RUN_PREFLIGHT="${RUN_PREFLIGHT:-1}"
INSTALL_DEPS="${INSTALL_DEPS:-0}"
DRY_RUN="${DRY_RUN:-0}"
CONFIGURE_PAGES="${CONFIGURE_PAGES:-0}"
PAGES_REPO="${PAGES_REPO:-${GITHUB_REPOSITORY:-ffffhx/codex-snapshots}}"
PAGES_WORKFLOW="${PAGES_WORKFLOW:-pages.yml}"
WAIT_PAGES="${WAIT_PAGES:-0}"
CONFIGURE_LOCAL="${CONFIGURE_LOCAL:-0}"
REINSTALL_DAEMON="${REINSTALL_DAEMON:-0}"

usage() {
  cat <<'EOF'
Usage:
  deploy/aliyun/deploy-to-ecs.sh \
    --ssh root@1.2.3.4 \
    --domain snapshots.example.com \
    --configure-local \
    [--issue-cert --email you@example.com]

Options:
  --ssh TARGET          SSH target, for example root@1.2.3.4.
  --config FILE         Source deployment variables from a local env file.
  --domain DOMAIN      Public API domain pointing to the ECS public IP.
  --token TOKEN        Optional legacy publish token. Defaults to SNAPSHOT_SHARE_TOKEN or
                       ~/.codex-snapshots-agent.json when present.
  --generate-token     Generate a strong legacy publish token for this run.
  GitHub OAuth vars   Set SNAPSHOT_GITHUB_CLIENT_ID, SNAPSHOT_GITHUB_CLIENT_SECRET,
                       SNAPSHOT_SESSION_SECRET, and SNAPSHOT_GITHUB_OWNER_LOGIN/ID
                       in the config file to require GitHub login for publish/delete.
  --site-url URL       Public static site URL. Defaults to https://ffffhx.github.io/codex-snapshots/.
  --api-url URL        Public API URL. Defaults to https://<domain>.
  --remote-dir DIR     Temporary remote deployment directory. Defaults to /tmp/codex-snapshots-deploy.
  --identity-file FILE SSH private key for the ECS host.
  --port PORT          SSH port. Defaults to the ssh client default.
  --service-port PORT  Local share API port on ECS. Defaults to 8787.
  --proxy-mode MODE    Reverse proxy mode: auto, nginx, caddy, or none. Defaults to auto.
  --public-path PATH   Public path prefix for Caddy path proxy, for example /codex-snapshots.
  --issue-cert         Run certbot on the ECS host, then reinstall HTTPS Nginx config.
  --email EMAIL        Certbot email. Required with --issue-cert for non-interactive certbot.
  --install-deps       Install Node.js 20, Nginx, Certbot, Git, OpenSSL, and rsync on ECS first.
  --dry-run            Print the resolved deployment plan without connecting to ECS.
  --no-preflight       Skip DNS, SSH, and remote dependency checks before deploying.
  --no-verify          Skip final ECS API verification.
  --configure-pages    Set the GitHub Pages API variable and trigger the Pages workflow.
  --repo OWNER/REPO    GitHub repository for --configure-pages. Defaults to ffffhx/codex-snapshots.
  --workflow FILE      GitHub Pages workflow for --configure-pages. Defaults to pages.yml.
  --wait-pages         With --configure-pages, wait for Pages and run full public verification.
  --configure-local    Write the local viewer API/site config after deploy.
  --reinstall-daemon   With --configure-local, reinstall the macOS LaunchAgent.
  -h, --help           Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh)
      SSH_TARGET="${2:-}"
      shift 2
      ;;
    --config)
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --generate-token)
      GENERATE_TOKEN=1
      shift
      ;;
    --site-url)
      SITE_URL="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="${2:-}"
      shift 2
      ;;
    --identity-file)
      SSH_IDENTITY_FILE="${2:-}"
      shift 2
      ;;
    --port)
      SSH_PORT="${2:-}"
      shift 2
      ;;
    --service-port)
      SHARE_PORT="${2:-}"
      shift 2
      ;;
    --proxy-mode)
      PROXY_MODE="${2:-}"
      shift 2
      ;;
    --public-path)
      PUBLIC_PATH="${2:-}"
      shift 2
      ;;
    --issue-cert)
      ISSUE_CERT=1
      shift
      ;;
    --email)
      CERTBOT_EMAIL="${2:-}"
      shift 2
      ;;
    --install-deps)
      INSTALL_DEPS=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-preflight)
      RUN_PREFLIGHT=0
      shift
      ;;
    --no-verify)
      RUN_VERIFY=0
      shift
      ;;
    --configure-pages)
      CONFIGURE_PAGES=1
      shift
      ;;
    --repo)
      PAGES_REPO="${2:-}"
      shift 2
      ;;
    --workflow)
      PAGES_WORKFLOW="${2:-}"
      shift 2
      ;;
    --wait-pages)
      CONFIGURE_PAGES=1
      WAIT_PAGES=1
      shift
      ;;
    --configure-local)
      CONFIGURE_LOCAL=1
      shift
      ;;
    --reinstall-daemon)
      CONFIGURE_LOCAL=1
      REINSTALL_DAEMON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SSH_TARGET}" ]]; then
  echo "Missing --ssh target." >&2
  usage >&2
  exit 1
fi

if [[ -z "${DOMAIN}" ]]; then
  echo "Missing --domain." >&2
  usage >&2
  exit 1
fi

if [[ "${ISSUE_CERT}" -eq 1 && -z "${CERTBOT_EMAIL}" ]]; then
  echo "--issue-cert requires --email for non-interactive certbot." >&2
  exit 1
fi

if [[ -z "${API_URL}" ]]; then
  API_URL="https://${DOMAIN}"
fi

if [[ -z "${PUBLIC_PATH}" ]]; then
  PUBLIC_PATH="$(node -e 'const url = new URL(process.argv[1]); process.stdout.write(url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, ""));' "${API_URL}")"
fi

if [[ -n "${PUBLIC_PATH}" && "${PUBLIC_PATH}" != /* ]]; then
  PUBLIC_PATH="/${PUBLIC_PATH}"
fi

lowercase() {
  printf "%s" "$1" | tr '[:upper:]' '[:lower:]'
}

is_placeholder_domain() {
  local value
  value="$(lowercase "$1")"
  [[ "${value}" == "example.com" || "${value}" == *.example.com || "${value}" == "snapshots.example.com" ]]
}

url_host() {
  local value="${1#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  if [[ "${value}" == \[*\]* ]]; then
    value="${value#\[}"
    value="${value%%\]*}"
  else
    value="${value%%:*}"
  fi
  lowercase "${value}"
}

is_http_url() {
  [[ "$1" == http://* || "$1" == https://* ]]
}

is_ipv4_address() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

is_enabled() {
  local value
  value="$(lowercase "$1")"
  [[ "${value}" == "1" || "${value}" == "true" || "${value}" == "yes" || "${value}" == "on" ]]
}

is_auto_token() {
  local value
  value="$(lowercase "$1")"
  [[ "${value}" == "auto" || "${value}" == "generate" || "${value}" == "generated" ]]
}

generate_publish_token() {
  node -e 'const { randomBytes } = require("node:crypto"); process.stdout.write(randomBytes(32).toString("base64url"));'
}

read_local_publish_token() {
  node <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const candidates = [
  process.env.CODEX_SNAPSHOTS_AGENT_FILE,
  process.env.SNAPSHOT_SHARE_TOKEN_FILE,
  path.join(os.homedir(), ".codex-snapshots-agent.json"),
].filter(Boolean);

for (const filePath of candidates) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const token = [
      payload.snapshotShareToken,
      payload.agentToken,
      payload.token,
      payload.uploadToken,
    ].find((value) => typeof value === "string" && value.trim());
    if (token) {
      process.stdout.write(token.trim());
      process.exit(0);
    }
  } catch {}
}
NODE
}

TOKEN_GENERATED=0
if [[ -z "${TOKEN}" ]]; then
  TOKEN="$(read_local_publish_token)"
fi

if is_enabled "${GENERATE_TOKEN}" || is_auto_token "${TOKEN}"; then
  TOKEN="$(generate_publish_token)"
  TOKEN_GENERATED=1
fi

GITHUB_AUTH_ENABLED=0
if [[ -n "${GITHUB_CLIENT_ID}${GITHUB_CLIENT_SECRET}${GITHUB_OWNER_LOGIN}${GITHUB_OWNER_ID}" ]]; then
  GITHUB_AUTH_ENABLED=1
fi

if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 && "${TOKEN}" == "change-me" ]]; then
  TOKEN=""
fi

if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 && -z "${SESSION_SECRET}" ]]; then
  SESSION_SECRET="$(node -e 'const { randomBytes } = require("node:crypto"); process.stdout.write(randomBytes(48).toString("base64url"));')"
fi

if [[ -z "${TOKEN}" && "${GITHUB_AUTH_ENABLED}" -ne 1 ]]; then
  echo "Missing --token, SNAPSHOT_SHARE_TOKEN, ~/.codex-snapshots-agent.json token, TOKEN=auto, or --generate-token." >&2
  usage >&2
  exit 1
fi

validate_deploy_inputs() {
  local errors=()
  local ssh_host="${SSH_TARGET##*@}"
  ssh_host="${ssh_host#\[}"
  ssh_host="${ssh_host%%]*}"
  ssh_host="${ssh_host%%:*}"
  local api_host
  api_host="$(url_host "${API_URL}")"
  local site_host
  site_host="$(url_host "${SITE_URL}")"

  if [[ "${SSH_TARGET}" == "root@1.2.3.4" || "${ssh_host}" == "1.2.3.4" ]]; then
    errors+=("SSH target still uses the placeholder root@1.2.3.4.")
  fi
  if is_placeholder_domain "${DOMAIN}"; then
    errors+=("DOMAIN still uses the placeholder snapshots.example.com.")
  fi
  if is_placeholder_domain "${api_host}"; then
    errors+=("API_URL still uses the placeholder https://snapshots.example.com.")
  fi
  if [[ "${api_host}" == "127.0.0.1" || "${api_host}" == "localhost" || "${api_host}" == "::1" ]]; then
    errors+=("API_URL must be a public URL, not ${API_URL}.")
  fi
  if [[ "${site_host}" == "127.0.0.1" || "${site_host}" == "localhost" || "${site_host}" == "::1" ]]; then
    errors+=("SITE_URL must be the public site URL, not ${SITE_URL}.")
  fi
  if ! is_http_url "${API_URL}"; then
    errors+=("API_URL must start with http:// or https://.")
  fi
  if ! is_http_url "${SITE_URL}"; then
    errors+=("SITE_URL must start with http:// or https://.")
  fi
  if [[ -n "${TOKEN}" ]]; then
    if [[ "${TOKEN}" == "change-me" ]]; then
      errors+=("TOKEN still uses the placeholder change-me.")
    elif [[ "${#TOKEN}" -lt 16 ]]; then
      errors+=("TOKEN should be at least 16 characters.")
    fi
  elif [[ "${GITHUB_AUTH_ENABLED}" -ne 1 ]]; then
    errors+=("TOKEN is required unless GitHub OAuth is configured.")
  fi
  if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 ]]; then
    if [[ -z "${GITHUB_CLIENT_ID}" || -z "${GITHUB_CLIENT_SECRET}" ]]; then
      errors+=("GitHub OAuth needs SNAPSHOT_GITHUB_CLIENT_ID and SNAPSHOT_GITHUB_CLIENT_SECRET.")
    fi
    if [[ -z "${GITHUB_OWNER_LOGIN}${GITHUB_OWNER_ID}" ]]; then
      errors+=("GitHub OAuth needs SNAPSHOT_GITHUB_OWNER_LOGIN or SNAPSHOT_GITHUB_OWNER_ID.")
    fi
    if [[ "${SESSION_SECRET}" == "change-me" || "${#SESSION_SECRET}" -lt 32 ]]; then
      errors+=("SNAPSHOT_SESSION_SECRET should be a real secret with at least 32 characters.")
    fi
  fi
  if [[ "${ISSUE_CERT}" -eq 1 ]]; then
    if [[ "${CERTBOT_EMAIL}" == "you@example.com" || "${CERTBOT_EMAIL}" != *@* ]]; then
      errors+=("CERTBOT_EMAIL must be a real email when ISSUE_CERT=1.")
    fi
    if is_ipv4_address "${DOMAIN}"; then
      errors+=("DOMAIN must be a DNS name, not an IP address, when ISSUE_CERT=1.")
    fi
  fi
  if [[ ! "${PROXY_MODE}" =~ ^(auto|nginx|caddy|none)$ ]]; then
    errors+=("PROXY_MODE must be auto, nginx, caddy, or none.")
  fi
  if [[ ! "${SHARE_PORT}" =~ ^[0-9]+$ || "${SHARE_PORT}" -le 0 || "${SHARE_PORT}" -gt 65535 ]]; then
    errors+=("SHARE_PORT must be a valid TCP port.")
  fi
  if [[ "${PROXY_MODE}" == "caddy" && -z "${PUBLIC_PATH}" ]]; then
    errors+=("PUBLIC_PATH is required when PROXY_MODE=caddy.")
  fi

  if [[ "${#errors[@]}" -gt 0 ]]; then
    echo "Deployment config needs real values before continuing:" >&2
    printf "  - %s\n" "${errors[@]}" >&2
    echo "Edit deploy/aliyun/deploy.env or pass the corresponding CLI flags." >&2
    exit 1
  fi
}

validate_deploy_inputs

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\"'\"'/g"
  printf "'"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RSYNC_SSH=(ssh)
if [[ -n "${SSH_IDENTITY_FILE}" ]]; then
  RSYNC_SSH+=("-i" "${SSH_IDENTITY_FILE}")
fi
if [[ -n "${SSH_PORT}" ]]; then
  RSYNC_SSH+=("-p" "${SSH_PORT}")
fi
REMOTE_DIR_Q="$(shell_quote "${REMOTE_DIR}")"
DOMAIN_Q="$(shell_quote "${DOMAIN}")"
TOKEN_Q="$(shell_quote "${TOKEN}")"
GITHUB_CLIENT_ID_Q="$(shell_quote "${GITHUB_CLIENT_ID}")"
GITHUB_CLIENT_SECRET_Q="$(shell_quote "${GITHUB_CLIENT_SECRET}")"
GITHUB_OWNER_LOGIN_Q="$(shell_quote "${GITHUB_OWNER_LOGIN}")"
GITHUB_OWNER_ID_Q="$(shell_quote "${GITHUB_OWNER_ID}")"
SESSION_SECRET_Q="$(shell_quote "${SESSION_SECRET}")"
AUTH_ALLOWED_ORIGINS_Q="$(shell_quote "${AUTH_ALLOWED_ORIGINS}")"
SITE_URL_Q="$(shell_quote "${SITE_URL}")"
API_URL_Q="$(shell_quote "${API_URL}")"
CERTBOT_EMAIL_Q="$(shell_quote "${CERTBOT_EMAIL}")"
SHARE_PORT_Q="$(shell_quote "${SHARE_PORT}")"
PROXY_MODE_Q="$(shell_quote "${PROXY_MODE}")"
PUBLIC_PATH_Q="$(shell_quote "${PUBLIC_PATH}")"

echo "Deploying Codex Snapshots share API to ${SSH_TARGET}"
echo "Domain: ${DOMAIN}"
echo "API URL: ${API_URL}"
echo "Site URL: ${SITE_URL}"
if [[ "${TOKEN_GENERATED}" -eq 1 ]]; then
  echo "Publish token: generated for this deployment"
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  cat <<EOF

Resolved deployment plan:
  SSH target: ${SSH_TARGET}
  SSH identity file: ${SSH_IDENTITY_FILE:-"(default)"}
  SSH port: ${SSH_PORT:-"(default)"}
  Domain: ${DOMAIN}
  API URL: ${API_URL}
  Site URL: ${SITE_URL}
  Remote dir: ${REMOTE_DIR}
  Service port: ${SHARE_PORT}
  Proxy mode: ${PROXY_MODE}
  Public path: ${PUBLIC_PATH:-"(none)"}
  Token: $(if [[ -z "${TOKEN}" ]]; then printf "not configured (GitHub OAuth mode)"; elif [[ "${TOKEN_GENERATED}" -eq 1 ]]; then printf "generated (%s chars)" "${#TOKEN}"; else printf "set (%s chars)" "${#TOKEN}"; fi)
  GitHub OAuth: $([[ -n "${GITHUB_CLIENT_ID}${GITHUB_CLIENT_SECRET}" ]] && printf "configured" || printf "not configured")
  GitHub site owner: ${GITHUB_OWNER_LOGIN:-${GITHUB_OWNER_ID:-"(unset)"}}
  Install deps: ${INSTALL_DEPS}
  Preflight: ${RUN_PREFLIGHT}
  Issue cert: ${ISSUE_CERT}
  Certbot email: ${CERTBOT_EMAIL:-"(unset)"}
  Verify ECS API: ${RUN_VERIFY}
  Configure Pages: ${CONFIGURE_PAGES}
  Wait Pages: ${WAIT_PAGES}
  Pages repo: ${PAGES_REPO}
  Pages workflow: ${PAGES_WORKFLOW}
  Configure local publisher: ${CONFIGURE_LOCAL}
  Reinstall local daemon: ${REINSTALL_DAEMON}
EOF
  exit 0
fi

if [[ "${INSTALL_DEPS}" -eq 1 ]]; then
  remote_install_deps_cmd=$(
    cat <<EOF
set -e
tmp_script="\$(mktemp /tmp/codex-snapshots-install-deps.XXXXXX.sh)"
cat > "\${tmp_script}"
chmod +x "\${tmp_script}"
if [ "\$(id -u)" -eq 0 ]; then
  SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} "\${tmp_script}"
else
  sudo -n env SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} "\${tmp_script}"
fi
rm -f "\${tmp_script}"
EOF
  )
  "${RSYNC_SSH[@]}" "${SSH_TARGET}" "${remote_install_deps_cmd}" < "${REPO_ROOT}/deploy/aliyun/install-system-deps.sh"
fi

if [[ "${RUN_PREFLIGHT}" -eq 1 ]]; then
  preflight_args=(--domain "${DOMAIN}" --ssh "${SSH_TARGET}")
  if [[ -n "${SSH_IDENTITY_FILE}" ]]; then
    preflight_args+=(--identity-file "${SSH_IDENTITY_FILE}")
  fi
  if [[ -n "${SSH_PORT}" ]]; then
    preflight_args+=(--port "${SSH_PORT}")
  fi
  if [[ "${ISSUE_CERT}" -eq 1 ]]; then
    preflight_args+=(--require-certbot-nginx)
  fi
  if [[ "${PROXY_MODE}" == "caddy" ]]; then
    preflight_args+=(--proxy-mode caddy)
  fi
  node "${REPO_ROOT}/deploy/aliyun/preflight.mjs" "${preflight_args[@]}"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to build dist assets before deploy." >&2
  exit 1
fi

(cd "${REPO_ROOT}" && pnpm build)

"${RSYNC_SSH[@]}" "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR_Q}"
rsync -az --delete \
  -e "$(printf '%q ' "${RSYNC_SSH[@]}")" \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "node_modules" \
  --exclude ".codex-snapshots" \
  --exclude "backups" \
  --exclude "deploy/aliyun/deploy.env" \
  --exclude "*.pem" \
  --exclude "*.key" \
  "${REPO_ROOT}/" "${SSH_TARGET}:${REMOTE_DIR}/"

remote_install_cmd=$(
  cat <<EOF
set -e
cd ${REMOTE_DIR_Q}
rm -f .env deploy/aliyun/deploy.env
rm -rf backups
if [ "\$(id -u)" -eq 0 ]; then
  env DOMAIN=${DOMAIN_Q} SNAPSHOT_SHARE_TOKEN=${TOKEN_Q} SNAPSHOT_SHARE_SITE_URL=${SITE_URL_Q} SNAPSHOT_SHARE_PUBLIC_API_URL=${API_URL_Q} SNAPSHOT_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID_Q} SNAPSHOT_GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET_Q} SNAPSHOT_GITHUB_OWNER_LOGIN=${GITHUB_OWNER_LOGIN_Q} SNAPSHOT_GITHUB_OWNER_ID=${GITHUB_OWNER_ID_Q} SNAPSHOT_SESSION_SECRET=${SESSION_SECRET_Q} SNAPSHOT_AUTH_ALLOWED_ORIGINS=${AUTH_ALLOWED_ORIGINS_Q} PORT=${SHARE_PORT_Q} SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} SNAPSHOT_SHARE_PUBLIC_PATH=${PUBLIC_PATH_Q} deploy/aliyun/install-share-api.sh
else
  sudo env DOMAIN=${DOMAIN_Q} SNAPSHOT_SHARE_TOKEN=${TOKEN_Q} SNAPSHOT_SHARE_SITE_URL=${SITE_URL_Q} SNAPSHOT_SHARE_PUBLIC_API_URL=${API_URL_Q} SNAPSHOT_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID_Q} SNAPSHOT_GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET_Q} SNAPSHOT_GITHUB_OWNER_LOGIN=${GITHUB_OWNER_LOGIN_Q} SNAPSHOT_GITHUB_OWNER_ID=${GITHUB_OWNER_ID_Q} SNAPSHOT_SESSION_SECRET=${SESSION_SECRET_Q} SNAPSHOT_AUTH_ALLOWED_ORIGINS=${AUTH_ALLOWED_ORIGINS_Q} PORT=${SHARE_PORT_Q} SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} SNAPSHOT_SHARE_PUBLIC_PATH=${PUBLIC_PATH_Q} deploy/aliyun/install-share-api.sh
fi
EOF
)

"${RSYNC_SSH[@]}" "${SSH_TARGET}" "${remote_install_cmd}"

if [[ "${ISSUE_CERT}" -eq 1 ]]; then
  remote_cert_cmd=$(
    cat <<EOF
set -e
if [ "\$(id -u)" -eq 0 ]; then
  certbot --nginx -d ${DOMAIN_Q} --non-interactive --agree-tos --email ${CERTBOT_EMAIL_Q}
else
  sudo certbot --nginx -d ${DOMAIN_Q} --non-interactive --agree-tos --email ${CERTBOT_EMAIL_Q}
fi
cd ${REMOTE_DIR_Q}
rm -f .env deploy/aliyun/deploy.env
rm -rf backups
if [ "\$(id -u)" -eq 0 ]; then
  env DOMAIN=${DOMAIN_Q} SNAPSHOT_SHARE_TOKEN=${TOKEN_Q} SNAPSHOT_SHARE_SITE_URL=${SITE_URL_Q} SNAPSHOT_SHARE_PUBLIC_API_URL=${API_URL_Q} SNAPSHOT_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID_Q} SNAPSHOT_GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET_Q} SNAPSHOT_GITHUB_OWNER_LOGIN=${GITHUB_OWNER_LOGIN_Q} SNAPSHOT_GITHUB_OWNER_ID=${GITHUB_OWNER_ID_Q} SNAPSHOT_SESSION_SECRET=${SESSION_SECRET_Q} SNAPSHOT_AUTH_ALLOWED_ORIGINS=${AUTH_ALLOWED_ORIGINS_Q} PORT=${SHARE_PORT_Q} SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} SNAPSHOT_SHARE_PUBLIC_PATH=${PUBLIC_PATH_Q} deploy/aliyun/install-share-api.sh
else
  sudo env DOMAIN=${DOMAIN_Q} SNAPSHOT_SHARE_TOKEN=${TOKEN_Q} SNAPSHOT_SHARE_SITE_URL=${SITE_URL_Q} SNAPSHOT_SHARE_PUBLIC_API_URL=${API_URL_Q} SNAPSHOT_GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID_Q} SNAPSHOT_GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET_Q} SNAPSHOT_GITHUB_OWNER_LOGIN=${GITHUB_OWNER_LOGIN_Q} SNAPSHOT_GITHUB_OWNER_ID=${GITHUB_OWNER_ID_Q} SNAPSHOT_SESSION_SECRET=${SESSION_SECRET_Q} SNAPSHOT_AUTH_ALLOWED_ORIGINS=${AUTH_ALLOWED_ORIGINS_Q} PORT=${SHARE_PORT_Q} SNAPSHOT_SHARE_PROXY_MODE=${PROXY_MODE_Q} SNAPSHOT_SHARE_PUBLIC_PATH=${PUBLIC_PATH_Q} deploy/aliyun/install-share-api.sh
fi
EOF
  )
  "${RSYNC_SSH[@]}" "${SSH_TARGET}" "${remote_cert_cmd}"
fi

if [[ "${RUN_VERIFY}" -eq 1 ]]; then
  if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 ]]; then
    node "${REPO_ROOT}/deploy/aliyun/verify-public-share.mjs" \
      --api-url "${API_URL}" \
      --site-url "${SITE_URL}" \
      --skip-site-config
    echo "Skipped token publish verification because GitHub OAuth is configured; verify browser publishing after logging in with GitHub."
  else
    SNAPSHOT_SHARE_TOKEN="${TOKEN}" node "${REPO_ROOT}/deploy/aliyun/verify-public-share.mjs" \
      --api-url "${API_URL}" \
      --site-url "${SITE_URL}" \
      --skip-site-config \
      --publish
  fi
fi

if [[ "${CONFIGURE_PAGES}" -eq 1 ]]; then
  pages_args=(
    --api-url "${API_URL}"
    --repo "${PAGES_REPO}"
    --workflow "${PAGES_WORKFLOW}"
  )
  if [[ "${WAIT_PAGES}" -eq 1 ]]; then
    pages_args+=(--wait)
  fi
  "${REPO_ROOT}/deploy/aliyun/configure-github-pages-api.sh" "${pages_args[@]}"

  if [[ "${WAIT_PAGES}" -eq 1 && "${RUN_VERIFY}" -eq 1 ]]; then
    if [[ "${GITHUB_AUTH_ENABLED}" -eq 1 ]]; then
      node "${REPO_ROOT}/deploy/aliyun/verify-public-share.mjs" \
        --api-url "${API_URL}" \
        --site-url "${SITE_URL}"
      echo "Skipped token publish verification because GitHub OAuth is configured; verify browser publishing after logging in with GitHub."
    else
      SNAPSHOT_SHARE_TOKEN="${TOKEN}" node "${REPO_ROOT}/deploy/aliyun/verify-public-share.mjs" \
        --api-url "${API_URL}" \
        --site-url "${SITE_URL}" \
        --publish
    fi
  fi
fi

if [[ "${CONFIGURE_LOCAL}" -eq 1 ]]; then
  local_args=(
    --api-url "${API_URL}"
    --site-url "${SITE_URL}"
  )
  if [[ -n "${TOKEN}" ]]; then
    local_args+=(--token "${TOKEN}")
  fi
  if [[ "${REINSTALL_DAEMON}" -eq 1 ]]; then
    local_args+=(--reinstall-daemon)
  fi
  "${REPO_ROOT}/deploy/aliyun/configure-local-publisher.sh" "${local_args[@]}"

  if [[ "${RUN_VERIFY}" -eq 1 ]]; then
    node "${REPO_ROOT}/deploy/aliyun/verify-public-share.mjs" \
      --api-url "${API_URL}" \
      --site-url "${SITE_URL}" \
      --skip-site-config \
      --check-local-config
  fi
fi

cat <<EOF

Deployment command finished.

Next:
  1. Set GitHub repository variable:
     CODEX_SNAPSHOTS_PUBLIC_API_URL=${API_URL}
     or run:
     deploy/aliyun/configure-github-pages-api.sh --api-url ${API_URL} --repo ffffhx/codex-snapshots
  2. Trigger the GitHub Pages workflow and wait for it to finish.
  3. Run the public site verification:
     node deploy/aliyun/verify-public-share.mjs --api-url ${API_URL} --site-url ${SITE_URL}
  4. Configure your local viewer's public API/site settings:
     SNAPSHOT_SHARE_API_URL=${API_URL} SNAPSHOT_SHARE_SITE_URL=${SITE_URL} deploy/aliyun/configure-local-publisher.sh --reinstall-daemon
  5. If GitHub OAuth is configured, publish once from the browser after logging in with GitHub.
EOF
