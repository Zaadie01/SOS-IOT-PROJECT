#!/usr/bin/env bash
# local-deploy.sh — build images on your machine, send to server over SSH.
# No registry needed. Run from the project root.
#
# Usage:
#   bash cloud/scripts/local-deploy.sh
#   SERVER=root@1.2.3.4 bash cloud/scripts/local-deploy.sh
set -euo pipefail

SERVER="${SERVER:-deploy@IP_СЕРВЕРА}"
REMOTE_PATH="${REMOTE_PATH:-~/sos/SOS-IOT-PROJECT}"
COMPOSE_FILE="cloud/docker-compose.yml"

BACKEND_IMAGE="ghcr.io/yehjk/sos-backend:latest"
FRONTEND_IMAGE="ghcr.io/yehjk/sos-frontend:latest"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── 1. Build locally ──────────────────────────────────────────────────────────
log "Building backend..."
docker build -t "$BACKEND_IMAGE"  cloud/backend

log "Building frontend..."
docker build -t "$FRONTEND_IMAGE" cloud/frontend

# ── 2. Sync compose files (fast, only changed files) ─────────────────────────
log "Syncing compose files to server..."
rsync -az --exclude 'node_modules' --exclude '.git' --exclude 'data' \
  --exclude 'backend/.env' \
  cloud/ "${SERVER}:${REMOTE_PATH}/cloud/"

# ── 3. Send images over SSH (compressed pipe, no registry) ───────────────────
log "Sending images to server (this takes ~30-60s)..."
docker save "$BACKEND_IMAGE" "$FRONTEND_IMAGE" \
  | gzip \
  | ssh "$SERVER" "gunzip | docker load"

# ── 4. Restart containers ─────────────────────────────────────────────────────
log "Restarting containers..."
ssh "$SERVER" "cd ${REMOTE_PATH}/cloud && docker compose up -d"

log "✅  Done!"
