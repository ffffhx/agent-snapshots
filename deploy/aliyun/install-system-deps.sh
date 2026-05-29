#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root, for example: sudo $0" >&2
  exit 1
fi

NODE_MAJOR="${NODE_MAJOR:-20}"
PROXY_MODE="${SNAPSHOT_SHARE_PROXY_MODE:-${PROXY_MODE:-nginx}}"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

node_is_supported() {
  has_command node && node -e 'const major=Number(process.versions.node.split(".")[0]); process.exit(major >= 18 ? 0 : 1);' >/dev/null 2>&1
}

install_debian_deps() {
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl rsync

  if [[ "${PROXY_MODE}" != "caddy" && "${PROXY_MODE}" != "none" ]]; then
    apt-get install -y nginx certbot python3-certbot-nginx
  fi

  if ! node_is_supported; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
}

install_rhel_deps() {
  local manager="$1"

  "${manager}" install -y ca-certificates curl git openssl rsync
  if [[ "${PROXY_MODE}" != "caddy" && "${PROXY_MODE}" != "none" ]]; then
    "${manager}" install -y nginx
    "${manager}" install -y certbot python3-certbot-nginx || {
      "${manager}" install -y epel-release || true
      "${manager}" install -y certbot python3-certbot-nginx || "${manager}" install -y certbot
    }
  fi

  if ! node_is_supported; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    "${manager}" install -y nodejs
  fi
}

if has_command apt-get; then
  install_debian_deps
elif has_command dnf; then
  install_rhel_deps dnf
elif has_command yum; then
  install_rhel_deps yum
else
  echo "Unsupported package manager. Install Node.js 18+, Nginx, Certbot, Git, OpenSSL, and rsync manually." >&2
  exit 1
fi

if ! node_is_supported; then
  echo "Node.js 18+ is required, but the installed node is: $(node --version 2>/dev/null || echo missing)" >&2
  exit 1
fi

if [[ "${PROXY_MODE}" != "caddy" && "${PROXY_MODE}" != "none" ]]; then
  systemctl enable --now nginx >/dev/null 2>&1 || true
fi

echo "Installed/verified dependencies:"
echo "  node: $(node --version)"
if command -v nginx >/dev/null 2>&1; then
  echo "  nginx: $(nginx -v 2>&1)"
else
  echo "  nginx: skipped for ${PROXY_MODE} proxy mode"
fi
if command -v certbot >/dev/null 2>&1; then
  echo "  certbot: $(certbot --version 2>&1)"
else
  echo "  certbot: skipped for ${PROXY_MODE} proxy mode"
fi
echo "  rsync: $(rsync --version | head -n 1)"
