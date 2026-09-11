import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { ActionHandler, AutomationEvent, RunOutcome } from "./automation.types";

/**
 * Rule au1 — "Deal Won -> Project Auto-Creation".
 *
 * This is the rule that has to be careful. A Won lead is a real signal, but a
 * project needs a city, an event date, a PM and a value, and AMM's imported
 * leads overwhelmingly have none of them (see docs/STATUS.md §0.-1: of the 415
 * phone-cross-referenced Won leads, zero have an event date, a city or a
 * value).
 *
 * So this handler does NOT create a project from a lead that lacks them. It
 * records a BLOCKED run naming exactly which fields are missing, which turns
 * the gap into a countable work queue for Anant instead of a fabricated
 * project that looks real because it carries a real client's name.
 */
@Injectable()
export class DealWonHandler implements ActionHandler {
  readonly trigger = "lead.stage_changed:Won";
  constructor(private readonly prisma: PrismaService) {}

  matches(event: AutomationEvent): boolean {
    return event.entityType === "lead";
  }

  async run(event: AutomationEvent): Promise<RunOutcome> {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: event.entityId, deletedAt: null },
      include: { convertedClient: true },
    });
    if (!lead) return { status: "FAILED", error: "Lead no longer exists." };

    if (lead.convertedProjectId) {
      return { status: "SUCCESS", detail: { alreadyConverted: true, projectId: lead.convertedProjectId } };
    }

    // Every field a real project needs, checked against the real row.
    const missing: string[] = [];
    if (!lead.cityId) missing.push("cityId");
    if (!lead.eventDate) missing.push("eventDate");
    if (lead.value === null) missing.push("value");
    if (!lead.convertedClientId) missing.push("convertedClientId");

    // A PM is required too, and there is nothing in a lead to infer one from.
    const pm = lead.cityId
      ? await this.prisma.client.user.findFirst({
          where: {
            workspaceId: event.workspaceId, deletedAt: null,
            userRoles: { some: { role: { name: "Project Manager" } } },
            cityAccess: { some: { OR: [{ cityId: lead.cityId }, { scope: "ALL" }] } },
          },
          select: { id: true },
        })
      : null;
    if (!pm) missing.push("a Project Manager with access to the lead's city");

    if (missing.length > 0) {
      return {
        status: "BLOCKED",
        reason:
          "This lead is marked Won but does not carry the facts a real project needs. " +
          "No project was created — these must come from a human, not be inferred.",
        missing,
      };
    }

    // Everything is present and real: create the project atomically.
    const project = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId: event.workspaceId,
          name: `${lead.convertedClient!.name} — ${lead.eventType ?? "Event"}`,
          clientId: lead.convertedClientId!,
          type: lead.eventType ?? "Event",
          cityId: lead.cityId!,
          eventDate: lead.eventDate!,
          pmId: pm!.id,
          status: "PLANNING",
          revenue: lead.value!,
        },
      });
      await tx.lead.update({ where: { id: lead.id }, data: { convertedProjectId: created.id } });
      const slug = created.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await tx.channel.create({ data: { workspaceId: event.workspaceId, name: slug, kind: "PROJECT", projectId: created.id } });
      await tx.notification.create({
        data: {
          workspaceId: event.workspaceId, userId: pm!.id, icon: "◧",
          text: `New project auto-created from a Won deal: ${created.name}`,
          sourceType: "project", sourceId: created.id,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: event.workspaceId, actorId: null, action: "automation.project_created",
          entityType: "project", entityId: created.id, after: { leadId: lead.id, rule: "Deal Won -> Project Auto-Creation" },
        },
      });
      return created;
    });

    return { status: "SUCCESS", detail: { projectId: project.id, leadId: lead.id } };
  }
}

/**
 * Rule — "Low stock -> purchase request". Threshold-triggered from the real
 * inventory ledger: raises nothing itself beyond a notification to Procurement,
 * because auto-raising a purchase request against a real vendor commits real
 * money and should stay a human decision. The rule's job is to make sure the
 * shortfall is noticed.
 */
@Injectable()
export class LowStockHandler implements ActionHandler {
  readonly trigger = "inventory_balance.available_lt_reorder_level";
  constructor(private readonly prisma: PrismaService) {}

  matches(event: AutomationEvent): boolean {
    return event.entityType === "inventory_balance";
  }

  async run(event: AutomationEvent): Promise<RunOutcome> {
    const balance = await this.prisma.client.inventoryBalance.findUnique({
      where: { id: event.entityId },
      include: { item: true, location: { include: { city: true } } },
    });
    if (!balance) return { status: "FAILED", error: "Balance row no longer exists." };
    if (balance.qtyOnHand >= balance.reorderLevel) {
      return { status: "SUCCESS", detail: { restocked: true, qtyOnHand: balance.qtyOnHand } };
    }

    const recipients = await this.prisma.client.user.findMany({
      where: {
        workspaceId: event.workspaceId, deletedAt: null,
        userRoles: { some: { role: { name: { in: ["Operations", "Admin", "Founder"] } } } },
        cityAccess: { some: { OR: [{ cityId: balance.location.cityId }, { scope: "ALL" }] } },
      },
      select: { id: true },
      take: 10,
    });

    await this.prisma.client.$transaction(async (tx) => {
      for (const r of recipients) {
        await tx.notification.create({
          data: {
            workspaceId: event.workspaceId, userId: r.id, icon: "▤",
            text: `Low stock: ${balance.item.name} at ${balance.location.name} is ${balance.qtyOnHand}, below its reorder level of ${balance.reorderLevel}.`,
            sourceType: "inventory_balance", sourceId: balance.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          workspaceId: event.workspaceId, actorId: null, action: "automation.low_stock_flagged",
          entityType: "inventory_balance", entityId: balance.id,
          after: { sku: balance.item.sku, qtyOnHand: balance.qtyOnHand, reorderLevel: balance.reorderLevel, notified: recipients.length },
        },
      });
    });

    return { status: "SUCCESS", detail: { notified: recipients.length, sku: balance.item.sku, qtyOnHand: balance.qtyOnHand } };
  }
}

/**
 * Rule — "Licence not approved T-7". Uses the `escalation_offset_days` column
 * that already existed but nothing read: raises a real project risk and
 * notifies, rather than only flagging in a UI.
 */
@Injectable()
export class LicenceEscalationHandler implements ActionHandler {
  readonly trigger = "licence.due_date_minus_days:7";
  constructor(private readonly prisma: PrismaService) {}

  matches(event: AutomationEvent): boolean {
    return event.entityType === "licence";
  }

  async run(event: AutomationEvent): Promise<RunOutcome> {
    const licence = await this.prisma.client.licence.findFirst({
      where: { id: event.entityId, deletedAt: null },
      include: { project: true },
    });
    if (!licence) return { status: "FAILED", error: "Licence no longer exists." };
    if (licence.status === "APPROVED") {
      return { status: "SUCCESS", detail: { alreadyApproved: true } };
    }
    if (!licence.project) {
      return {
        status: "BLOCKED",
        reason: "This licence is not attached to a project, so there is nothing to raise a project risk against.",
        missing: ["projectId"],
      };
    }

    const project = licence.project;
    const risk = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.risk.create({
        data: {
          projectId: project.id,
          title: `Licence not approved with 7 days to go: ${licence.type}`,
          severity: "HIGH",
          ownerId: project.pmId,
          impact: `Licence is still ${licence.status} inside its escalation window.`,
          status: "OPEN",
        },
      });
      await tx.notification.create({
        data: {
          workspaceId: event.workspaceId, userId: project.pmId, icon: "§",
          text: `Licence "${licence.type}" for ${project.name} is still ${licence.status} at T-7.`,
          sourceType: "licence", sourceId: licence.id,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: event.workspaceId, actorId: null, action: "automation.licence_escalated",
          entityType: "licence", entityId: licence.id, after: { riskId: created.id, status: licence.status },
        },
      });
      return created;
    });

    return { status: "SUCCESS", detail: { riskId: risk.id, licenceStatus: licence.status } };
  }
}
