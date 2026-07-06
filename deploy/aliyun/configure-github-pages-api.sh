#!/usr/bin/env bash
set -euo pipefail

API_URL="${AGENT_SNAPSHOTS_PUBLIC_API_URL:-${SNAPSHOT_SHARE_PUBLIC_API_URL:-${SNAPSHOT_SHARE_API_URL:-}}}"
REPO="${GITHUB_REPOSITORY:-ffffhx/agent-snapshots}"
WORKFLOW="pages.yml"
TRIGGER_WORKFLOW=1
WAIT_WORKFLOW=0

usage() {
  cat <<'EOF'
Usage:
  deploy/aliyun/configure-github-pages-api.sh \
    --api-url https://snapshots.example.com \
    [--repo ffffhx/agent-snapshots]

Options:
  --api-url URL       Public share API URL to expose to GitHub Pages.
  --repo OWNER/REPO   GitHub repository. Defaults to ffffhx/agent-snapshots.
  --workflow FILE     Pages workflow file. Defaults to pages.yml.
  --no-dispatch       Set the variable but do not trigger the workflow.
  --wait              Wait for the triggered workflow to finish.
  -h, --help          Show help.

Requires:
  gh auth login
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --workflow)
      WORKFLOW="${2:-}"
      shift 2
      ;;
    --no-dispatch)
      TRIGGER_WORKFLOW=0
      shift
      ;;
    --wait)
      WAIT_WORKFLOW=1
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
  echo "Missing API URL. Set AGENT_SNAPSHOTS_PUBLIC_API_URL or pass --api-url." >&2
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

api_host="$(url_host "${API_URL}")"
if ! is_http_url "${API_URL}"; then
  echo "API URL must start with http:// or https://." >&2
  exit 1
fi
if is_placeholder_domain "${api_host}"; then
  echo "API URL still uses the placeholder https://snapshots.example.com." >&2
  exit 1
fi
if [[ "${api_host}" == "127.0.0.1" || "${api_host}" == "localhost" || "${api_host}" == "::1" ]]; then
  echo "API URL must be the public Aliyun API, not ${API_URL}." >&2
  exit 1
fi

if [[ "${WAIT_WORKFLOW}" -eq 1 && "${TRIGGER_WORKFLOW}" -ne 1 ]]; then
  echo "--wait requires workflow dispatch." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Missing gh CLI. Install it and run: gh auth login" >&2
  exit 1
fi

gh auth status >/dev/null

gh variable set AGENT_SNAPSHOTS_PUBLIC_API_URL \
  --repo "${REPO}" \
  --body "${API_URL%/}"

echo "Set AGENT_SNAPSHOTS_PUBLIC_API_URL=${API_URL%/} on ${REPO}"

if [[ "${TRIGGER_WORKFLOW}" -eq 1 ]]; then
  gh workflow run "${WORKFLOW}" --repo "${REPO}"
  echo "Triggered workflow ${WORKFLOW} on ${REPO}"

  if [[ "${WAIT_WORKFLOW}" -eq 1 ]]; then
    sleep 5
    RUN_ID="$(gh run list --repo "${REPO}" --workflow "${WORKFLOW}" --limit 1 --json databaseId --jq '.[0].databaseId')"
    if [[ -z "${RUN_ID}" || "${RUN_ID}" == "null" ]]; then
      echo "Could not find the triggered workflow run." >&2
      exit 1
    fi
    gh run watch "${RUN_ID}" --repo "${REPO}" --exit-status
  fi
fi
