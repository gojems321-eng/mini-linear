#!/usr/bin/env bash
# Package Mini-Linear as a clean source zip for GitHub upload + Vercel deploy.
# - Excludes: node_modules, .next, .git, secrets (.env / .auth-secret / backup),
#   local sqlite data (db/), logs, sandbox deliverables (download/, upload/, skills/)
# - Swaps prisma/schema.prisma to the PostgreSQL (Neon) variant.
set -euo pipefail

ROOT=/home/z/my-project
STAGE=$ROOT/.stage-pkg
OUT=$ROOT/download/mini-linear-vercel-ready.zip

cd "$ROOT"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# Stage the project, excluding build artifacts, secrets and local data.
tar cf - \
  --exclude='*node_modules*' \
  --exclude=./.next \
  --exclude=./.git \
  --exclude=./.vercel \
  --exclude=./.auth-secret \
  --exclude=./.env \
  --exclude=./db \
  --exclude=./download \
  --exclude=./upload \
  --exclude=./skills \
  --exclude=./.stage-pkg \
  --exclude=./scripts/.env.backup \
  --exclude=./next-env.d.ts \
  --exclude='*.tsbuildinfo' \
  --exclude='*.log' \
  --exclude=./server.log \
  --exclude=./dev.log \
  . | (cd "$STAGE" && tar xf -)

# Ship the PostgreSQL/Neon schema as the one true schema.prisma.
cp prisma/schema.postgres.prisma "$STAGE/prisma/schema.prisma"
rm -f "$STAGE/prisma/schema.postgres.prisma"

# Zip it.
cd "$STAGE"
zip -qr "$OUT" .
cd "$ROOT"
rm -rf "$STAGE"

echo "Zip written: $OUT"
stat -c '%s bytes' "$OUT"
