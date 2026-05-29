#!/usr/bin/env bash
# rollback.sh — manually restore the previous deployment.
# Uses locally saved :rollback tags — no internet required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_DIR/cloud"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
err() { echo "[$(date '+%H:%M:%S')] ❌  $*" >&2; }

if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
else
    DC="docker-compose"
fi

# Load REGISTRY_OWNER
if [[ -f "$COMPOSE_DIR/.env" ]]; then
    set -o allexport
    # shellcheck disable=SC1090
    source "$COMPOSE_DIR/.env"
    set +o allexport
fi

REGISTRY_OWNER="${REGISTRY_OWNER:-}"
if [[ -z "$REGISTRY_OWNER" ]]; then
    err "REGISTRY_OWNER is not set. Create cloud/.env with REGISTRY_OWNER=your-github-username"
    exit 1
fi

BACKEND_IMAGE="ghcr.io/${REGISTRY_OWNER}/sos-backend"
FRONTEND_IMAGE="ghcr.io/${REGISTRY_OWNER}/sos-frontend"

HAVE_BACKEND=false
HAVE_FRONTEND=false
docker image inspect "${BACKEND_IMAGE}:rollback"  &>/dev/null && HAVE_BACKEND=true
docker image inspect "${FRONTEND_IMAGE}:rollback" &>/dev/null && HAVE_FRONTEND=true

if [[ "$HAVE_BACKEND" == false && "$HAVE_FRONTEND" == false ]]; then
    err "No rollback images found (${BACKEND_IMAGE}:rollback / ${FRONTEND_IMAGE}:rollback)."
    err "Run at least one successful deploy first."
    exit 1
fi

log "Restoring rollback images..."
[[ "$HAVE_BACKEND"  == true ]] && docker tag "${BACKEND_IMAGE}:rollback"  "${BACKEND_IMAGE}:latest" && log "  backend restored"
[[ "$HAVE_FRONTEND" == true ]] && docker tag "${FRONTEND_IMAGE}:rollback" "${FRONTEND_IMAGE}:latest" && log "  frontend restored"

log "Restarting containers (no pull)..."
$DC -f "$COMPOSE_DIR/docker-compose.yml" up --no-pull --force-recreate -d

log "✅  Rollback complete."
