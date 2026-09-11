#!/usr/bin/env bash
#
# Podium v2 — start everything, from nothing, in one command.
#
#   ./scripts/dev-up.sh              # demo fixture (safe, reproducible)
#   ./scripts/dev-up.sh --real-data  # also import AMM's real spreadsheets
#
# Brings up Postgres + Redis, installs dependencies, applies migrations, seeds,
# builds, starts the API and the web app, and does not claim success until both
# ports actually answer and a real login returns a token.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_REAL_DATA=0
[[ "${1:-}" == "--real-data" ]] && WITH_REAL_DATA=1

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --------------------------------------------------------------- 1. env
if [[ ! -f .env ]]; then
  say "Creating .env from .env.example"
  cp .env.example .env
fi
set -a; . ./.env; set +a

# ------------------------------------------------- 2. postgres + redis
say "Starting Postgres and Redis"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d
  echo "Waiting for Postgres..."
  until docker compose exec -T postgres pg_isready -U podium -d podium_dev >/dev/null 2>&1; do sleep 1; done
else
  echo "Docker is not available — expecting Postgres on :5432 and Redis on :6379 already."
  until pg_isready -h localhost >/dev/null 2>&1; do sleep 1; done
fi
echo "Postgres is up."

# The shadow database Prisma needs for migration diffing. Created here so
# nobody is ever tempted to point --shadow-database-url at the real one.
PGPASSWORD="${PGPASSWORD:-podium_dev_password}" \
  psql -h localhost -U podium -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='podium_shadow'" 2>/dev/null | grep -q 1 || \
  PGPASSWORD="${PGPASSWORD:-podium_dev_password}" \
  psql -h localhost -U podium -d postgres -c "CREATE DATABASE podium_shadow OWNER podium;" >/dev/null 2>&1 || true

# ------------------------------------------------------ 3. dependencies
say "Installing dependencies"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --------------------------------------------------- 4. schema + seed
say "Applying migrations"
pnpm --filter @podium/db exec prisma migrate deploy
pnpm --filter @podium/db exec prisma generate

say "Seeding the demo fixture"
pnpm --filter @podium/db run seed

if [[ "$WITH_REAL_DATA" == "1" ]]; then
  say "Importing AMM Brands' real data (this REPLACES the demo fixture)"
  pnpm run import:real-data
fi

# ------------------------------------------------------------ 5. build
say "Building"
pnpm --filter @podium/shared-types build
rm -f apps/api/tsconfig.tsbuildinfo
pnpm --filter @podium/api exec nest build
NODE_ENV=production NEXT_PUBLIC_API_URL=http://localhost:3001/api pnpm --filter @podium/web build

# ------------------------------------------------------------ 6. start
say "Starting the API on :3001"
mkdir -p .run
node apps/api/dist/main.js > .run/api.log 2>&1 &
echo $! > .run/api.pid
until curl -sf -o /dev/null http://localhost:3001/api/auth/login 2>/dev/null \
   || curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/auth/login | grep -qE '4|2'; do sleep 1; done

say "Starting the web app on :3000"
NODE_ENV=production NEXT_PUBLIC_API_URL=http://localhost:3001/api \
  pnpm --filter @podium/web start > .run/web.log 2>&1 &
echo $! > .run/web.pid
until curl -s -o /dev/null http://localhost:3000 2>/dev/null; do sleep 1; done

# ---------------------------------------------------------- 7. verify
say "Verifying a real login"
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anant.sharma@ammbrands.in","password":"Podium123!"}' \
  | node -pe 'try{JSON.parse(require("fs").readFileSync(0)).accessToken??""}catch(e){""}')

if [[ -z "$TOKEN" ]]; then
  echo "Login failed — see .run/api.log" >&2
  exit 1
fi
CLIENTS=$(curl -s "http://localhost:3001/api/clients?limit=1" -H "Authorization: Bearer $TOKEN" \
  | node -pe 'try{JSON.parse(require("fs").readFileSync(0)).total??"?"}catch(e){"?"}')

cat <<EOF

  It's ready.

    Open        http://localhost:3000
    Log in as   anant.sharma@ammbrands.in
    Password    Podium123!   (dev-only, every seeded user shares it)

    API         http://localhost:3001/api
    Clients in the database: $CLIENTS
    Logs        .run/api.log  .run/web.log
    Stop with   ./scripts/dev-down.sh

EOF
