import type { INestApplication } from "@nestjs/common";
import { prisma } from "@podium/db";
import request from "supertest";
import { bootstrapTestApp, loginAs } from "./support";

/**
 * SLA breach -> ESCALATED (blueprint §6). This was the single largest
 * "looks live, isn't" gap a 2026-09-11 production-readiness audit found:
 * `slaMinutes`, `readyAt`, and the `ESCALATED` enum value all existed and
 * were seeded, but nothing ever read them. FlowSlaService closes that gap
 * with a one-minute @Cron sweep; this test drives the same code path via
 * its manual-trigger endpoint (POST /flows/sla-check) so it doesn't have
 * to wait on real wall-clock time — the underlying method is identical to
 * what the cron calls, confirmed separately by watching the live cron
 * actually escalate a backdated step with no HTTP call involved at all
 * (see docs/STATUS.md §0.1).
 */
describe("Flow SLA escalation (e2e)", () => {
  let app: INestApplication;
  let founderToken: string;
  let founderId: string;
  let templateId: string;
  let projectId: string;
  let pmId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    founderToken = await loginAs(app, "anant.sharma@ammbrands.in");
    const founder = await prisma.user.findFirstOrThrow({ where: { email: "anant.sharma@ammbrands.in" } });
    founderId = founder.id;
    const template = await prisma.flowTemplate.findFirstOrThrow({ where: { name: "Signature serve — Gin & Tonic" } });
    templateId = template.id;
    const project = await prisma.project.findFirstOrThrow({ where: { name: { contains: "Rathi" } } });
    projectId = project.id;
    pmId = project.pmId;
  });

  afterAll(async () => {
    await app.close();
  });

  function post(path: string, body?: unknown) {
    return request(app.getHttpServer()).post(path).set("Authorization", `Bearer ${founderToken}`).send(body ?? {});
  }
  function get(path: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${founderToken}`);
  }

  it("escalates a step whose SLA has been breached: status, flow_step_runs, a raised risk, PM notification, and an audit_logs row", async () => {
    const instance = (await post("/api/flow-instances", {
      templateId,
      projectId,
      ownerOverrides: { a: founderId, b: founderId, c: founderId, d: founderId, e: founderId, f: founderId, g: founderId },
    })).body;
    const stepA = instance.steps.find((s: { key: string }) => s.key === "a");
    expect(stepA.status).toBe("READY");

    // Simulate time passing well past the step's SLA (15 minutes).
    await prisma.flowStep.update({ where: { id: stepA.id }, data: { readyAt: new Date(Date.now() - 60 * 60_000) } });

    const risksBefore = await prisma.risk.count({ where: { projectId } });
    const check = await post("/api/flows/sla-check");
    expect(check.status).toBe(201);
    expect(check.body.escalated).toBeGreaterThanOrEqual(1);

    const fresh = (await get(`/api/flow-instances/${instance.id}`)).body;
    expect(fresh.steps.find((s: { key: string }) => s.key === "a").status).toBe("ESCALATED");

    const run = await prisma.flowStepRun.findFirst({ where: { stepId: stepA.id, toStatus: "ESCALATED" } });
    expect(run).not.toBeNull();
    expect(run!.fromStatus).toBe("READY");
    expect(run!.actorId).toBeNull(); // system-initiated, not a human action

    const risksAfter = await prisma.risk.count({ where: { projectId } });
    expect(risksAfter).toBe(risksBefore + 1);

    const notified = await prisma.notification.findFirst({ where: { userId: pmId, sourceType: "flow_step", sourceId: stepA.id } });
    expect(notified).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { entityId: stepA.id, action: "flow_step.sla_escalated" } });
    expect(audit).not.toBeNull();
  });

  it("is idempotent — re-running the check does not re-escalate an already-ESCALATED step", async () => {
    const instance = (await post("/api/flow-instances", {
      templateId,
      projectId,
      ownerOverrides: { a: founderId, b: founderId, c: founderId, d: founderId, e: founderId, f: founderId, g: founderId },
    })).body;
    const stepA = instance.steps.find((s: { key: string }) => s.key === "a");
    await prisma.flowStep.update({ where: { id: stepA.id }, data: { readyAt: new Date(Date.now() - 60 * 60_000) } });

    await post("/api/flows/sla-check");
    const runsAfterFirst = await prisma.flowStepRun.count({ where: { stepId: stepA.id, toStatus: "ESCALATED" } });
    await post("/api/flows/sla-check");
    const runsAfterSecond = await prisma.flowStepRun.count({ where: { stepId: stepA.id, toStatus: "ESCALATED" } });

    expect(runsAfterFirst).toBe(1);
    expect(runsAfterSecond).toBe(1); // not 2 -- the second sweep must not touch an already-ESCALATED step
  });

  it("leaves a step that has NOT breached its SLA untouched", async () => {
    const instance = (await post("/api/flow-instances", {
      templateId,
      projectId,
      ownerOverrides: { a: founderId, b: founderId, c: founderId, d: founderId, e: founderId, f: founderId, g: founderId },
    })).body;
    // step a is READY but freshly created -- well within its 15-minute SLA
    await post("/api/flows/sla-check");
    const fresh = (await get(`/api/flow-instances/${instance.id}`)).body;
    expect(fresh.steps.find((s: { key: string }) => s.key === "a").status).toBe("READY");
  });

  it("rejects the manual trigger for a role without automation:edit (e.g. Sales)", async () => {
    const salesToken = await loginAs(app, "ananya.joshi@ammbrands.in");
    const res = await request(app.getHttpServer()).post("/api/flows/sla-check").set("Authorization", `Bearer ${salesToken}`).send({});
    expect(res.status).toBe(403);
  });
});
