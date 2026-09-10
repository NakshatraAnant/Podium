# Podium v2 — Build Status

*Last updated: end of the initial build session (single continuous engagement).
This file is the authoritative "what's actually true" document — read it before
assuming any phase, screen, or endpoint is production-ready. `docs/screens.md`
is the functional spec; this file is the honest progress report against it.*

## 0. Read this first

The original brief asked for all 12 phases of the blueprint built end-to-end
in one engagement, including hardening (security review, load testing,
backup/DR verification) and a staging deployment. That is not what happened,
and pretending otherwise would be a worse outcome than saying so plainly:

- **What's real**: a genuinely working, tested product slice — real auth,
  real RBAC enforced server-side, real city scoping, a real flow-engine state
  machine, a real ledger-based inventory system, real GST-correct invoicing
  with immutability, and a real (if partial) frontend, all running against a
  real local Postgres 16 instance, not mocked. Every claim below of the form
  "X works" was verified by actually running X during this session — API
  calls via curl and Jest/Supertest, and the frontend via an actual headless
  browser (Playwright) driving the built Next.js production server against
  the live API. Nothing here is "should work."
- **What's not real yet**: several modules exist only as Prisma schema with
  no API endpoints (procurement PO/GRN, event-day, mail/calendar/meetings
  sync, playbooks CRUD, the automation engine's actual runtime, reports/P&L
  aggregation). Security hardening (load testing, a formal pen-test pass,
  backup/DR drills, production secrets/infra) has not been done at all —
  there is no staging or production environment to hardened in the first
  place. Gmail/Calendar/Meet integration is schema-only; no OAuth flow
  exists (see `docs/integration-setup.md` for what's needed to build it).

Treat every "🚧" or "⬜" row in `docs/screens.md` as literally not done, not
as "mostly done." Treat every "✅" row as verified working as of this
session's testing, not as "permanently correct" — it hasn't been through
review by anyone but this session.

## 1. What's built, phase by phase

### Phase 0 — Repo, CI/CD, DB schema, design system
- ✅ pnpm workspace monorepo (`apps/{web,api}`, `packages/{db,shared-types,ui}`,
  `workers/` placeholder, `tests/` placeholder, `docs/`, `scripts/` placeholder).
- ✅ Docker Compose for local Postgres 16 + Redis 7 (this session used the
  sandbox's already-installed local Postgres/Redis instead, since Docker's
  daemon wasn't running in the sandbox — `docker-compose.yml` is there and
  correct for a normal dev machine; it was not exercised this session).
- ✅ Full Prisma schema: 65 domain tables (71 including join tables and
  Prisma's own migrations table) covering every entity in blueprint §9 plus
  the explicitly-called-out `[REQUIRED]` additions, verified by running
  `prisma migrate dev` against a real Postgres instance.
- ✅ Seed script loading every core prototype array as dev/demo fixture data
  (never a production path — see blueprint §37 and the script's own header
  comment).
- ✅ `docs/screens.md` — all 33 screens reverse-engineered (blueprint sampled
  13 of 33; this repo completes the other 20).
- ✅ Design system port: `packages/ui/src/tokens.css` is close to a literal
  copy of the prototype's `<style>` block (same class names — `.pcard`,
  `.fnode`, `.pill`, `.kcard`, etc.), not a Tailwind reimplementation. See §5
  below for why Tailwind itself was dropped from the actual build despite
  being named in the blueprint's stack table.
- ✅ GitHub Actions CI (`  .github/workflows/ci.yml`): Postgres+Redis service
  containers, migrate+seed, lint+typecheck+build+test across every package.
  Never run on GitHub's infrastructure by this session — validated by running
  the equivalent commands locally (`pnpm -r typecheck`, `pnpm -r lint`,
  `pnpm --filter @podium/api test`), all green, but the workflow YAML itself
  has not had a real CI run against it yet.

### Phase 1 — Auth, workspace, users, roles, city scoping
- ✅ JWT access tokens (15 min) + rotating refresh tokens (bcrypt-hashed
  password storage, refresh tokens hashed at rest, rotated on every use).
- ✅ RBAC: `roles`/`permissions`/`role_permissions`/`user_roles` tables, a
  global `PermissionsGuard` reading a resolved `resource:action` set,
  `@RequirePermissions()` on every mutating/financial endpoint built so far.
- ✅ City scoping: `CityScopeService` builds the Prisma `where` filter from
  `user_city_access`; "all cities" is the explicit `ALL` scope, never an
  absent filter — verified with a test asserting a Udaipur-scoped PM only
  sees Udaipur projects even though he's PM on projects in two other cities
  (see the "known limitation" note in §6).
- ✅ Audit: `@Audit()` + a global interceptor writes `audit_logs` centrally.
  **Known gap**: "before" state is not automatically captured — the
  interceptor logs actor/action/entity/"after" reliably, but a true
  before/after diff would need each service to fetch-then-mutate and pass
  the prior state through, which hasn't been done everywhere. Treat the
  audit log today as a reliable "who did what to which entity when," not
  yet a full before/after diff on every row.
- ⬜ Google OAuth / SSO — not built. Email+password only.

### Phase 2 — Clients, CRM, Projects, Playbooks
- ✅ Clients, Vendors: full CRUD, city-scoped.
- ✅ Leads/CRM: list, create, stage changes, and a real **Deal-Won → Project**
  conversion endpoint (`POST /leads/:id/convert`) that atomically creates
  (or reuses) the client, creates the project, creates its chat channel, and
  notifies the assigned PM — inside one DB transaction.
- ✅ Projects: CRUD, city-scoped, with a `recomputeHealth()` method (overdue
  tasks + open critical risks + days-to-event + budget variance) — **written
  but not wired to run automatically on every relevant write yet**; it has
  to be called explicitly. The thresholds inside it are this session's own
  reasonable-sounding numbers, not something Ops signed off on — flagged per
  prompt §17 as an assumption to revisit, not a financial one so not
  interrupt-worthy, but worth a real conversation before it drives anything
  visible to a client.
- ⬜ Playbooks: schema exists (`playbooks` table with `default_stages`/
  `default_tasks`/`default_flow_template_ids` as jsonb), no CRUD endpoints,
  no wiring from Deal-Won into "stamp tasks/flows from the chosen playbook."
  The Deal-Won endpoint accepts an optional `playbookId` and stores it, but
  does not yet read it to generate anything.

### Phase 3 — Tasks, Timeline, Flow Engine
- ✅ Tasks: CRUD, city-scoped (via project), optimistic-concurrency guard on
  update (`expectedUpdatedAt`) so a stale kanban drag can't silently clobber
  a concurrent change.
- ✅ **Flow engine — the platform's real differentiator, and the most
  thoroughly built and tested part of this whole session.** Server-
  authoritative state machine (`LOCKED → READY → ACTIVE → COMPLETED`, plus
  `BLOCKED/ESCALATED/CANCELLED/FAILED` in the schema though only the happy
  path transitions are wired), transactional `start`/`complete`/`reassign`/
  `nudge`, AND-join dependency resolution (a step only unlocks once *every*
  dependency is `COMPLETED`), an immutable `flow_step_runs` row per
  transition, in-app notification + "Podium Bot" project-channel message
  fan-out on unlock. Row-level authorization: only the step's assigned
  owner, or a `flows:edit` holder acting as manager override, can act on a
  given step — this is deliberately *not* gated purely by role, since
  ownership of a specific step (not a broad resource grant) is what the
  prototype's own model implies.
  - **Not built**: OR-join (schema has `join_type` on `flow_step_dependencies`
    but only `AND` is ever written or evaluated), SLA-breach → `ESCALATED`
    automation (no scheduled job checks `readyAt + slaMinutes` against `now()`
    — this needs the BullMQ worker infrastructure, which doesn't exist yet),
    automatic reassignment on approved leave.
- ⬜ Timeline: no dedicated endpoint. It's a pure derived view over
  `projects.eventDate` per `docs/screens.md`'s own note — no page built yet.

### Phase 4 — Chat, Notifications
- ✅ Channels: company/city/project channel listing (respecting city scope),
  message history, posting. DM channels are schema-ready but the API
  explicitly rejects reads on `kind=DM` channels for now (`ForbiddenException`
  with a clear message) rather than half-implementing them.
- ⬜ `@mention` → task promotion (the prototype's worked
  "@Rohit please confirm sound vendor" example) — deliberately not built as
  an ad hoc parser; deferred to the automation engine so it's one
  configurable rule instead of special-cased chat logic.
- ✅ Notifications: written by the flow engine and the Deal-Won conversion;
  no dedicated `GET /notifications` endpoint or UI bell yet.

### Phase 5 — Vendors, Procurement
- ✅ Vendors: CRUD (see Phase 2).
- ⬜ Procurement: `purchase_requests`/`purchase_orders`/`goods_receipts`
  tables exist; **no API endpoints at all**. The PR→PO→GRN pipeline, and the
  GRN→`inventory_movements(type=RECEIVE)` trigger the blueprint calls for,
  is schema-only.

### Phase 6 — Inventory, Menu Costing
- ✅ **Inventory ledger — the second most thoroughly tested part of this
  session.** One `POST /inventory/movements` endpoint typed by `type`
  (blueprint §40's own API design), balances row-locked
  (`SELECT ... FOR UPDATE`) and recomputed from the movement inside the same
  transaction, never written directly. Verified under real concurrency: 5
  simultaneous `CONSUME` requests against 2 units of stock produce exactly 2
  successes and 3 rejections, never a negative balance.
- ⬜ Menu costing (`recipes`/`recipe_items`) and the "reserve stock from
  guest count × drinks" auto-reservation flow the blueprint describes:
  schema exists, no endpoints, no auto-reservation logic.
- ⬜ Idempotency-key support exists on the inventory-movement and invoice/
  payment endpoints (an `idempotency_keys`-style check via a unique column,
  not yet the full generic idempotency-key table/middleware the schema
  reserves for it) — enough to survive a naive client retry, not yet a
  hardened idempotency layer.

### Phase 7 — Finance, Invoices, Payments
- ✅ **Invoicing — the third most thoroughly tested part of this session.**
  Sequential, gap-free, never-reused numbering per city per financial year
  (`AMM/{CITY}/{FY}/{SEQ}`) under a locked counter row; real CGST/SGST-vs-
  IGST split computed from the issuing city's GST state code vs. the
  client's; **issued invoices are immutable — there is no update endpoint
  for an issued invoice's amounts or items, on purpose**; corrections are
  `credit_notes`/`debit_notes` only. Payment recording updates invoice
  status (`DRAFT → ISSUED → PARTIALLY_PAID/PAID`) transactionally.
- ⬜ `overdue` status is not computed anywhere yet (it's in the enum, nothing
  sets it — needs a scheduled job comparing `dueDate` to `now()`).
- ⬜ Budgets/`budget_lines`: schema only, no endpoints.
- ⬜ Real P&L aggregation (blueprint §16 — actuals over invoices/expenses/
  payments, explicitly *not* the prototype's seasonality-forecast model):
  not built. There is no `pnl` or `finance` aggregation endpoint at all yet;
  the frontend's dashboard does its own crude client-side sum over
  `/projects`, which is a stopgap, not the real thing — **do not treat
  anything in this build as a P&L**, forecast or actual.
- ⬜ Expenses: schema only, no endpoints (the prototype's approve/reimburse
  flow is not implemented).

### Phase 8 — Compliance, Event Day
- ✅ Licences: CRUD + the `advance()` status-machine action
  (`NOT_APPLIED → APPLIED → APPROVED`/`REJECTED`), city-scoped.
  `escalation_offset_days` is a real column (default 7, matching the
  prototype's hardcoded T-7) but nothing reads it yet — no scheduled job
  raises the T-x escalation automatically.
- ✅ Risks: CRUD, city-scoped via project.
- ✅ Approvals: create + `decide()` (approve/reject with a reason).
- ⬜ Event Day (`runsheets`/`runsheet_items`/`event_day_checkins`/
  `event_day_incidents`): schema only, seeded with one demo runsheet
  (Tourism Conclave) and one demo incident, but **no API endpoints** — no
  way to tick a cue, check in crew, or log an incident through the API yet.
  The incident → auto-risk-if-High/Critical behavior described in blueprint
  §20 is not implemented.
- ⬜ Documents: schema only (`documents`/`document_versions`), no endpoints,
  no storage-driver interface built (the local-disk-vs-S3 abstraction
  described in the original prompt is not started).

### Phase 9 — Gmail, Calendar, Meet
- ⬜ Entirely unbuilt beyond schema (`emails`, `meetings`,
  `meeting_action_items`). No OAuth flow, no stub/sandbox mode UI, nothing.
  See `docs/integration-setup.md` for what a future session needs to build
  this and what credentials the user needs to supply.

### Phase 10 — Reports, P&L, Cash Flow
- ⬜ Not built. See Phase 7's P&L note — this is the same gap from the
  reporting-consumer side.

### Phase 11 — Automation Engine
- ✅ `automation_rules` seeded with all ten of the prototype's rules
  (`au1`–`au10`), generalized into `trigger_type`/`trigger_config`/`actions`
  jsonb per blueprint §12's shape.
- ⬜ **No runtime.** There is no BullMQ worker, no scheduler, no rule
  evaluator. The rules sit in the database as configuration with nothing
  executing them. This is the single largest gap between "what the schema
  implies" and "what actually runs" in this build — flagged clearly rather
  than glossed over, since it's easy to skim the seed data and assume
  automation is live.

### Phase 12 — Hardening
- ⬜ Not attempted. No load testing, no formal security review beyond the
  RBAC/city-scope/audit patterns already built in from Phase 1, no backup/DR
  drill (there is no deployed environment to drill against), no dependency
  vulnerability scan beyond whatever `pnpm install`'s own advisories surfaced
  in passing.

## 2. What's genuinely verified (not just written)

- **17 Jest e2e tests** (`apps/api/test/*.e2e-spec.ts`) run against a real
  NestJS app instance + local Postgres, not mocks: RBAC enforcement and city
  scoping, the flow engine's AND-join end to end (including "the join must
  NOT fire on the first of two dependencies"), GST split correctness for
  both intra- and inter-state invoices, sequential invoice numbering,
  invoice immutability (`409` on a second `issue` call), and inventory
  ledger concurrency safety.
- **A real headless-browser run** (Playwright, not part of the committed
  test suite — a manual verification pass) against the built Next.js
  production server + live API + seeded Postgres: login → dashboard →
  projects (all 11 render) → project detail → Flows tab (all 7 seeded G&T
  steps render in their true DB state) → Flows page → changed a task's
  kanban column from the actual UI and confirmed the write reached Postgres.
- **Manual curl verification** of the initial auth/RBAC/city-scope/flow-
  engine/inventory/invoice pipeline before the automated tests existed
  (kept in this session's own history, not re-run at the end, but the same
  code paths are now covered by the Jest suite).

## 3. Assumptions and judgment calls made along the way (prompt §17)

None of these are financial-calculation-level risks (which would have
warranted stopping to ask); all are logged here per the "make the call,
document it, keep moving" instruction:

1. **`ProjectStatus` enum** merges the blueprint's stated enum
   (Planning/In Progress/On Hold/Completed/Cancelled) with the actual values
   seen in prototype seed data (Planned, Client Review) into one superset
   enum, since the two sources disagreed and both are real.
2. **RBAC grants** for the 10 roles are this session's own reading of
   blueprint §11's prose table into concrete `resource:action` pairs — the
   table describes intent, not a literal grant list, so translating it
   required judgment. Two specific calls worth flagging:
   - Flow-step actions are authorized by *row-level ownership*
     (owner-of-this-step OR a `flows:edit` holder), not by the `Operations`/
     `Creative`/`Employee` role grants alone, because in the seed data
     Founder, Creative, and Operations staff all personally own individual
     flow steps (e.g., "Mix the gin" is owned by the Founder himself in the
     seeded G&T flow) — a pure role-based gate would have locked people out
     of their own assigned work.
   - Compliance (`licences`) and `risks` edit rights are restricted to
     Founder/Admin/PM/Finance per a literal reading of §11's table, even
     though in the seed data an Operations-role person (Devansh, Bar Ops
     Head) is listed as the "owner" of a licence — that field is treated as
     informational (who to contact), not an edit grant, because §11's table
     explicitly does not list Operations under Approve/edit for anything
     resembling compliance.
3. **City scope currently gates project *visibility* by the viewer's home-
   city grant alone** — a PM assigned to a project outside their home city
   (this happens in the seed data: Rohit Meena is PM on projects in Udaipur,
   Goa, and Jaipur but only has Udaipur city access) will not see that
   project in `GET /projects` today. Extending city-scope to also grant
   visibility via `project_members` is a reasonable follow-up, not done —
   flagged as a real, current limitation, not a hypothetical one, since a
   test in this repo (`rbac.e2e-spec.ts`) asserts this exact behavior.
4. **Health-score thresholds** in `ProjectsService.recomputeHealth()`
   (critical risk → RED, >15% cost overrun → RED, any overdue task with
   ≤3 days to event → RED, etc.) are this session's own reasonable-sounding
   numbers, explicitly not something AMM's Ops team has validated.
5. **`createdById`/`updatedById` are plain UUID columns, not enforced Prisma
   relations** to `users` — documented in the schema file's own header
   comment. This avoids ~120 named self-relations to `User` across 60
   tables; the authoritative attribution trail is `audit_logs`, not these
   columns.
6. **Auth tokens live in `localStorage`** on the frontend, not httpOnly
   cookies — a pragmatic dev-time choice for this session, not a production
   security posture. A real deployment should move to httpOnly cookie
   sessions or a properly configured token-refresh-with-rotation flow with
   XSS mitigations beyond React's default output encoding.
7. **Tailwind was dropped from the actual implementation** despite being
   named in blueprint §8's stack table. The prototype's own CSS is compact
   and already does exactly what's needed; porting it directly as
   `packages/ui/src/tokens.css` (with the prototype's own class names
   preserved) was faster, lower-risk, and arguably *more* faithful to "port,
   don't redesign" than reimplementing the same visual language as Tailwind
   utility classes would have been. If a future session wants Tailwind for
   net-new screens, it can coexist with the ported CSS.
8. **Equipment resources** (Mobile Bar Unit, LED Wall, Generator, etc. on
   the prototype's Resources screen) were deliberately left out of the
   schema — blueprint §9 doesn't define an `equipment` table, and the
   prototype's own resource list is static/cosmetic with no CRUD. Flagged in
   `docs/screens.md` rather than silently added or silently dropped.

## 4. Tables that exist with zero API surface today

For quick scanning: `playbooks`, `purchase_requests`/`purchase_orders`/
`goods_receipts`, `recipes`/`recipe_items`, `budgets`/`budget_lines`,
`expenses`, `documents`/`document_versions`, `runsheets`/`runsheet_items`/
`event_day_checkins`/`event_day_incidents`, `emails`, `meetings`/
`meeting_action_items`, `sops`/`sop_versions`, `automation_runs`,
`freelancers`/`attendance`/`leaves` (seeded with data, no CRUD endpoints).

## 5. Recommended next steps, in order

1. **UAT with actual AMM Brands staff on what's built** before writing
   another line of code for the unbuilt phases — the flow engine and
   invoicing are real and demoable today; get a founder/ops/finance person's
   eyes on them before investing further, since several of §3's judgment
   calls (RBAC grants especially) are exactly the kind of thing a real user
   will immediately have an opinion about.
2. **Automation engine runtime** (BullMQ worker + scheduler + rule
   evaluator) — this is the single biggest gap between "what's seeded" and
   "what's live," and several other gaps (SLA escalation, licence T-7
   escalation, invoice-overdue detection, low-stock → PR) all depend on it
   existing rather than being independent pieces of work.
3. **Procurement (PO/GRN) and Event Day** — both are pure CRUD + one state
   machine each, following the exact patterns already proven out in this
   codebase (compare to `licences`/`risks`); low risk, clear payoff.
4. **Real P&L/reports aggregation**, explicitly separated from and never
   blended with a forecast view, before anyone in Finance is shown a number
   from this system.
5. **Security review pass + a real staging deployment** before any of this
   touches real client data or real money — this build has never been
   reviewed by anyone but the session that wrote it, has no production
   secrets management, and has not been load-tested at all.
