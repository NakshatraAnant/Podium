# Podium v2 — AMM Brands LLP

Production operating system for AMM Brands LLP (multi-city event production & premium
bartending — Jaipur HQ, Udaipur, Delhi, Mumbai, Bengaluru, Goa). Replaces the
single-file prototype (`docs/prototype-reference.md` describes it) with a real
backend, auth, RBAC, city scoping, and data integrity.

See `docs/PODIUM-V2-PRODUCTION-BLUEPRINT.md` for the full architecture, and
`docs/STATUS.md` for what is actually built, tested, and still stubbed as of the
latest commit — read that before assuming any given phase is production-ready.

## Stack

- **Frontend**: Next.js 14 (App Router) + React + TypeScript + Tailwind + TanStack Query
- **Backend**: NestJS (Node.js + TypeScript)
- **Database**: PostgreSQL 16 via Prisma
- **Queue/jobs**: Redis + BullMQ
- **Realtime**: Postgres LISTEN/NOTIFY → NestJS WebSocket Gateway
- **Monorepo**: pnpm workspaces

## Repository layout

```
/apps/web            Next.js app
/apps/api            NestJS app
/packages/db         Prisma schema, migrations, seed
/packages/shared-types  Zod schemas shared between frontend and backend
/packages/ui         Design system (brass/paper/Plex/Lora theme, ported from prototype)
/workers             BullMQ job processors
/tests               Cross-cutting integration/E2E tests
/docs                Blueprint, screens.md, STATUS.md, ADRs, runbooks
/scripts             Seed, import, backup-verify scripts
```

## Local development

Prerequisites: **Node 20+**, **pnpm 10** (`corepack enable` picks up the version
pinned in `packageManager`), and either Docker or a local Postgres 16 + Redis 7.

Run these from the repository root, in order. The order matters — step 4 builds
`@podium/shared-types`, which the API imports and cannot compile without.

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres 16 + Redis 7
docker compose up -d
#    -> creates the podium_dev and podium_shadow databases on first boot

# 3. Create your env file (the committed defaults work as-is for local dev)
cp .env.example .env

# 4. Build shared packages, generate the Prisma client, apply migrations
pnpm setup

# 5. Load the demo fixture (clients, projects, vendors, inventory, flows…)
PODIUM_ALLOW_DESTRUCTIVE_SEED=1 pnpm db:seed

# 6. Start the API, and the web app in a second terminal
pnpm dev:api
pnpm dev:web
```

Then open <http://localhost:3000> and sign in as any seeded user — e.g.
`anant.sharma@ammbrands.in` (Founder, all-city access) with the dev password
printed at the end of the seed output. The seed fixture is
**development/demo data only and is never used in production**.

Step 5 requires `PODIUM_ALLOW_DESTRUCTIVE_SEED=1` on purpose: seeding TRUNCATEs
every table in whatever `DATABASE_URL` points at, so it refuses to run without
an explicit confirmation, on top of refusing any database whose name doesn't end
in `_dev`/`_ci`/`_test` and any database that already holds real volumes of data
(see `assertSafeToSeed` in `packages/db/prisma/seed.ts`, and `docs/STATUS.md`
§1.1). Do not wrap this into a script — the friction is the feature.

### Without Docker

If you'd rather run Postgres and Redis directly, nothing else changes — the app
only cares that they're reachable on `localhost:5432` and `localhost:6379` with
the credentials in `.env.example`:

```bash
createuser podium --createdb            # password: podium_dev_password
createdb -O podium podium_dev
createdb -O podium podium_shadow        # Prisma's migration-diffing scratch DB
redis-server --daemonize yes
```

### Running the tests

The e2e suite has its own database and its own env file, so it can never be
pointed at your dev (or, catastrophically, production) data — `jest.setup.ts`
refuses to start if `DATABASE_URL` doesn't end in `_test`:

```bash
cp .env.test.example .env.test          # then point it at podium_test
createdb -O podium podium_test          # or: docker compose exec postgres createdb -U podium podium_test
DATABASE_URL="postgresql://podium:podium_dev_password@localhost:5432/podium_test?schema=public" \
  PODIUM_ALLOW_DESTRUCTIVE_SEED=1 pnpm db:seed

pnpm --filter @podium/api test          # the full e2e suite
pnpm test                               # everything, all packages
```

Run the suite before every commit that touches schema or business logic.

### If something breaks

Every one of these was hit, diagnosed and fixed by actually following the steps
above from a clean clone — they're the failure modes worth recognising:

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@podium/shared-types'` when starting the API | `shared-types` compiles to `dist/`, which doesn't exist in a fresh clone | Run `pnpm setup` (step 4) before step 6 |
| `Cannot find module '../common/decorators/...'` at API startup, right after fixing the above | A failed compile left a partial `apps/api/dist`, and the incremental rebuild considers it current | `rm -rf apps/api/dist apps/api/tsconfig.tsbuildinfo`, then `pnpm dev:api` |
| `Configuration key "JWT_ACCESS_SECRET" does not exist` | `.env` missing at the repo root — the API resolves it relative to its own source, not your shell's cwd | `cp .env.example .env` (step 3) |
| `P1012 Environment variable not found: DATABASE_URL` from Prisma | Same — no root `.env` | `cp .env.example .env` (step 3) |
| `Refusing to seed: … Set PODIUM_ALLOW_DESTRUCTIVE_SEED=1` | The seed guard, working as designed | Use the step 5 command exactly as written |
| `Refusing to seed: … (resolved database: "")` | Prisma/seed found no `DATABASE_URL` at all | `cp .env.example .env` (step 3) |
| `prisma migrate dev` stops at `Enter a name for the new migration` | `schema.prisma` has drifted from the committed migrations | Setup uses `migrate deploy`, which never prompts. If you see this while *authoring* a schema change, it's telling you the truth — name the migration and commit it |
| `docker compose up -d` fails to pull images | No network access to Docker Hub | Use the "Without Docker" path above |

## What must never be done (non-negotiable, see blueprint §7 / prompt §7)

- No client-computed financial or inventory totals — always server-derived.
- No RBAC "hidden button" — every mutating/financial/PII endpoint is guarded server-side.
- No raw inventory quantity writes — every stock change is a ledger row in
  `inventory_movements`; balances are always derived.
- No UPDATE on an issued invoice — corrections go through credit/debit notes.
- No blending of the P&L forecast model with real actuals in the same figure.
- No skipped audit-log write on a mutating endpoint.
