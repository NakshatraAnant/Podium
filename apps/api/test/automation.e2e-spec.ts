import type { INestApplication } from "@nestjs/common";
import { prisma } from "@podium/db";
import request from "supertest";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * Phase 11 (blueprint §12). Until now `automation_rules` was configuration
 * with nothing executing it — the largest "looks live, isn't" gap in the build.
 *
 * Three real rules are driven here by changing real data and watching what the
 * engine does, not by calling the handlers directly:
 *   1. Deal Won -> Project Auto-Creation  (event trigger)
 *   2. Low stock -> purchase request      (threshold trigger, via the sweep)
 *   3. Licence not approved T-7           (time-relative trigger, via the sweep)
 *
 * The Deal-Won assertions are the important ones: against a lead that lacks an
 * event date or a city — which is every real AMM lead — the rule must record a
 * BLOCKED run and create NOTHING.
 */
describe("Automation engine runtime (e2e)", () => {
  let app: INestApplication;
  let founder: string;
  let sales: string;
  let workspaceId: string;
  let cityId: string;
  let noPmCityId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    founder = await loginAs(app, "anant.sharma@ammbrands.in");
    sales = await loginAs(app, "ananya.joshi@ammbrands.in"); // Delhi, leads:edit
    workspaceId = (await prisma.workspace.findFirstOrThrow()).id;
    // Jaipur, because a project needs a PM with access to its city and the real
    // roster only staffs PMs in Jaipur and Udaipur (see the no-PM test below).
    cityId = (await prisma.city.findFirstOrThrow({ where: { code: "JPR" } })).id;
    noPmCityId = (await prisma.city.findFirstOrThrow({ where: { code: "DEL" } })).id;
    await prisma.automationRun.deleteMany({});
  });
  afterAll(async () => await app.close());

  const post = (p: string, t: string, b?: unknown) =>
    request(app.getHttpServer()).post(p).set("Authorization", `Bearer ${t}`).send(b ?? {});
  const get = (p: string, t: string) => request(app.getHttpServer()).get(p).set("Authorization", `Bearer ${t}`);

  it("registers handlers for the seeded triggers", async () => {
    const res = await get("/api/automation/triggers", founder);
    expect(res.status).toBe(200);
    expect(res.body.registered).toEqual(
      expect.arrayContaining([
        "lead.stage_changed:Won",
        "inventory_balance.available_lt_reorder_level",
        "licence.due_date_minus_days:7",
      ]),
    );
  });

  // ------------------------------------------------------- RULE 1: Deal Won
  it("RULE 1 — a Won lead missing real fields is BLOCKED, and no project is invented", async () => {
    const lead = await prisma.lead.create({
      data: {
        workspaceId, name: "Incomplete real-world lead", kind: "PIPELINE", stage: "PROPOSAL",
        cityId: null, eventDate: null, value: null, // exactly the shape of a real AMM lead
        sourceFile: "test", sourceSheet: "test",
      },
    });
    const projectsBefore = await prisma.project.count();

    const res = await post(`/api/leads/${lead.id}/mark-won`, founder);
    expect(res.status).toBe(201);

    const outcome = res.body.automation.find((r: { ruleName: string }) => r.ruleName.includes("Deal Won"));
    expect(outcome).toBeDefined();
    expect(outcome.outcome.status).toBe("BLOCKED");
    expect(outcome.outcome.missing).toEqual(expect.arrayContaining(["cityId", "eventDate", "value"]));

    // Nothing was created.
    expect(await prisma.project.count()).toBe(projectsBefore);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedProjectId).toBeNull();

    // The block is recorded as a real, countable run — not a silent skip.
    const run = await prisma.automationRun.findFirst({ where: { triggeredBy: lead.id } });
    expect(run?.status).toBe("BLOCKED");
    expect(run?.error).toMatch(/missing: .*eventDate/);
  });

  it("RULE 1 — a Won lead that genuinely has every field DOES create a real project", async () => {
    const client = await prisma.client.findFirstOrThrow({ where: { workspaceId } });
    const lead = await prisma.lead.create({
      data: {
        workspaceId, name: "Complete lead", kind: "PIPELINE", stage: "PROPOSAL",
        cityId, eventDate: new Date(Date.now() + 30 * 86_400_000), value: 250_000,
        convertedClientId: client.id, eventType: "Wedding", sourceFile: "test", sourceSheet: "test",
      },
    });

    const res = await post(`/api/leads/${lead.id}/mark-won`, founder);
    const outcome = res.body.automation.find((r: { ruleName: string }) => r.ruleName.includes("Deal Won"));
    expect(outcome.outcome.status).toBe("SUCCESS");

    const projectId = outcome.outcome.detail.projectId;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.cityId).toBe(cityId);
    expect(Number(project.revenue)).toBe(250_000);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedProjectId).toBe(projectId);

    // Side effects the rule promises: a channel, a PM notification, an audit row.
    expect(await prisma.channel.count({ where: { projectId } })).toBe(1);
    expect(await prisma.notification.count({ where: { sourceType: "project", sourceId: projectId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "automation.project_created", entityId: projectId } })).toBe(1);

    await prisma.automationRun.deleteMany({ where: { triggeredBy: lead.id } });
  });

  it("IDEMPOTENCY — replaying the same Won event does not create a second project", async () => {
    const client = await prisma.client.findFirstOrThrow({ where: { workspaceId } });
    const lead = await prisma.lead.create({
      data: {
        workspaceId, name: "Replay lead", kind: "PIPELINE", stage: "PROPOSAL",
        cityId, eventDate: new Date(Date.now() + 40 * 86_400_000), value: 100_000,
        convertedClientId: client.id, sourceFile: "test", sourceSheet: "test",
      },
    });

    await post(`/api/leads/${lead.id}/mark-won`, founder);
    const afterFirst = await prisma.project.count();
    // Replay the identical event three times.
    await post(`/api/leads/${lead.id}/mark-won`, founder);
    await post(`/api/leads/${lead.id}/mark-won`, founder);
    await post(`/api/leads/${lead.id}/mark-won`, founder);

    expect(await prisma.project.count()).toBe(afterFirst);
    const runs = await prisma.automationRun.findMany({ where: { triggeredBy: lead.id } });
    expect(runs.length).toBe(1); // one run row, not four
    expect(runs[0].status).toBe("SUCCESS");
  });

  /**
   * A genuinely useful block, found by running this suite: AMM's real roster
   * staffs Project Managers in Jaipur and Udaipur only. A Won lead in Delhi,
   * Mumbai, Bengaluru or Goa therefore has no PM to own the project — so the
   * rule blocks and names that, rather than assigning the project to whoever
   * happens to be first in the table.
   */
  it("RULE 1 — a complete lead in a city with no Project Manager is BLOCKED, naming that", async () => {
    const client = await prisma.client.findFirstOrThrow({ where: { workspaceId } });
    const lead = await prisma.lead.create({
      data: {
        workspaceId, name: "Complete but PM-less city", kind: "PIPELINE", stage: "PROPOSAL",
        cityId: noPmCityId, eventDate: new Date(Date.now() + 30 * 86_400_000), value: 100_000,
        convertedClientId: client.id, sourceFile: "test", sourceSheet: "test",
      },
    });
    const projectsBefore = await prisma.project.count();
    const res = await post(`/api/leads/${lead.id}/mark-won`, founder);
    const outcome = res.body.automation.find((r: { ruleName: string }) => r.ruleName.includes("Deal Won"));
    expect(outcome.outcome.status).toBe("BLOCKED");
    expect(outcome.outcome.missing.join(" ")).toMatch(/Project Manager/);
    expect(await prisma.project.count()).toBe(projectsBefore);
  });

  // ----------------------------------------------------- RULE 2: low stock
  it("RULE 2 — the sweep detects real low stock and notifies, from the real ledger", async () => {
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ include: { item: true } });
    // Make the shortfall real by raising the reorder level above what's on hand.
    await prisma.inventoryBalance.update({
      where: { id: balance.id },
      data: { reorderLevel: balance.qtyOnHand + 25 },
    });
    const notifsBefore = await prisma.notification.count({ where: { sourceType: "inventory_balance" } });

    const res = await post("/api/automation/sweep", founder);
    expect(res.status).toBe(201);
    expect(res.body.lowStock).toBeGreaterThanOrEqual(1);

    expect(await prisma.notification.count({ where: { sourceType: "inventory_balance" } })).toBeGreaterThan(notifsBefore);
    const run = await prisma.automationRun.findFirst({ where: { triggeredBy: balance.id } });
    expect(run?.status).toBe("SUCCESS");
    expect(await prisma.auditLog.count({ where: { action: "automation.low_stock_flagged", entityId: balance.id } })).toBe(1);
  });

  it("RULE 2 — a second sweep does not re-notify for the same balance", async () => {
    const before = await prisma.notification.count({ where: { sourceType: "inventory_balance" } });
    await post("/api/automation/sweep", founder);
    expect(await prisma.notification.count({ where: { sourceType: "inventory_balance" } })).toBe(before);
  });

  // ------------------------------------------------- RULE 3: licence T-7
  it("RULE 3 — a licence inside its escalation window raises a real risk and notifies the PM", async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { workspaceId, deletedAt: null } });
    const owner = await prisma.user.findFirstOrThrow({ where: { workspaceId } });
    const licence = await prisma.licence.create({
      data: {
        workspaceId, projectId: project.id, type: "Excise — event bar (test)", authority: "State Excise",
        cityId: project.cityId, status: "APPLIED", ownerId: owner.id,
        dueDate: new Date(Date.now() + 3 * 86_400_000), // inside a 7-day window
        escalationOffsetDays: 7,
      },
    });
    const risksBefore = await prisma.risk.count({ where: { projectId: project.id } });

    const res = await post("/api/automation/sweep", founder);
    expect(res.body.licences).toBeGreaterThanOrEqual(1);

    expect(await prisma.risk.count({ where: { projectId: project.id } })).toBe(risksBefore + 1);
    const run = await prisma.automationRun.findFirst({ where: { triggeredBy: licence.id } });
    expect(run?.status).toBe("SUCCESS");
    expect(await prisma.auditLog.count({ where: { action: "automation.licence_escalated", entityId: licence.id } })).toBe(1);

    const notification = await prisma.notification.findFirst({ where: { sourceType: "licence", sourceId: licence.id } });
    expect(notification).not.toBeNull();
  });

  it("RULE 3 — an already-approved licence is not escalated", async () => {
    const project = await prisma.project.findFirstOrThrow({ where: { workspaceId, deletedAt: null } });
    const owner = await prisma.user.findFirstOrThrow({ where: { workspaceId } });
    const approved = await prisma.licence.create({
      data: {
        workspaceId, projectId: project.id, type: "Already approved (test)", authority: "State Excise",
        cityId: project.cityId, status: "APPROVED", ownerId: owner.id,
        dueDate: new Date(Date.now() + 2 * 86_400_000), escalationOffsetDays: 7,
      },
    });
    await post("/api/automation/sweep", founder);
    // Not even considered: the sweep only looks at NOT_APPLIED/APPLIED.
    expect(await prisma.automationRun.count({ where: { triggeredBy: approved.id } })).toBe(0);
  });

  // ------------------------------------------------------------ run log
  it("the run log records success and blocked runs with their reasons", async () => {
    const res = await get("/api/automation/runs", founder);
    expect(res.status).toBe(200);
    const statuses = new Set(res.body.map((r: { status: string }) => r.status));
    expect(statuses.has("SUCCESS")).toBe(true);
    expect(statuses.has("BLOCKED")).toBe(true);
    const blocked = res.body.find((r: { status: string }) => r.status === "BLOCKED");
    expect(blocked.error).toMatch(/missing:/);
    expect(blocked.rule.name).toBeTruthy();
  });

  it("RBAC: a role without automation:edit cannot trigger a sweep, and without automation:view cannot read runs", async () => {
    expect((await post("/api/automation/sweep", sales)).status).toBe(403);
    expect((await get("/api/automation/runs", sales)).status).toBe(403);
  });

  it("a disabled rule never runs", async () => {
    const rule = await prisma.automationRule.findFirstOrThrow({ where: { name: { contains: "Deal Won" } } });
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isEnabled: false } });
    try {
      const lead = await prisma.lead.create({
        data: { workspaceId, name: "Disabled-rule lead", kind: "PIPELINE", stage: "PROPOSAL", sourceFile: "t", sourceSheet: "t" },
      });
      const res = await post(`/api/leads/${lead.id}/mark-won`, founder);
      expect(res.body.automation.length).toBe(0);
      expect(await prisma.automationRun.count({ where: { triggeredBy: lead.id } })).toBe(0);
    } finally {
      await prisma.automationRule.update({ where: { id: rule.id }, data: { isEnabled: true } });
    }
  });
});
