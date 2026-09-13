import { Injectable, Logger } from "@nestjs/common";
import type { FlowStepStatus } from "@podium/db";
import { PrismaService } from "../common/prisma/prisma.service";

/**
 * SLA breach → ESCALATED (blueprint §6): "a scheduled job checks
 * `now() > readyAt + sla` → marks ESCALATED, notifies the step owner's
 * manager, and raises a project risk." This was the single largest
 * "looks live, isn't" gap the 2026-09-11 audit found — `slaMinutes`,
 * `readyAt`, and the `ESCALATED` enum value all exist and are seeded, but
 * nothing ever read them until this service.
 *
 * There is no formal reporting hierarchy in the schema ("the role above
 * them in TEAM" per the blueprint's own phrasing assumes an org chart this
 * app doesn't model), so the notification target is the flow's project PM
 * — a concrete, always-present, reasonable stand-in — plus the project's
 * chat channel via the same "Podium Bot" pattern every other flow
 * notification uses. Documented here as a judgment call, not silently
 * decided.
 *
 * Phase H: moved off the API process's own one-minute cron and onto the
 * `workers/` BullMQ scheduler (see workers/src/main.ts's flow.sla-sweep
 * job) — running this in-process was only correct for exactly one API
 * instance; a second instance running the same cron would double-fire
 * (each escalation is individually idempotent, so double-firing wasted
 * work rather than corrupting anything, but it was never the intended
 * architecture). This method is unchanged and still directly callable —
 * by the worker, or by a test driving a sweep deterministically — only
 * the "when" moved.
 */
@Injectable()
export class FlowSlaService {
  private readonly logger = new Logger(FlowSlaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkSlaBreaches(): Promise<{ escalated: number }> {
    const now = new Date();

    // Only READY/ACTIVE steps with a readyAt can possibly be in breach.
    // Re-running this every minute is safe: once a step is ESCALATED it no
    // longer matches this WHERE clause, so it can never be escalated twice.
    const candidates = await this.prisma.client.flowStep.findMany({
      where: { status: { in: ["READY", "ACTIVE"] }, readyAt: { not: null }, deletedAt: null },
      include: { flowInstance: { include: { project: true } } },
    });

    const breached = candidates.filter((step) => {
      const deadline = new Date(step.readyAt!.getTime() + step.slaMinutes * 60_000);
      return now > deadline;
    });

    for (const step of breached) {
      try {
        await this.escalate(step.id, step.flowInstance.projectId, step.flowInstance.project.workspaceId, step.flowInstance.name, step.name, step.status);
      } catch (err) {
        // One bad row must never stop the rest of the batch from escalating.
        this.logger.error(`Failed to escalate flow step ${step.id}`, err instanceof Error ? err.stack : String(err));
      }
    }

    if (breached.length > 0) this.logger.warn(`Escalated ${breached.length} SLA-breached flow step(s)`);
    return { escalated: breached.length };
  }

  private async escalate(stepId: string, projectId: string, workspaceId: string, flowName: string, stepName: string, fromStatus: FlowStepStatus) {
    await this.prisma.client.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });

      await tx.flowStep.update({ where: { id: stepId }, data: { status: "ESCALATED" } });
      await tx.flowStepRun.create({ data: { stepId, fromStatus, toStatus: "ESCALATED", actorId: null } });

      const risk = await tx.risk.create({
        data: {
          projectId,
          title: `SLA breached: "${stepName}" in ${flowName}`,
          severity: "HIGH",
          ownerId: project.pmId,
          impact: "Flow handoff stalled past its target time — may delay downstream steps and the event timeline.",
          status: "OPEN",
        },
      });

      const text = `SLA breached: "${stepName}" in ${flowName} on ${project.name} has been escalated to you as PM.`;
      await tx.notification.create({ data: { workspaceId, userId: project.pmId, icon: "⚠", text, sourceType: "flow_step", sourceId: stepId } });

      const channel = await tx.channel.findFirst({ where: { projectId, kind: "PROJECT" } });
      if (channel) {
        await tx.message.create({ data: { channelId: channel.id, authorId: null, body: `🤖 ⚠ SLA breached: "${stepName}" in ${flowName} — escalated, risk raised, PM notified.` } });
      }

      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: null,
          action: "flow_step.sla_escalated",
          entityType: "flow_step",
          entityId: stepId,
          after: { status: "ESCALATED", raisedRiskId: risk.id },
        },
      });
    });
  }
}
