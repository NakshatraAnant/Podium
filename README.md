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

1. `pnpm install`
2. `docker compose up -d` — starts Postgres 16 + Redis locally
3. `cp .env.example .env` and fill in values (defaults work for local dev; Google
   OAuth is optional and runs in stub/sandbox mode without it — see
   `docs/integration-setup.md`)
4. `pnpm --filter @podium/db generate && pnpm --filter @podium/db migrate`
5. `pnpm --filter @podium/db seed` — loads the demo fixture derived from the
   prototype's own seed arrays (clients, projects, vendors, inventory, flow
   templates, etc.) — **development/demo data only, never used in production**
6. `pnpm dev:api` and, in another terminal, `pnpm dev:web`
7. `pnpm test` before every commit that touches schema or business logic

## What must never be done (non-negotiable, see blueprint §7 / prompt §7)

- No client-computed financial or inventory totals — always server-derived.
- No RBAC "hidden button" — every mutating/financial/PII endpoint is guarded server-side.
- No raw inventory quantity writes — every stock change is a ledger row in
  `inventory_movements`; balances are always derived.
- No UPDATE on an issued invoice — corrections go through credit/debit notes.
- No blending of the P&L forecast model with real actuals in the same figure.
- No skipped audit-log write on a mutating endpoint.
