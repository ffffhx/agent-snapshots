#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET=""
SSH_OPTS=()
INPUT_FILE=""
REMOTE_FILE="/var/lib/agent-snapshots/shares.json"
RESTART_SERVICE=1

usage() {
  cat <<'EOF'
Usage:
  deploy/aliyun/restore-share-data.sh --ssh root@1.2.3.4 --file backups/agent-snapshots/shares-20260101T000000Z.json

Options:
  --ssh TARGET          SSH target, for example root@1.2.3.4.
  --file FILE           Local share data JSON backup to restore.
  --identity-file FILE  SSH private key for the ECS host.
  --port PORT           SSH port.
  --remote-file FILE    Remote share data file. Defaults to /var/lib/agent-snapshots/shares.json.
  --no-restart          Restore the file without restarting agent-snapshot-share.
  -h, --help            Show help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh)
      SSH_TARGET="${2:-}"
      shift 2
      ;;
    --file)
      INPUT_FILE="${2:-}"
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
    --no-restart)
      RESTART_SERVICE=0
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

if [[ -z "${INPUT_FILE}" || ! -f "${INPUT_FILE}" ]]; then
  echo "Missing --file JSON backup." >&2
  usage >&2
  exit 1
fi

node -e '
const { readFileSync } = require("node:fs");
const file = process.argv[1];
const parsed = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(parsed) && !(parsed && typeof parsed === "object" && Array.isArray(parsed.entries))) {
  throw new Error("share data must be an array or an object with an entries array");
}
' "${INPUT_FILE}"

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\"'\"'/g"
  printf "'"
}

remote_file_q="$(shell_quote "${REMOTE_FILE}")"

remote_cmd=$(
  cat <<EOF
set -e
tmp_file="\$(mktemp /tmp/agent-snapshots-restore.XXXXXX.json)"
root_script="\$(mktemp /tmp/agent-snapshots-restore-root.XXXXXX.sh)"
cleanup() {
  rm -f "\${tmp_file}" "\${root_script}"
}
trap cleanup EXIT

cat > "\${tmp_file}"
cat > "\${root_script}" <<'ROOT_SCRIPT'
#!/usr/bin/env sh
set -e
remote_file="\$1"
restart_service="\$2"
tmp_file="\$3"
backup_file="\${remote_file}.restore-backup.\$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "\$(dirname "\${remote_file}")"
if [ -f "\${remote_file}" ]; then
  cp -a "\${remote_file}" "\${backup_file}"
  echo "Saved previous remote data to \${backup_file}"
fi

install -o codexsnap -g codexsnap -m 0640 "\${tmp_file}" "\${remote_file}"

if [ "\${restart_service}" = "1" ]; then
  systemctl restart agent-snapshot-share.service
fi
ROOT_SCRIPT
chmod +x "\${root_script}"

if [ "\$(id -u)" -eq 0 ]; then
  "\${root_script}" ${remote_file_q} ${RESTART_SERVICE} "\${tmp_file}"
else
  sudo -n "\${root_script}" ${remote_file_q} ${RESTART_SERVICE} "\${tmp_file}"
fi
EOF
)

SSH_CMD=(ssh)
if ((${#SSH_OPTS[@]})); then
  SSH_CMD+=("${SSH_OPTS[@]}")
fi

"${SSH_CMD[@]}" "${SSH_TARGET}" "${remote_cmd}" < "${INPUT_FILE}"

echo "Restored ${INPUT_FILE} to ${SSH_TARGET}:${REMOTE_FILE}"
