# Podium v2 — Build Status

*Last updated: after the real-data import (2026-09-11) that replaced the
development seed fixture with AMM Brands' actual client, vendor, staffing
and pipeline records — see §0.0 below. The production-readiness audit that
precedes it (§0.1) re-verified everything by actually running it: real
requests, real database queries, real test runs. This file is the
authoritative "what's actually true" document — read it before assuming any
phase, screen, or endpoint is production-ready. `docs/screens.md` is the
functional spec; this file is the honest progress report against it.*

## 0.0 Real-data import — 2026-09-11

`scripts/import-real-data.ts` (run with `pnpm import:real-data`) replaces
the synthetic seed records in `clients`, `vendors`, `freelancers` and
`leads` with AMM Brands' real data from two workbooks. **This is not the dev
seed.** `pnpm --filter @podium/db seed` still builds the demo fixture that
CI and the e2e suite run against; the import is a separate, destructive
production load. Run the import only against a database intended to hold
production data, and re-run the seed before running the test suite locally.

### Verified counts (live `SELECT COUNT(*)`, after import)

| Table / segment | Rows |
| --- | --- |
| `clients` — `EVENT_CLIENT` | 568 |
| `clients` — `RETAIL_CUSTOMER` (Cocktail Shop) | 51,456 |
| `vendors` | 163 |
| `freelancers` | 171 |
| `leads` — `PIPELINE` (live sales pipeline) | 369 |
| `leads` — `COLD_PROSPECT` (47 prospecting sheets) | 12,381 |
| leads linked to a client by the §9 cross-reference | 415 |

Zero rows in any of the four tables lack an import `source`/`source_file`,
i.e. **no synthetic record survives**. Every one of the 65,108 imported rows
was traced back to a row in the source workbook carrying the same values
(name + phone + address for clients, company + contact + email + address for
vendors, name + phone + category for freelancers, customer id + email for
retail, name or raw phone for leads) — an exhaustive check, not a sample.

### Security

`AMM_BRANDS_LLP_DATABASE.xlsx` contains a sheet of plaintext credentials.
It was never opened, read, parsed, or logged. `assertNotForbidden()` in the
import script **throws** rather than skipping if any sheet whose name
mentions passwords is reached, so a later refactor cannot start reading it
quietly.

### Data-quality findings in the source workbooks

These are real problems in AMM's spreadsheets, found by reading the data
rather than trusting the headers. They are handled in the importer and
listed here so they are not rediscovered later:

1. **`AMM CLIENT DATABASE` is several lists stacked in one sheet.** Nine
   rows repeat the header with a section label in the name column
   ("BUSINESS CLIENTS NAME", "PERSON NAME (Rotary Friends)", "CORPORATE
   COMPANY NAMES", ...). They are separators, not clients. They are skipped,
   and the label is used to set `Client.type` and recorded in `source` —
   better evidence than guessing company-vs-person from the name string.
2. **156 rows of that sheet are the supplier list pasted in**, with the
   e-mail sitting in the PHONE column. All 156 e-mails match the `Clients`
   sheet that §4 imports as vendors. Importing them would have filed AMM's
   suppliers as its customers; they are skipped, and the `Clients` sheet is
   treated as the authoritative copy.
3. **Three columns the import brief expects to drive CRM stage are
   effectively unused in the real data.** `Is he a Current client ( Y / N)`
   is blank in ~95% of rows and, where filled, holds menu and run-of-event
   notes rather than Y/N; `Package Proposed` is blank in 231 of 232 rows and
   `Advance` in all 232. Consequence: **no pipeline lead carries a deal
   value, and none is marked Won from that column.** A bare Y/N is still
   honoured where present; anything longer is preserved as requirement notes
   on `remarks` (31 leads) instead of being discarded. The 415 Won links all
   come from the §9 phone cross-reference instead.
4. **`ARCHIT PHONE DATABASE` is a personal copy of the client list.** It is
   the source of all 415 duplicates the cross-reference collapsed — each is
   now one client with its lead marked Won and linked, not two records.
5. **`Customer ID` in `DATA DUMP` is not unique** (3,375 IDs repeat; they
   are business names, not keys), and the sheet names two columns `phone`.
   The two phone columns are alternate numbers for one customer, not
   duplicates: only the first usable one is the dedupe key, but both raw
   values are kept.
6. **International numbers normalize lossily.** §2's rule (keep the last 10
   digits) is applied mechanically, so e.g. an Italian `(39) 340 188547`
   becomes `9340188547`. The original is always preserved in `phone_raw`,
   and 15 leads with no name at all are named by their normalized phone.

### Why the counts differ from the brief's estimates

The brief's expected figures count **only rows that have a usable phone**.
This import also keeps rows that have a name but no phone (which §7
explicitly requires), so every total is legitimately higher. Reconciled:

| | brief expected | phone-dedupable rows here | total imported |
| --- | --- | --- | --- |
| §3 clients | ~476 | 471 distinct phones | 568 |
| §6 pipeline (sheets 1–4) | ~144 | 143 distinct phones | — |
| §7 cold prospects | 8,000–9,000 | ~8,350 distinct phones | 12,381 |
| §8 retail | ~45,000 | 44,462 distinct phones | 51,456 |

Every phone-dedupable figure lands within a few rows of the brief. The gap
is entirely rows that cannot participate in phone dedupe: 1,606 cold rows
come from three sheets with no phone column at all (`jaipur hotels`,
`hotel and wedding resorts`, `ANM DELIVERY LIST`), and ~7,000 retail rows
are keyed on e-mail because they have no phone.

### Sheets deliberately NOT auto-imported — needs manual review

These 12 sheets have no usable header row in the normal position, or are not
lead data at all. They are **skipped, not forgotten**:

`EVENT PLANNERS DATABASE`, `Trade Fair`, `HOTELS`, `WOW AWARDS`,
`FARM HOUSE DATABASE`, `BRANDS PROFILES LISTING DATA`,
`DUBAI WEDDING PLANNER`, `IHM COLLEGES NORTH`,
`ANM CORORATES COMPANY CONTACT`, `ANM BOOK LIST`, `ANM BOOK BAR &REST`,
`2nd Edition International Barte[nder competition]`.

Separately, **`EVENT COSTING FOR DEHRADUN`** is real menu/event costing data,
not leads. Its header sits on row 2 and reads `S.No. | Category | Item
Description | Quantity | Unit Cost (INR) | Total Cost (INR) | Notes` — which
maps to the Menu Costing module in a future phase: `Category`+`Item
Description` → `recipes.name`/`recipe_items`, `Quantity` →
`recipe_items.qty`, `Unit Cost (INR)` → `recipe_items.unit_cost`, with
`Total Cost (INR)` derived, never stored (per the "never compute totals
client-side / never store a derivable total" rule).

### Schema changes this required

Migration `20260911120000_real_data_import_fields`. `cityId` is now nullable
on `clients`, `vendors`, `freelancers` and `leads`, because most real records
carry no city and guessing one would drive GST treatment and city scoping
from a fabricated value. **An unassigned record is visible only to ALL-scope
users** — a `cityId IN (...)` predicate excludes NULL, and
`assertCanAccessCity()` was widened to match exactly, so list and detail
views can never disagree. Also nullable for the same "unknown must stay
unknown" reason: `leads.value`/`ownerId`, `vendors.category`,
`freelancers.certExpiresAt` and `dayRate` (a fabricated certification expiry
would drive real event-day compliance decisions).

Added: `client_segment` and `LeadKind` enums; `phone`/`phone_raw`/`email`/
`address`/`source` across the four tables; lead provenance
(`source_sheet`, `source_file`) and detail (`location_text`, `event_type`,
`pax`, `event_date`, `remarks`, `intake_detail` JSON). Unique
`(workspace_id, phone)` on `clients`, `leads` and `freelancers` enforces the
dedupe at the database, not just in the script.

`GET /clients` and `GET /leads` are now **paged and segmented**: clients
default to `EVENT_CLIENT` and leads to `PIPELINE`, so the 51k retail dump
and 12k cold list can never bury the real B2B client list or the live
pipeline. Both accept `limit`/`offset`/`search` and return
`{ total, limit, offset, rows }`.

### Consequence of the full purge

Per an explicit decision recorded during this import, the demo clients and
vendors were removed along with everything that depended on them — **11
projects, 10 invoices, 26 project-vendor links, 5 purchase requests, 14
tasks and 1 flow instance**. The alternative was keeping synthetic clients,
which the brief forbade. Configuration and the inventory ledger were
deliberately left intact: cities, users, roles/permissions, inventory items,
locations, balances and movements, flow templates, playbooks, SOPs and
automation rules. `audit_logs` is never deleted — the import itself writes a
`data.real_import` row carrying the full per-section report.

**This means the live database has no projects, invoices, tasks or flow
instances.** Those features are built and tested but currently have no real
data to display, because AMM's workbooks contain none. The e2e suite is
unaffected: CI seeds the demo fixture before running tests.

### Test suite after the import

**28/28 passing** (up from 23) against a freshly seeded database, verified by
running it. Five new tests in `apps/api/test/city-scope-nullable.e2e-spec.ts`
cover the access-control case the nullable `cityId` introduced: an
unassigned-city row must be hidden from a city-scoped user in the list *and*
403 them on direct fetch (list and detail must never disagree), visible to an
ALL-scope user in both, with the clients list proven to page and to default
to `EVENT_CLIENT`.

One pre-existing fragility was confirmed while running these, unrelated to
the import: **`inventory.e2e-spec.ts` is not idempotent.** Its concurrency
test consumes the seeded Goa stock of `SP-CAM` and asserts that stock is
greater than zero, so it passes on a freshly seeded database and fails on a
second consecutive run. CI seeds before testing so it is green there, but
running `pnpm --filter @podium/api test` twice locally without re-seeding
will fail on that one test. It should create its own stock rather than
depending on the fixture's.

## 0.1 Audit — 2026-09-11: what was checked, what was found, what was fixed

A full re-audit was run against the live app (not read from memory): schema
vs. a live `pg_tables` query, RBAC tested with real requests across all 10
roles (creating temporary test accounts for Employee/Client/Vendor, since
**no seeded demo user exists for those three roles** — a real, still-open
gap; see §3.9 below), the flow engine driven through start/complete/
reassign/AND-join with `flow_step_runs` checked row-by-row in the database,
a real invoice issued for both the intra- and inter-state GST cases plus a
credit note, and a real 15-way concurrent inventory write.

**Two genuine production bugs were found and fixed, each backed by a new
permanent regression test** (`apps/api/test/*.e2e-spec.ts`, not just this
session's scratch scripts):

1. **`GET /inventory/balances` 500'd for every non-ALL-scope caller.**
   `InventoryService.listBalances` nested the city-scope filter as
   `location: { city: { cityId: {...} } }` — but `City`'s own key is `id`,
   not `cityId`; that shape is only valid one level up, directly on
   `location`. Every inventory test in the original suite happened to run
   as an ALL-scope Admin/Founder user, so this never 500'd until the audit
   specifically logged in as a Jaipur-scoped Operations user. Fixed by
   applying the scope filter to `location` directly.
2. **`reassignStep` could hand a flow step to an owner with no city access
   to that project**, leaving it permanently unreachable to them (every
   other flow-step endpoint would then 403 them on it; only a
   `flows:edit` manager-override could ever move it again). Found by
   reassigning a step on a Udaipur project to a Jaipur-only Operations
   user and watching them get rejected from completing their own assigned
   step. Fixed by validating the new owner's `user_city_access` before
   allowing the reassignment.

**One data-integrity gap was found in the seed script itself** (not the
runtime code, which was already correct): initial stock quantities were
written directly to `inventory_balances` with no backing
`inventory_movements` row, and four "historical" demo movements were
inserted into the ledger without ever updating the balance they implied —
so `SUM(inventory_movements)` did not reconstruct the recorded balance for
seeded data, even though it did for anything created through the API at
runtime. Fixed: opening stock is now a real `RECEIVE` movement per
SKU/location, and every seed movement updates the balance it implies.
Verified after the fix: **all 120 balance rows reconcile exactly against
`SUM(inventory_movements)`, zero mismatches** (checked with a direct SQL
query, not application code, so the app's own bugs couldn't hide the
check).

**Confirmed NOT implemented, by direct code search, not inference**: no
file in `apps/api/src` or `apps/web` references any Google/Gmail API
(`grep` for `googleapis|gmail.readonly|oauth2` returns only false positives
from the Google Fonts CSS URL and Next.js build cache — zero real hits); no
file references `AutomationRule` outside the seed script, and no
`AutomationModule` is registered in `app.module.ts` at all, not even a
read-only one; `workers/src` is an empty directory; `BLOCKED` and
`ESCALATED` exist only as enum values in `schema.prisma`, never written by
any code path. All of this matches what §1's phase table already said
before this audit — confirmed accurate, not previously overstated.

Full pass/fail counts and the exact commands run are in §3 below.

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
  prototype's own model implies. **2026-09-11 audit fix**: `reassignStep`
  now validates the new owner has `user_city_access` to the project's city
  before allowing the reassignment — previously it didn't, and a step could
  be reassigned into a state where its own listed owner would get a 403
  from every flow-step endpoint (see §0.1).
- ✅ **SLA escalation — built 2026-09-11, the audit's own recommended next
  priority.** `FlowSlaService` runs a `@Cron(EVERY_MINUTE)` sweep (inside
  the API process, not a separate BullMQ worker — see the class's own doc
  comment for why that's a deliberate, documented shortcut, not an
  oversight) that finds every `READY`/`ACTIVE` step whose
  `readyAt + slaMinutes` has passed, transitions it to `ESCALATED`, writes
  the `flow_step_runs` row (actor = null, system-initiated), raises a
  `HIGH`-severity project risk, notifies the project's PM (the schema has
  no formal reporting hierarchy to notify "the owner's manager" the way
  the blueprint's prose describes, so the PM is the documented stand-in),
  posts a "Podium Bot" message to the project channel, and writes an
  `audit_logs` row. A `POST /flows/sla-check` endpoint (Founder/Admin only,
  gated on `automation:edit`) triggers the identical sweep on demand.
  Verified two ways: (1) 4 new e2e tests drive the manual endpoint and
  check every side effect above directly against the database; (2) the
  *actual* one-minute cron was watched firing on its own, with zero HTTP
  calls involved, correctly escalating a step that had been backdated past
  its SLA — confirmed both in the server's own log output and by querying
  Postgres afterward. Building this also surfaced a real seed-data bug:
  the demo G&T flow's "in-progress" step was seeded already 16 minutes
  past its own 10-minute SLA, so it auto-escalated the instant this
  feature could see it — fixed by re-timing that step's seed data to sit
  within its SLA, which is itself a small case study in why "the schema
  and seed data imply X is live" is not the same claim as "X is live."
  - **Not built**: OR-join (schema has `join_type` on `flow_step_dependencies`
    but only `AND` is ever written or evaluated), automatic reassignment on
    approved leave. The generalized automation engine (`au1`-`au10`, Phase
    11) is a separate, larger, still-entirely-unbuilt thing from this —
    see that phase's own section below; this SLA mechanism is specific to
    the flow engine, per blueprint §6, not a first instance of the general
    rule runtime.
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
  transaction, never written directly by the runtime code. Verified under
  real concurrency, twice, in two sessions: 5-way and 15-way concurrent
  `CONSUME` bursts against known stock levels both produced exactly the
  right number of successes/rejections and never a negative balance.
  **2026-09-11 audit correction**: the *seed script* (not the runtime code)
  had been writing opening stock directly into `inventory_balances` with no
  backing ledger row, and inserting four "historical" demo movements
  without ever applying them to the balance — so the "balance = derived
  from the ledger" invariant held for the API's own write path but not for
  the fixture data itself. Fixed; a direct SQL reconciliation now confirms
  all 120 seeded balance rows equal `SUM(inventory_movements)` exactly.
- ⬜ **Employee, Client, and Vendor roles have no seeded demo users at
  all** — only Founder, Admin, Project Manager (x2), Operations (x9),
  Finance, Sales, and Creative are represented among the 15 seeded `users`
  rows. This was surfaced by the 2026-09-11 RBAC audit, which had to create
  three temporary throwaway accounts to test those roles at all. Worth
  adding real seeded users for all 10 roles before the next round of manual
  testing or a demo — right now anyone poking at the seed data would
  reasonably assume those roles were never wired up, when actually their
  permission grants are correct and were verified working via the
  temporary accounts.
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

- **23 Jest e2e tests** (`apps/api/test/*.e2e-spec.ts`) run against a real
  NestJS app instance + local Postgres, not mocks: RBAC enforcement and city
  scoping, the flow engine's AND-join end to end (including "the join must
  NOT fire on the first of two dependencies"), GST split correctness for
  both intra- and inter-state invoices, sequential invoice numbering,
  invoice immutability (`409` on a second `issue` call), inventory ledger
  concurrency safety, regression tests for the two RBAC/flow-reassignment
  bugs described in §0.1, and 4 tests for SLA escalation (breach → full
  side-effect chain, idempotency, a non-breach left untouched, and the
  `automation:edit` RBAC gate on the manual trigger).
- **The 2026-09-11 audit's own ad hoc scripts** (not committed — they lived
  in the session's scratch directory) drove real requests against a running
  server for things the committed suite doesn't cover as exhaustively: all
  10 RBAC roles individually (including temporary Employee/Client/Vendor
  test accounts, since none are seeded), a 15-way concurrent inventory
  write against a real 10-unit balance (10 succeeded, 5 correctly
  rejected, final balance exactly 0), and a direct SQL reconciliation of
  all 120 `inventory_balances` rows against `SUM(inventory_movements)`
  (0 mismatches after the seed fix). These aren't in git; treat this
  paragraph as the record of that having happened, and re-run the
  equivalent checks yourself if you need to reconfirm rather than trusting
  this sentence indefinitely.
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
2. **The generalized automation engine runtime** (`au1`-`au10`, a real rule
   evaluator reading `automation_rules.trigger_config`/`actions` jsonb) —
   flow-engine SLA escalation (§1 Phase 3) is now built as a one-off,
   flow-specific cron per blueprint §6, which closes that particular gap
   but does *not* generalize to the other seeded rules. Licence T-7
   escalation, invoice-overdue detection, and low-stock → purchase-request
   are still each independently unbuilt and would each need either their
   own one-off cron (fast, inconsistent with the blueprint's "generalized
   rule engine" vision) or the real automation engine (slower, the
   architecturally correct answer). Worth deciding which path deliberately
   rather than accreting more one-off crons by default.
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
