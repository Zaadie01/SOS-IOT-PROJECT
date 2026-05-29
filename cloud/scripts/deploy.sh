#!/usr/bin/env bash
# deploy.sh — build images, restart containers, health-check.
# On failure: automatically restores the previous images (rollback).
#
# Usage:
#   ./cloud/scripts/deploy.sh              # normal deploy
#   ./cloud/scripts/deploy.sh --no-pull    # rebuild only (skip git pull)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_DIR/cloud"

BACKEND_IMAGE="sos-backend"
FRONTEND_IMAGE="sos-frontend"
HEALTH_URL="http://localhost:3001/"
HEALTH_RETRIES=10
HEALTH_INTERVAL=3

NO_GIT_PULL=false
for arg in "$@"; do
    [[ $arg == --no-pull ]] && NO_GIT_PULL=true
done

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✅  $*"; }
err()  { echo "[$(date '+%H:%M:%S')] ❌  $*" >&2; }

if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
else
    DC="docker-compose"
fi

# ── Step 1: git pull ──────────────────────────────────────────────────────────
if [[ "$NO_GIT_PULL" != true ]]; then
    log "Pulling latest code..."
    git -C "$PROJECT_DIR" fetch origin
    CURRENT=$(git -C "$PROJECT_DIR" rev-parse --short HEAD)
    git -C "$PROJECT_DIR" pull --ff-only
    NEW=$(git -C "$PROJECT_DIR" rev-parse --short HEAD)
    [[ "$CURRENT" == "$NEW" ]] \
        && log "Already up to date ($CURRENT). Continuing." \
        || log "Updated: $CURRENT → $NEW"
fi

COMMIT=$(git -C "$PROJECT_DIR" rev-parse --short HEAD)

# ── Step 2: save rollback tags ────────────────────────────────────────────────
log "Saving rollback images..."
SAVED_BACKEND=false
SAVED_FRONTEND=false

if docker image inspect "${BACKEND_IMAGE}:latest" &>/dev/null; then
    docker tag "${BACKEND_IMAGE}:latest" "${BACKEND_IMAGE}:rollback"
    SAVED_BACKEND=true
    log "  backend:rollback saved"
fi
if docker image inspect "${FRONTEND_IMAGE}:latest" &>/dev/null; then
    docker tag "${FRONTEND_IMAGE}:latest" "${FRONTEND_IMAGE}:rollback"
    SAVED_FRONTEND=true
    log "  frontend:rollback saved"
fi

# ── Step 3: build ─────────────────────────────────────────────────────────────
log "Building images..."
$DC -f "$COMPOSE_DIR/docker-compose.yml" build

# ── Step 4: restart ───────────────────────────────────────────────────────────
log "Restarting containers..."
$DC -f "$COMPOSE_DIR/docker-compose.yml" up -d

# ── Step 5: health check ──────────────────────────────────────────────────────
log "Health checking backend (${HEALTH_RETRIES}×${HEALTH_INTERVAL}s)..."
ATTEMPT=0
until curl -sf "$HEALTH_URL" -o /dev/null; do
    ATTEMPT=$((ATTEMPT + 1))
    if [[ $ATTEMPT -ge $HEALTH_RETRIES ]]; then
        err "Health check failed after $((HEALTH_RETRIES * HEALTH_INTERVAL))s."
        if [[ "$SAVED_BACKEND" == true ]] || [[ "$SAVED_FRONTEND" == true ]]; then
            err "Auto-rolling back to previous images..."
            [[ "$SAVED_BACKEND"  == true ]] && docker tag "${BACKEND_IMAGE}:rollback"  "${BACKEND_IMAGE}:latest"
            [[ "$SAVED_FRONTEND" == true ]] && docker tag "${FRONTEND_IMAGE}:rollback" "${FRONTEND_IMAGE}:latest"
            $DC -f "$COMPOSE_DIR/docker-compose.yml" up --no-pull --force-recreate -d
            err "Rollback done."
        else
            err "No rollback images found."
        fi
        exit 1
    fi
    log "  waiting... ($ATTEMPT/$HEALTH_RETRIES)"
    sleep "$HEALTH_INTERVAL"
done

ok "Deploy successful! Commit: $COMMIT"
