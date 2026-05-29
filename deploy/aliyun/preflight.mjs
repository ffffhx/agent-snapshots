#!/usr/bin/env node

import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printHelp();
  process.exit(0);
}

const options = parsed.options;

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  if (!options.domain) {
    throw new Error("Missing --domain.");
  }

  const results = [];

  results.push(await runCheck("Resolve API domain", () => checkDomain(options.domain)));

  if (options.sshTarget) {
    results.push(await runCheck("Compare DNS with SSH host", () => compareDnsWithSshHost(options.domain, options.sshTarget), false));
    results.push(await runCheck("Open SSH session", () => checkSsh(options)));
    results.push(await runCheck("Check remote dependencies", () => checkRemoteDependencies(options)));
  } else {
    results.push({ ok: true, skipped: true, label: "SSH checks skipped; pass --ssh to verify the ECS host" });
  }

  if (options.checkPublicPorts) {
    results.push(await runCheck("Reach public HTTP port 80", () => checkTcp(options.domain, 80)));
    results.push(await runCheck("Reach public HTTPS port 443", () => checkTcp(options.domain, 443), false));
  }

  const failed = results.filter((result) => !result.ok && result.required);
  const warnings = results.filter((result) => !result.ok && !result.required);

  if (failed.length) {
    throw new Error(`${failed.length} required preflight check(s) failed`);
  }

  if (warnings.length) {
    console.log(`! ${warnings.length} warning(s); deployment may still work after the missing external setup is completed.`);
  }

  console.log("✓ Aliyun deployment preflight passed");
}

async function runCheck(label, check, required = true) {
  try {
    const message = await check();
    console.log(`✓ ${label}${message ? `: ${message}` : ""}`);
    return { ok: true, label, required };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${required ? "✗" : "!"} ${label}: ${message}`);
    return { ok: false, label, required };
  }
}

async function checkDomain(domain) {
  const addresses = await resolveHost(domain);
  if (!addresses.length) {
    throw new Error("no A or AAAA records found");
  }
  return addresses.join(", ");
}

async function compareDnsWithSshHost(domain, sshTarget) {
  const domainAddresses = await resolveHost(domain);
  const sshHost = extractSshHost(sshTarget);

  if (!sshHost) {
    throw new Error("could not parse SSH host");
  }

  const sshAddresses = net.isIP(sshHost) ? [sshHost] : await resolveHost(sshHost);
  const overlap = domainAddresses.filter((address) => sshAddresses.includes(address));

  if (!overlap.length) {
    throw new Error(`domain resolves to ${domainAddresses.join(", ")}, SSH host resolves to ${sshAddresses.join(", ")}`);
  }

  return overlap.join(", ");
}

async function checkSsh({ sshTarget, sshPort, identityFile, timeoutMs }) {
  const { stdout } = await runCommand(
    "ssh",
    buildSshArgs({ sshPort, identityFile, timeoutMs }).concat(sshTarget, "printf ready"),
    timeoutMs
  );

  if (stdout.trim() !== "ready") {
    throw new Error(`unexpected SSH output: ${stdout.trim() || "(empty)"}`);
  }

  return sshTarget;
}

async function checkRemoteDependencies({ sshTarget, sshPort, identityFile, proxyMode, requireCertbotNginx, timeoutMs }) {
  const requiredCommands =
    proxyMode === "caddy"
      ? ["node", "caddy", "rsync", "openssl", "systemctl"]
      : ["node", "nginx", "certbot", "rsync", "openssl", "systemctl"];
  const certbotNginxCheck = requireCertbotNginx
    ? `
if ! certbot plugins 2>/dev/null | grep -qi nginx; then
  echo "missing: certbot nginx plugin"
  exit 14
fi
`
    : "";
  const remoteScript = `
set -eu
PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"
missing=""
for cmd in ${requiredCommands.join(" ")}; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing="$missing $cmd"
  fi
done
if [ -n "$missing" ]; then
  echo "missing:$missing"
  exit 11
fi
node -e 'const major=Number(process.versions.node.split(".")[0]); if (!Number.isFinite(major) || major < 18) process.exit(12);'
${certbotNginxCheck}
if [ "$(id -u)" -eq 0 ]; then
  echo "privilege:root"
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  echo "privilege:sudo"
else
  echo "missing: passwordless sudo"
  exit 13
fi
`;
  const args = buildSshArgs({ sshPort, identityFile, timeoutMs }).concat(sshTarget, `sh -lc ${shellQuote(remoteScript)}`);
  const { stdout } = await runCommand("ssh", args, timeoutMs);
  return stdout.trim().replace(/\s+/g, " ");
}

function buildSshArgs({ sshPort, identityFile, timeoutMs }) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${Math.max(1, Math.ceil(Number(timeoutMs || 8000) / 1000))}`,
  ];

  if (identityFile) {
    args.push("-i", identityFile);
  }
  if (sshPort) {
    args.push("-p", String(sshPort));
  }

  return args;
}

async function checkTcp(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("connection timed out"));
    }, Number(options.timeoutMs || 8000));

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return `${host}:${port}`;
}

async function resolveHost(host) {
  const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
  return [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
}

function extractSshHost(target) {
  const withoutUser = String(target || "").replace(/^ssh:\/\//, "").split("@").pop() || "";
  if (withoutUser.startsWith("[")) {
    return withoutUser.slice(1, withoutUser.indexOf("]"));
  }
  return withoutUser.split(":")[0];
}

async function runCommand(command, args, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, Number(timeoutMs || 8000));

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `${command} exited with ${code}`).trim()));
      }
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseArgs(args) {
  const options = {
    checkPublicPorts: false,
    domain: "",
    identityFile: "",
    requireCertbotNginx: false,
    proxyMode: "nginx",
    sshPort: "",
    sshTarget: "",
    timeoutMs: 8000,
  };
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--domain") {
      options.domain = String(args[++index] || "");
      continue;
    }
    if (arg === "--ssh") {
      options.sshTarget = String(args[++index] || "");
      continue;
    }
    if (arg === "--identity-file") {
      options.identityFile = String(args[++index] || "");
      continue;
    }
    if (arg === "--port") {
      options.sshPort = String(args[++index] || "");
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(args[++index] || 8000);
      continue;
    }
    if (arg === "--check-public-ports") {
      options.checkPublicPorts = true;
      continue;
    }
    if (arg === "--require-certbot-nginx") {
      options.requireCertbotNginx = true;
      continue;
    }
    if (arg === "--proxy-mode") {
      options.proxyMode = String(args[++index] || "nginx");
      if (!["nginx", "caddy"].includes(options.proxyMode)) {
        throw new Error("--proxy-mode must be nginx or caddy");
      }
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { help, options };
}

function printHelp() {
  console.log(`aliyun preflight

Usage:
  node deploy/aliyun/preflight.mjs --domain snapshots.example.com --ssh root@1.2.3.4

Options:
  --domain DOMAIN          Public API domain that should point to ECS.
  --ssh TARGET            SSH target, for example root@1.2.3.4.
  --identity-file FILE    SSH private key for the ECS host.
  --port PORT             SSH port.
  --timeout-ms MS         Per-check timeout. Defaults to 8000.
  --check-public-ports    Also test public TCP 80 and 443.
  --proxy-mode MODE       Remote reverse proxy: nginx or caddy. Defaults to nginx.
  --require-certbot-nginx Check that certbot has the Nginx plugin.
  -h, --help              Show help.
`);
}
