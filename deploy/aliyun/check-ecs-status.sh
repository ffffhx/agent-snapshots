#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET=""
SSH_OPTS=()
DOMAIN=""
API_URL="${SNAPSHOT_SHARE_PUBLIC_API_URL:-${SNAPSHOT_SHARE_API_URL:-}}"

usage() {
  cat <<'EOF'
Usage:
  deploy/aliyun/check-ecs-status.sh --ssh root@1.2.3.4 --domain snapshots.example.com

Options:
  --ssh TARGET          SSH target, for example root@1.2.3.4.
  --domain DOMAIN      Public API domain. Used to check https://DOMAIN/api/snapshots/health.
  --api-url URL        Public API URL. Overrides --domain for public health check.
  --identity-file FILE SSH private key for the ECS host.
  --port PORT          SSH port.
  -h, --help           Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh)
      SSH_TARGET="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --identity-file)
      SSH_OPTS+=("-i" "${2:-}")
      shift 2
      ;;
    --port)
      SSH_OPTS+=("-p" "${2:-}")
      shift 2
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

if [[ -z "${API_URL}" && -n "${DOMAIN}" ]]; then
  API_URL="https://${DOMAIN}"
fi

remote_cmd='
set -e
PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

echo "== systemd =="
systemctl is-enabled agent-snapshot-share.service || true
systemctl is-active agent-snapshot-share.service || true
systemctl --no-pager --lines=12 status agent-snapshot-share.service || true

echo
echo "== local health =="
curl --fail --show-error --silent --max-time 8 http://127.0.0.1:8787/api/snapshots/health
echo

echo
echo "== install files =="
run_root test -f /etc/agent-snapshots/share-api.env
run_root test -f /etc/systemd/system/agent-snapshot-share.service
run_root test -d /var/lib/agent-snapshots
run_root test -f /etc/nginx/conf.d/agent-snapshots.conf
if command -v stat >/dev/null 2>&1; then
  run_root stat -c "env %a %U:%G %n" /etc/agent-snapshots/share-api.env
  run_root stat -c "state %a %U:%G %n" /var/lib/agent-snapshots
fi

echo
echo "== local bind =="
if command -v ss >/dev/null 2>&1; then
  ss -ltn | grep ":8787" || {
    echo "share API is not listening on port 8787" >&2
    exit 21
  }
  if ss -ltn | grep ":8787" | grep -Eq "0\\.0\\.0\\.0:8787|\\[::\\]:8787|\\*:8787"; then
    echo "share API port 8787 is exposed beyond localhost" >&2
    exit 22
  fi
else
  echo "ss command not found; skipped bind-scope check"
fi

echo
echo "== nginx =="
run_root nginx -t
run_root grep -q "proxy_pass http://127.0.0.1:8787" /etc/nginx/conf.d/agent-snapshots.conf
'

SSH_CMD=(ssh)
if ((${#SSH_OPTS[@]})); then
  SSH_CMD+=("${SSH_OPTS[@]}")
fi

"${SSH_CMD[@]}" "${SSH_TARGET}" "${remote_cmd}"

if [[ -n "${API_URL}" ]]; then
  echo
  echo "== public health =="
  HEALTH_PAYLOAD="$(curl --fail --show-error --silent --max-time 12 "${API_URL%/}/api/snapshots/health")"
  printf "%s\n" "${HEALTH_PAYLOAD}"
  if printf "%s" "${HEALTH_PAYLOAD}" | grep -q '"storage"'; then
    echo "public health response exposes the storage path" >&2
    exit 31
  fi
  echo

  echo "== public CORS =="
  CORS_HEADERS="$(curl --fail --show-error --silent --max-time 12 -D - -o /dev/null \
    -H "Origin: https://ffffhx.github.io" \
    "${API_URL%/}/api/snapshots?limit=1")"
  printf "%s\n" "${CORS_HEADERS}" | grep -qi '^access-control-allow-origin: \*' || {
    echo "public list response is missing access-control-allow-origin: *" >&2
    exit 32
  }
  echo "CORS read check passed."
fi
