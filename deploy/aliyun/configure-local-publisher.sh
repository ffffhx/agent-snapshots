#!/usr/bin/env bash
set -euo pipefail

API_URL="${SNAPSHOT_SHARE_API_URL:-${SNAPSHOT_SHARE_PUBLIC_API_URL:-}}"
SITE_URL="${SNAPSHOT_SHARE_SITE_URL:-https://ffffhx.github.io/codex-snapshots/}"
TOKEN="${SNAPSHOT_SHARE_TOKEN:-}"
TOKEN_FILE="${SNAPSHOT_SHARE_TOKEN_FILE:-${HOME}/.codex-snapshots-agent.json}"
REINSTALL_DAEMON=0
CHECK_API=1

usage() {
  cat <<'EOF'
Usage:
  SNAPSHOT_SHARE_API_URL=https://snapshots.example.com \
  deploy/aliyun/configure-local-publisher.sh [--reinstall-daemon]

Options:
  --api-url URL          Public share API URL. Defaults to SNAPSHOT_SHARE_API_URL or SNAPSHOT_SHARE_PUBLIC_API_URL.
  --site-url URL         Public static site URL. Defaults to SNAPSHOT_SHARE_SITE_URL or GitHub Pages.
  --token TOKEN          Optional publish token for legacy token auth. Defaults to SNAPSHOT_SHARE_TOKEN.
  --token-file FILE      Local publisher config file for codex-snapshot. Defaults to ~/.codex-snapshots-agent.json.
  --reinstall-daemon     Reinstall the macOS LaunchAgent with the public API/site URLs.
  --no-check             Skip the API health check.
  -h, --help             Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --site-url)
      SITE_URL="${2:-}"
      shift 2
      ;;
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --token-file)
      TOKEN_FILE="${2:-}"
      shift 2
      ;;
    --reinstall-daemon)
      REINSTALL_DAEMON=1
      shift
      ;;
    --no-check)
      CHECK_API=0
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

if [[ -z "${API_URL}" ]]; then
  echo "Missing API URL. Set SNAPSHOT_SHARE_API_URL or pass --api-url." >&2
  exit 1
fi

lowercase() {
  printf "%s" "$1" | tr '[:upper:]' '[:lower:]'
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

is_placeholder_domain() {
  local value
  value="$(lowercase "$1")"
  [[ "${value}" == "example.com" || "${value}" == *.example.com || "${value}" == "snapshots.example.com" ]]
}

validate_public_publisher_config() {
  local errors=()
  local api_host
  api_host="$(url_host "${API_URL}")"
  local site_host
  site_host="$(url_host "${SITE_URL}")"

  if ! is_http_url "${API_URL}"; then
    errors+=("API URL must start with http:// or https://.")
  fi
  if ! is_http_url "${SITE_URL}"; then
    errors+=("Site URL must start with http:// or https://.")
  fi
  if is_placeholder_domain "${api_host}"; then
    errors+=("API URL still uses the placeholder https://snapshots.example.com.")
  fi
  if [[ "${api_host}" == "127.0.0.1" || "${api_host}" == "localhost" || "${api_host}" == "::1" ]]; then
    errors+=("API URL must be the public Aliyun API, not ${API_URL}.")
  fi
  if [[ "${site_host}" == "127.0.0.1" || "${site_host}" == "localhost" || "${site_host}" == "::1" ]]; then
    errors+=("Site URL must be the public website, not ${SITE_URL}.")
  fi
  if [[ -n "${TOKEN}" ]]; then
    if [[ "${TOKEN}" == "change-me" ]]; then
      errors+=("Token still uses the placeholder change-me.")
    elif [[ "${#TOKEN}" -lt 16 ]]; then
      errors+=("Token should be at least 16 characters.")
    fi
  fi

  if [[ "${#errors[@]}" -gt 0 ]]; then
    echo "Local publisher config needs real public values:" >&2
    printf "  - %s\n" "${errors[@]}" >&2
    exit 1
  fi
}

validate_public_publisher_config

mkdir -p "$(dirname "${TOKEN_FILE}")"
umask 077
node -e '
const { writeFileSync } = require("node:fs");
const file = process.argv[1];
const token = process.argv[2];
const apiUrl = process.argv[3].replace(/\/+$/, "");
const siteUrl = process.argv[4].replace(/\/+$/, "");
const payload = {
  snapshotShareApiUrl: apiUrl,
  snapshotShareSiteUrl: siteUrl,
};
if (token) {
  payload.snapshotShareToken = token;
}
writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
' "${TOKEN_FILE}" "${TOKEN}" "${API_URL}" "${SITE_URL}"

echo "Wrote local publisher config: ${TOKEN_FILE}"
echo "Public share API: ${API_URL}"
echo "Public site: ${SITE_URL}"
if [[ -n "${TOKEN}" ]]; then
  echo "Legacy publish token: configured"
else
  echo "Legacy publish token: not configured; GitHub OAuth browser publishing can still use this API/site config."
fi

if [[ "${CHECK_API}" -eq 1 ]]; then
  curl --fail --show-error --silent --max-time 8 "${API_URL%/}/api/snapshots/health" >/dev/null
  echo "Share API health check passed."
fi

if [[ "${REINSTALL_DAEMON}" -eq 1 ]]; then
  SNAPSHOT_SHARE_API_URL="${API_URL}" \
  SNAPSHOT_SHARE_SITE_URL="${SITE_URL}" \
  pnpm snapshot:uninstall-daemon || true

  SNAPSHOT_SHARE_API_URL="${API_URL}" \
  SNAPSHOT_SHARE_SITE_URL="${SITE_URL}" \
  pnpm snapshot:install-daemon

  pnpm snapshot:daemon:status
else
  cat <<EOF
To run the local viewer now:

  pnpm snapshot serve --port 4321

To update the macOS LaunchAgent:

  deploy/aliyun/configure-local-publisher.sh \\
    --api-url ${API_URL} \\
    --site-url ${SITE_URL} \\
    --token-file ${TOKEN_FILE} \\
    --reinstall-daemon

For legacy token auth, add:

  --token <same-token>
EOF
fi
