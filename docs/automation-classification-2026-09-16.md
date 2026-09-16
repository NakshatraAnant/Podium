# Automation rules — classification before any disabling

**PHASE 0 §6.** The instruction was to *not* switch off the apparently dead
rules on the strength of them looking dead, and to determine for each one what
it is actually made of first. This is that determination.

**Nothing has been disabled. No rule's `is_enabled` was changed by this work.**

Regenerate the table below at any time — it is derived, not written by hand:

```
DATABASE_URL=...podium_prod pnpm classify:automation            # full detail
DATABASE_URL=...podium_prod pnpm classify:automation --markdown # this table
```

`scripts/classify-automation-rules.ts` reads four facts it can check rather
than four facts I can assert: whether any code path raises the trigger (a scan
of every `automation.emit({ trigger: ... })` site under `apps/api/src`),
whether a handler is **registered** at boot in `AutomationModule` (a handler
class that exists but is never registered is not wired), the rule's run
history, and `is_enabled`.

---

## The table

| Rule | Trigger | Enabled | Handler | Raised from | Runs | Classification |
| --- | --- | --- | --- | --- | --- | --- |
| Chat @mention → notification | `chat.mentioned` | yes | registered | `apps/api/src/chat/chat.service.ts:67` | 0 | **CONFIGURED_BUT_INACTIVE** |
| Client Approval Nudge | `approval.pending_hours:48` | no | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Deal Won → Project Auto-Creation | `lead.stage_changed:Won` | yes | registered | `apps/api/src/crm/leads.service.ts:89 (templated), :304` | 0 | **CONFIGURED_BUT_INACTIVE** |
| Event Day Countdown Triggers | `project.event_date_minus_days:30,7,1` | yes | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Invoice overdue → Gmail reminder | `invoice.overdue_days:7` | yes | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Licence not approved T-7 | `licence.due_date_minus_days:7` | yes | registered | `apps/api/src/automation/automation.scheduler.ts:62` | 0 | **CONFIGURED_BUT_INACTIVE** |
| Low stock → purchase request | `inventory_balance.available_lt_reorder_level` | yes | registered | `apps/api/src/automation/automation.scheduler.ts:85` | 0 | **CONFIGURED_BUT_INACTIVE** |
| Meet ends → action items to tasks | `meeting.ended` | no | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Step done → hand off to next person | `flow_step.completed` | yes | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Task Overdue Escalation | `task.overdue` | yes | none | **nowhere** | 0 | **DEMO_FIXTURE** |
| Vendor Payment Reminder | `purchase_order.due_in_days:3` | yes | none | **nowhere** | 0 | **DEMO_FIXTURE** |

4 CONFIGURED_BUT_INACTIVE, 7 DEMO_FIXTURE. **Zero WORKING, zero BROKEN, zero
DEAD.** Run history is identical in `podium_prod` and `podium_dev`: no
automation has ever executed in either.

---

## The finding the table does not show

**The process that would drive four of these rules is never started.**

`workers/src/main.ts` schedules `automation.tick` every ten minutes, and that
tick calls `AutomationScheduler.sweep()` — the only thing that can raise
`licence.due_date_minus_days:*` or
`inventory_balance.available_lt_reorder_level`. But nothing starts
`workers/`. It is absent from `scripts/dev-up.sh`, from
`.github/workflows/`, from `docker-compose.yml`, and from every other script
in the repository; `pnpm --filter @podium/workers start` exists and no caller
invokes it.

So two fully-wired, enabled, tested rules cannot fire in any environment we
have, and neither can the invoice-overdue sweep or the flow-SLA sweep that
share that process. Their run count of 0 is a consequence of that, not of
anything wrong with the rules. **This is a deployment gap, not a rule defect,
and it outweighs every individual rule finding on this page.**

Recorded as **DQ-008** in the Phase 0 Evidence Register.

---

## Per-rule determination

The twelve points asked for, per rule. "Permissions" is the same for all
eleven — `automation:view` to read rules and runs, `automation:edit` to toggle
a rule or force a sweep (`apps/api/src/automation/automation.controller.ts`),
verified by an RBAC test that asserts 403 for a role holding neither.

Retry, idempotency and audit are also engine-wide rather than per-rule, and
all three are real:

* **Idempotency** — every run is keyed `(ruleId, triggeredBy, triggerHash)`
  with a unique index behind it, and the key is claimed **before** the action
  runs, so two concurrent deliveries race on the insert instead of both
  proceeding. A settled run (SUCCESS or BLOCKED) is never re-run.
* **Retry** — `retryFailed()` re-runs FAILED runs on a 1s/5s/30s backoff to a
  maximum of four attempts, after which it stops and waits for a human.
* **Audit** — every run lands in `automation_runs` with its status and, for a
  BLOCKED run, the list of fields a human must supply. Toggling a rule is
  audited as `automation_rule.toggled`.

### CONFIGURED_BUT_INACTIVE — wired, enabled, never yet triggered

**Deal Won → Project Auto-Creation** (`lead.stage_changed:Won`)
Handler `DealWonHandler` is registered and tested: it creates the client's
project, channel, notification and audit row in one transaction, and returns
BLOCKED — naming the missing fields — rather than inventing an event date,
city, value or PM. Two things keep it from ever running on real data:

1. Of the two emit sites, `updateStage` (line 89) **cannot** raise `:Won` —
   it throws `BadRequestException` on WON several lines earlier, by design,
   because a human conversion needs project details the rule cannot infer.
   The only site that can is `markWon` (line 304).
2. Nothing in the web app calls `POST /leads/:id/mark-won`. The lead detail
   screen offers the manual conversion flow instead.

So in practice this rule's trigger is raised by nothing a user can reach.
Separately, since BUG-007, the handler now also checks for a live conversion
and returns `alreadyConverted` rather than building a second project — so even
if `markWon` were called after a manual conversion, it would correctly do
nothing.
**Recommendation: leave enabled.** It is correct and tested; it is waiting on
a decision about whether AMM wants a one-click Won that auto-builds the
project, which is a business-policy question, not an engineering one.

**Chat @mention → notification** (`chat.mentioned`)
Handler registered; raised inline by `ChatService` after a message commits.
Entity id is `${messageId}:${userId}`, so one message mentioning three people
is three independently idempotent runs rather than one collapsed slot. Zero
runs simply means no one has @-mentioned anyone in Podium yet — there are no
chat messages in `podium_prod`.
**Recommendation: leave enabled.** It will run the first time someone uses it.

**Licence not approved T-7** (`licence.due_date_minus_days:7`)
**Low stock → purchase request** (`inventory_balance.available_lt_reorder_level`)
Both handlers are registered and both are covered end-to-end by
`automation.e2e-spec.ts` driving a real sweep against real ledger and licence
rows. Both are blocked solely by the unstarted worker described above.
**Recommendation: leave enabled, and start the worker.** Note that low-stock
has nothing to detect today for a second reason: the only inventory balances
in the database are quarantined fixtures (PHASE 0 §1), so there is no verified
opening stock for a reorder level to be below.

### DEMO_FIXTURE — a row describing an intention, with no mechanism

Seven rules have no registered handler **and** no code path that raises their
trigger. They are configuration rows carried over from the prototype's
automation screen. Three deserve individual notes, because "no mechanism"
does not mean "the behaviour does not exist":

**Step done → hand off to next person** (`flow_step.completed`)
The described behaviour is **fully implemented** — just not through the
automation engine. `FlowsService.completeStep` unlocks steps whose
dependencies are now all met, notifies each new owner, and sends the Podium
Bot DM, inside the same transaction as the completion. Disabling this rule
would change nothing and would tell a reader on the automation screen that a
working feature is off.

**Invoice overdue → Gmail reminder** (`invoice.overdue_days:7`)
Partly implemented elsewhere: `InvoicesService.sweepOverdue` transitions
invoices to OVERDUE and notifies, from the worker's daily job. The Gmail draft
and the city-P&L flag named in this rule's actions do not exist.

**Task Overdue Escalation** (`task.overdue`)
Nothing implements it. The nearest thing is `ProjectsService`'s health
recompute, which *counts* overdue tasks to colour a project amber or red; it
does not notify the owner, the PM or the founder, and it does not raise a
Risk row.

The remaining four — Client Approval Nudge, Event Day Countdown Triggers, Meet
ends → action items, Vendor Payment Reminder — have no implementation anywhere
in the codebase, partial or otherwise.

**Recommendation: do not disable any of them yet, and do not delete them.**
Two reasons. Disabling `flow_step.completed` would misrepresent working
functionality. And `is_enabled` is the wrong instrument for the rest: a
disabled rule and an unimplemented one look identical on the automation
screen, so flipping the flag would hide the gap rather than record it. What
these rules need is a visible *status* of their own on that screen —
"configured, not yet built" — which is a small change to
`GET /automation/rules` and the page that renders it, and is proposed as
Phase 1 work rather than done here under a "classify, don't disable"
instruction.

Should AMM decide a rule is genuinely unwanted rather than unbuilt, the
disable path already audits: `PATCH /automation/rules/:id` writes an
`automation_rule.toggled` audit row naming the actor. The reason belongs in
that row, which means the toggle endpoint should carry an optional reason
field — also Phase 1.

---

## What would change these classifications

| Change | Effect |
| --- | --- |
| Start the `workers/` process | Licence T-7 and Low stock become exercisable; expect WORKING or BROKEN within one tick |
| Anyone @-mentions a colleague in Podium | Chat mention → WORKING |
| A UI path calls `POST /leads/:id/mark-won` | Deal Won becomes reachable |
| Implementing a handler + emit site for any DEMO_FIXTURE rule | That rule leaves DEMO_FIXTURE |

Re-run `pnpm classify:automation` after any of these. The classification is
derived, so it will move on its own.
