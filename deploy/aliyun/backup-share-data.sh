#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET=""
SSH_OPTS=()
REMOTE_FILE="/var/lib/codex-snapshots/shares.json"
OUTPUT_DIR="backups/codex-snapshots"

usage() {
  cat <<'EOF'
Usage:
  deploy/aliyun/backup-share-data.sh --ssh root@1.2.3.4

Options:
  --ssh TARGET          SSH target, for example root@1.2.3.4.
  --identity-file FILE  SSH private key for the ECS host.
  --port PORT           SSH port.
  --remote-file FILE    Remote share data file. Defaults to /var/lib/codex-snapshots/shares.json.
  --output-dir DIR      Local backup directory. Defaults to backups/codex-snapshots.
  -h, --help            Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh)
      SSH_TARGET="${2:-}"
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
    --remote-file)
      REMOTE_FILE="${2:-}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-}"
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

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\"'\"'/g"
  printf "'"
}

mkdir -p "${OUTPUT_DIR}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="${OUTPUT_DIR}/shares-${timestamp}.json"
tmp_file="${output_file}.tmp"
remote_file_q="$(shell_quote "${REMOTE_FILE}")"

cleanup() {
  rm -f "${tmp_file}"
}
trap cleanup EXIT

remote_cmd=$(
  cat <<EOF
set -e
if [ "\$(id -u)" -eq 0 ]; then
  cat ${remote_file_q}
else
  sudo -n cat ${remote_file_q}
fi
EOF
)

SSH_CMD=(ssh)
if ((${#SSH_OPTS[@]})); then
  SSH_CMD+=("${SSH_OPTS[@]}")
fi

"${SSH_CMD[@]}" "${SSH_TARGET}" "${remote_cmd}" > "${tmp_file}"

node -e '
const { readFileSync } = require("node:fs");
const file = process.argv[1];
JSON.parse(readFileSync(file, "utf8"));
' "${tmp_file}"

mv "${tmp_file}" "${output_file}"
chmod 0600 "${output_file}"
trap - EXIT

echo "Backed up share data to ${output_file}"
