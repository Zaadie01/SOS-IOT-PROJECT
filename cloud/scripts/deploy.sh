#!/usr/bin/env bash
# deploy.sh — pull latest images (or build locally), restart, health-check.
# On failure: automatically restores the previous images (rollback).
#
# Usage:
#   ./cloud/scripts/deploy.sh              # build locally (dev)
#   ./cloud/scripts/deploy.sh --no-build   # pull from GHCR (CI/CD — server is weak)
#   ./cloud/scripts/deploy.sh --no-pull    # skip git pull (rebuild only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_DIR="$PROJECT_DIR/cloud"

HEALTH_URL="http://localhost:3001/"
HEALTH_RETRIES=10
HEALTH_INTERVAL=3   # seconds between attempts

NO_BUILD=false
NO_GIT_PULL=false
for arg in "$@"; do
    case $arg in
        --no-build) NO_BUILD=true ;;
        --no-pull)  NO_GIT_PULL=true ;;
    esac
done

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✅  $*"; }
err()  { echo "[$(date '+%H:%M:%S')] ❌  $*" >&2; }

# ── Detect docker compose command ────────────────────────────────────────────
if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
else
    DC="docker-compose"
fi

# ── Load compose-level env (REGISTRY_OWNER, IMAGE_TAG) ───────────────────────
if [[ -f "$COMPOSE_DIR/.env" ]]; then
    set -o allexport
    # shellcheck disable=SC1090
    source "$COMPOSE_DIR/.env"
    set +o allexport
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

# ── Resolve image names from compose env ─────────────────────────────────────
REGISTRY_OWNER="${REGISTRY_OWNER:-}"
BACKEND_IMAGE="ghcr.io/${REGISTRY_OWNER}/sos-backend"
FRONTEND_IMAGE="ghcr.io/${REGISTRY_OWNER}/sos-frontend"

# ── Step 2: save rollback tags (local, instant — no copy of layers) ───────────
log "Saving rollback images..."
SAVED_BACKEND=false
SAVED_FRONTEND=false

if docker image inspect "${BACKEND_IMAGE}:latest"  &>/dev/null; then
    docker tag "${BACKEND_IMAGE}:latest"  "${BACKEND_IMAGE}:rollback"
    SAVED_BACKEND=true
    log "  backend:rollback saved"
fi
if docker image inspect "${FRONTEND_IMAGE}:latest" &>/dev/null; then
    docker tag "${FRONTEND_IMAGE}:latest" "${FRONTEND_IMAGE}:rollback"
    SAVED_FRONTEND=true
    log "  frontend:rollback saved"
fi

# ── Step 3: build or pull ─────────────────────────────────────────────────────
if [[ "$NO_BUILD" == true ]]; then
    if [[ -z "$REGISTRY_OWNER" ]]; then
        err "REGISTRY_OWNER is not set. Create cloud/.env with REGISTRY_OWNER=your-github-username"
        exit 1
    fi
    log "Pulling images from GHCR (${REGISTRY_OWNER})..."
    $DC -f "$COMPOSE_DIR/docker-compose.yml" pull
else
    log "Building images locally..."
    $DC -f "$COMPOSE_DIR/docker-compose.yml" build
fi

# ── Step 4: restart containers ────────────────────────────────────────────────
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
            # --no-pull: use the locally tagged images, don't re-pull from registry
            $DC -f "$COMPOSE_DIR/docker-compose.yml" up --no-pull --force-recreate -d
            err "Rollback done. Previous version restored."
        else
            err "No rollback images found — nothing to restore."
        fi
        exit 1
    fi
    log "  waiting... ($ATTEMPT/$HEALTH_RETRIES)"
    sleep "$HEALTH_INTERVAL"
done

ok "Deploy successful! Commit: $COMMIT"
