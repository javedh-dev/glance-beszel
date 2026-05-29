#!/usr/bin/env bash
# run.sh — Run the Glance Beszel extension without Docker
# Usage: ./run.sh
# Reads configuration from .env in the same directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present (for shell-level validation below)
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
else
  echo "WARNING: No .env file found. Copy .env.example to .env and fill in your values."
fi

# Validate required variables
: "${BESZEL_URL:?BESZEL_URL is required — set it in .env}"
: "${BESZEL_EMAIL:?BESZEL_EMAIL is required — set it in .env}"
: "${BESZEL_PASSWORD:?BESZEL_PASSWORD is required — set it in .env}"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Build if dist is missing or sources are newer
if [ ! -d dist ] || [ src -nt dist ]; then
  echo "Building TypeScript..."
  pnpm run build
fi

echo "Starting Glance Beszel extension on port ${PORT:-8088}..."
exec node dist/index.js
