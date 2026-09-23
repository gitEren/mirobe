#!/usr/bin/env bash
# Deploy the Mirobe API to a Linux VPS with Docker Compose.
#
# Usage:
#   deploy/deploy.sh <ssh-target> [ssh-port] --check
#       Read-only preflight: OS, arch, Docker/Compose versions, listening ports,
#       running containers, disk and RAM. Changes nothing.
#   deploy/deploy.sh <ssh-target> [ssh-port] --install-docker
#       Installs Docker Engine + compose plugin via https://get.docker.com if missing.
#   deploy/deploy.sh <ssh-target> [ssh-port] [--mode caddy|proxy] [--api-port N]
#       Syncs source to /opt/mirobe, seeds deploy/.env.production (only if absent),
#       builds and starts the stack, waits for the health check.
#       --mode caddy  (default) api + bundled Caddy on 80/443. Aborts if 80/443 are taken.
#       --mode proxy  api only, on 127.0.0.1:<api-port>; put your existing nginx/Caddy in
#                     front (see deploy/nginx-mirobe.conf).
#       --api-port N  loopback host port for the api (default 3000 in caddy mode, 3100 in proxy mode).
#
# Examples:
#   deploy/deploy.sh root@203.0.113.10 --check
#   deploy/deploy.sh root@203.0.113.10 2222 --mode proxy --api-port 3100
set -euo pipefail

REMOTE_DIR=/opt/mirobe
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

[[ $# -ge 1 ]] || usage
case "$1" in -h|--help) usage 0 ;; esac
TARGET="$1"; shift
SSH_PORT=22
if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then SSH_PORT="$1"; shift; fi

ACTION=deploy
MODE=caddy
API_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) ACTION=check ;;
    --install-docker) ACTION=install ;;
    --mode) MODE="${2:-}"; shift ;;
    --api-port) API_PORT="${2:-}"; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
  shift
done
[[ "$MODE" == caddy || "$MODE" == proxy ]] || { echo "--mode must be caddy or proxy" >&2; exit 1; }
if [[ -z "$API_PORT" ]]; then [[ "$MODE" == caddy ]] && API_PORT=3000 || API_PORT=3100; fi
[[ "$API_PORT" =~ ^[0-9]+$ ]] || { echo "--api-port must be a number" >&2; exit 1; }

SSH_OPTS=(-p "$SSH_PORT" -o ServerAliveInterval=30)
# Optional dedicated key: SSH_KEY=~/.ssh/odeaweb_vps deploy/deploy.sh ...
if [[ -n "${SSH_KEY:-}" ]]; then SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes); fi
ssh_run() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

# Prefix for privileged commands on the remote (empty when logged in as root).
REMOTE_PRELUDE='set -eu; if [ "$(id -u)" -eq 0 ]; then S=""; else S="sudo"; fi'

# ---------------------------------------------------------------------------
if [[ "$ACTION" == check ]]; then
  ssh_run bash -s <<EOF
$REMOTE_PRELUDE
set +e
section() { printf '\n==== %s ====\n' "\$1"; }
section hostname;      hostname
section os-release;    cat /etc/os-release
section arch;          uname -m; uname -r
section docker;        (docker --version && \$S docker version --format 'server {{.Server.Version}}') 2>&1 || echo "docker: not installed / not reachable"
section compose;       \$S docker compose version 2>&1 || echo "docker compose plugin: missing"
section listening-tcp; \$S ss -ltnp 2>&1 || \$S netstat -ltnp 2>&1
section containers;    \$S docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1
section disk;          df -h / /var/lib/docker $REMOTE_DIR 2>/dev/null | awk '!seen[\$0]++'
section memory;        free -h
section web-servers;   for s in nginx caddy apache2 httpd traefik; do systemctl is-active --quiet \$s 2>/dev/null && echo "\$s: active (systemd)"; done; true
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
if [[ "$ACTION" == install ]]; then
  ssh_run bash -s <<EOF
$REMOTE_PRELUDE
if command -v docker >/dev/null 2>&1 && \$S docker compose version >/dev/null 2>&1; then
  echo "Docker and compose plugin already installed:"; docker --version; \$S docker compose version
  exit 0
fi
if command -v docker >/dev/null 2>&1; then
  echo "Docker is present but the compose plugin is missing. Install it with your package manager"
  echo "(e.g. apt-get install docker-compose-plugin); not running get.docker.com over an existing install."
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required to fetch get.docker.com" >&2; exit 1; }
tmp=\$(mktemp)
curl -fsSL https://get.docker.com -o "\$tmp"
\$S sh "\$tmp"
rm -f "\$tmp"
\$S systemctl enable --now docker
docker --version; \$S docker compose version
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Deploy
[[ -f "$ROOT/Dockerfile" && -f "$ROOT/package-lock.json" ]] || { echo "Run from the Mirobe repo" >&2; exit 1; }
command -v rsync >/dev/null || { echo "rsync is required locally" >&2; exit 1; }

echo "==> Preparing $REMOTE_DIR on $TARGET"
ssh_run bash -s <<EOF
$REMOTE_PRELUDE
command -v rsync >/dev/null 2>&1 || { echo "rsync missing on server (apt-get install rsync / dnf install rsync)" >&2; exit 1; }
\$S docker compose version >/dev/null 2>&1 || { echo "docker compose missing; run with --install-docker first" >&2; exit 1; }
\$S mkdir -p $REMOTE_DIR/deploy
\$S chown "\$(id -u):\$(id -g)" $REMOTE_DIR $REMOTE_DIR/deploy
EOF

echo "==> Syncing source"
# Excluded paths are also protected from --delete, so server-side secrets survive.
(cd "$ROOT" && rsync -azR --delete --no-owner --no-group -e "ssh ${SSH_OPTS[*]}" \
  --exclude 'node_modules/' --exclude '.DS_Store' \
  --exclude 'server/data/' --exclude 'server/dist/' \
  --exclude '.env' --exclude '.env.*' --exclude 'deploy/.env' --exclude 'deploy/.env.production' --exclude 'deploy/certs/' \
  ./package.json ./package-lock.json ./shared ./server ./mobile/package.json \
  ./Dockerfile ./.dockerignore ./deploy \
  "$TARGET:$REMOTE_DIR/")

echo "==> Secrets"
if ssh_run "test -e $REMOTE_DIR/deploy/.env.production"; then
  echo "    deploy/.env.production already exists on the server; leaving it untouched."
else
  [[ -f "$ROOT/.env" ]] || { echo "No local .env to seed deploy/.env.production" >&2; exit 1; }
  ssh_run "umask 077 && cat > $REMOTE_DIR/deploy/.env.production && chmod 600 $REMOTE_DIR/deploy/.env.production" < "$ROOT/.env"
  echo "    Copied local .env to deploy/.env.production (chmod 600). Contents not shown."
fi

echo "==> Building and starting (mode=$MODE, api on 127.0.0.1:$API_PORT)"
ssh_run bash -s <<EOF
$REMOTE_PRELUDE
cd $REMOTE_DIR
DC="\$S docker compose -f deploy/docker-compose.yml"

port_in_use() { \$S ss -ltnH "( sport = :\$1 )" 2>/dev/null | grep -q .; }
running() { [ -n "\$(\$DC ps -q --status running "\$1" 2>/dev/null)" ]; }

# Refuse to collide with ports owned by other apps on this box.
if ! running api && port_in_use $API_PORT; then
  echo "127.0.0.1:$API_PORT is already in use by something else; pick another --api-port." >&2; exit 1
fi
if [ "$MODE" = caddy ] && ! running caddy; then
  for p in 80 443; do
    if port_in_use \$p; then
      echo "Port \$p is already taken (existing reverse proxy?). Use --mode proxy and add" >&2
      echo "deploy/nginx-mirobe.conf to the existing proxy instead." >&2
      exit 1
    fi
  done
fi

# Non-secret compose settings, persisted so manual 'docker compose' runs behave the same.
if [ "$MODE" = caddy ]; then profiles=caddy; else profiles=; fi
printf 'COMPOSE_PROFILES=%s\nAPI_HOST_PORT=%s\n' "\$profiles" "$API_PORT" > deploy/.env

if [ "$MODE" = proxy ]; then
  # Switching from caddy mode: stop the bundled proxy if it was running.
  \$S docker compose -f deploy/docker-compose.yml --profile caddy rm -sf caddy >/dev/null 2>&1 || true
fi

\$DC up -d --build --remove-orphans

echo "==> Waiting for api health"
cid=\$(\$DC ps -q api)
for i in \$(seq 1 40); do
  status=\$(\$S docker inspect --format '{{.State.Health.Status}}' "\$cid" 2>/dev/null || echo unknown)
  if [ "\$status" = healthy ]; then break; fi
  sleep 3
done
if [ "\$status" != healthy ]; then
  echo "api did not become healthy (status: \$status). Recent logs:" >&2
  \$DC logs --tail 60 api >&2
  exit 1
fi
echo "api healthy."
if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:$API_PORT/api/health"; echo
  if [ "$MODE" = caddy ]; then
    docker compose -f deploy/docker-compose.yml ps caddy --format '{{.Name}} {{.Status}}'  # Caddy only answers Cloudflare IPs; check publicly instead
  fi
fi
\$DC ps
EOF

echo "==> Done. Public check: curl https://mirobe.orbexastudio.com.tr/api/health"
