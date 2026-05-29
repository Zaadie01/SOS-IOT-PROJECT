#!/usr/bin/env bash
# rollback.sh — restore the previous deployment.
# Uses locally saved :rollback tags — no internet required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_DIR/cloud"

BACKEND_IMAGE="sos-backend"
FRONTEND_IMAGE="sos-frontend"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[$(date '+%H:%M:%S')] ❌  $*" >&2; }

if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
else
    DC="docker-compose"
fi

HAVE_BACKEND=false
HAVE_FRONTEND=false
docker image inspect "${BACKEND_IMAGE}:rollback"  &>/dev/null && HAVE_BACKEND=true
docker image inspect "${FRONTEND_IMAGE}:rollback" &>/dev/null && HAVE_FRONTEND=true

if [[ "$HAVE_BACKEND" == false && "$HAVE_FRONTEND" == false ]]; then
    err "No rollback images found. Run at least one successful deploy first."
    exit 1
fi

log "Restoring rollback images..."
[[ "$HAVE_BACKEND"  == true ]] && docker tag "${BACKEND_IMAGE}:rollback"  "${BACKEND_IMAGE}:latest" && log "  backend restored"
[[ "$HAVE_FRONTEND" == true ]] && docker tag "${FRONTEND_IMAGE}:rollback" "${FRONTEND_IMAGE}:latest" && log "  frontend restored"

log "Restarting containers..."
$DC -f "$COMPOSE_DIR/docker-compose.yml" up --no-pull --force-recreate -d

log "✅  Rollback complete."
