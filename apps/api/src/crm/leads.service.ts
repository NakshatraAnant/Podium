import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ConvertLeadInput, CreateLeadInput, PlaybookTaskInput } from "@podium/shared-types";
import { AutomationService } from "../automation/automation.service";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";
import { FlowsService } from "../flows/flows.service";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export interface ListLeadsOptions {
  cityId?: string;
  kind?: "PIPELINE" | "COLD_PROSPECT";
  stage?: "LEAD" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
  sourceSheet?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
    private readonly automation: AutomationService,
    private readonly flows: FlowsService,
  ) {}

  /**
   * Defaults to the PIPELINE kind — the CRM board is about the ~200 real,
   * human-worked opportunities, not the thousands of cold prospecting rows.
   * Cold lists are reachable with `kind=COLD_PROSPECT`, paged.
   */
  async list(user: RequestUser, opts: ListLeadsOptions = {}) {
    const scope = this.cityScope.scopeFilter(user, opts.cityId);
    const take = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where = {
      workspaceId: user.workspaceId,
      deletedAt: null,
      kind: opts.kind ?? ("PIPELINE" as const),
      ...(opts.stage ? { stage: opts.stage } : {}),
      ...(opts.sourceSheet ? { sourceSheet: opts.sourceSheet } : {}),
      ...(opts.search ? { name: { contains: opts.search, mode: "insensitive" as const } } : {}),
      ...scope,
    };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.lead.count({ where }),
      this.prisma.client.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip: opts.offset ?? 0,
      }),
    ]);
    return { total, limit: take, offset: opts.offset ?? 0, rows };
  }

  async create(user: RequestUser, input: CreateLeadInput) {
    this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.lead.create({
      data: { ...input, stage: "LEAD", workspaceId: user.workspaceId, createdById: user.id, updatedById: user.id },
    });
  }

  async updateStage(user: RequestUser, id: string, stage: "LEAD" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST") {
    const lead = await this.prisma.client.lead.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found.");
    this.cityScope.assertCanAccessCity(user, lead.cityId);
    if (stage === "WON") {
      throw new BadRequestException("Use POST /leads/:id/convert to move a lead to Won — it needs project details automation au1 can't infer.");
    }
    const updated = await this.prisma.client.lead.update({ where: { id: lead.id }, data: { stage, updatedById: user.id } });

    // Fire the event triggers inline, after the write has committed, so an
    // automation failure can never roll back the stage change that caused it.
    await this.automation.emit({
      trigger: `lead.stage_changed:${stage}`,
      workspaceId: user.workspaceId,
      entityId: lead.id,
      entityType: "lead",
    });
    return updated;
  }

  /**
   * Automation au1, "Deal Won -> Project Auto-Creation" (blueprint §5A):
   * marks the lead Won, creates (or reuses) the client, creates the project,
   * and creates its chat channel — atomically, so a failure partway through
   * never leaves a Won lead with no project. If a playbook was chosen,
   * Phase E applies its defaults (tasks + flow instances) as a follow-up
   * step after this transaction commits — same "never roll back the write
   * that already succeeded" convention as updateStage()'s automation.emit()
   * below: a playbook-application failure surfaces to the caller as an
   * error, but the project/client/channel it should have decorated already
   * exists and is usable.
   */
  async convert(user: RequestUser, id: string, input: ConvertLeadInput) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found.");
    this.cityScope.assertCanAccessCity(user, lead.cityId);
    if (!input.clientId && !input.clientName) {
      throw new BadRequestException("Provide clientId (existing) or clientName (to create one).");
    }

    // Imported leads often have no city and no value (the source sheets had
    // free-text locations and no quoted amount). A project needs both, so the
    // converting user supplies what's missing rather than the system guessing.
    const cityId = lead.cityId ?? input.cityId ?? null;
    if (!cityId) {
      throw new BadRequestException("This lead has no city assigned — pass cityId to say which city the project belongs to.");
    }
    this.cityScope.assertCanAccessCity(user, cityId);
    const value = lead.value ?? (input.value !== undefined ? input.value : null);
    if (value === null) {
      throw new BadRequestException("This lead has no estimated value — pass value to set the project's revenue.");
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const client = input.clientId
        ? await tx.client.findUniqueOrThrow({ where: { id: input.clientId } })
        : await tx.client.create({
            data: {
              workspaceId: user.workspaceId,
              name: input.clientName!,
              type: input.clientType ?? "INDIVIDUAL",
              cityId,
              ltv: value,
              since: new Date(),
              createdById: user.id,
              updatedById: user.id,
            },
          });

      const project = await tx.project.create({
        data: {
          workspaceId: user.workspaceId,
          name: input.projectName,
          clientId: client.id,
          playbookId: input.playbookId,
          type: input.projectType,
          cityId,
          eventDate: input.eventDate,
          pmId: input.pmId,
          status: "PLANNING",
          revenue: value,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const slug = input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await tx.channel.create({ data: { workspaceId: user.workspaceId, name: slug, kind: "PROJECT", projectId: project.id } });

      const wonLead = await tx.lead.update({
        where: { id: lead.id },
        data: { stage: "WON", convertedClientId: client.id, convertedProjectId: project.id, updatedById: user.id },
      });

      await tx.notification.create({
        data: {
          workspaceId: user.workspaceId,
          userId: input.pmId,
          icon: "◧",
          text: `New project from Won deal: ${input.projectName}`,
          sourceType: "project",
          sourceId: project.id,
        },
      });

      return { lead: wonLead, client, project };
    });

    if (result.project.playbookId) {
      await this.applyPlaybookDefaults(user, result.project.id, result.project.playbookId, result.project.eventDate, input.pmId);
    }
    return result;
  }

  /**
   * OPEN DECISION, defaulted conservatively — needs Anant's confirmation:
   * every task and every flow step this creates is owned by the project's
   * PM, never split by role. The playbook's defaultTasks have no per-task
   * owner field, and a brand-new project has no crew roster yet beyond the
   * PM to route anything else to — the PM reassigning tasks/steps afterward
   * (already-supported, existing functionality) is the fallback. Revisit if
   * a real playbook wants role-based routing at creation time.
   */
  private async applyPlaybookDefaults(user: RequestUser, projectId: string, playbookId: string, eventDate: Date, pmId: string) {
    const playbook = await this.prisma.client.playbook.findFirst({
      where: { id: playbookId, workspaceId: user.workspaceId, deletedAt: null },
    });
    if (!playbook) return; // chosen playbook was deleted between the request and now — the project itself still stands

    const tasks = playbook.defaultTasks as unknown as PlaybookTaskInput[];
    for (const t of tasks) {
      const dueAt = t.dueOffsetDays !== undefined ? new Date(eventDate.getTime() - t.dueOffsetDays * 86400000) : null;
      await this.prisma.client.task.create({
        data: {
          projectId, name: t.name, ownerId: pmId, dueAt, status: "BACKLOG", priority: "MEDIUM",
          createdById: user.id, updatedById: user.id,
        },
      });
    }

    for (const templateId of playbook.defaultFlowTemplateIds) {
      const template = await this.prisma.client.flowTemplate.findFirst({
        where: { id: templateId, workspaceId: user.workspaceId, deletedAt: null },
      });
      if (!template) continue; // referenced template was deleted since — skip rather than fail the whole conversion
      const steps = template.steps as unknown as Array<{ k: string }>;
      const ownerOverrides = Object.fromEntries(steps.map((s) => [s.k, pmId]));
      await this.flows.instantiate(user, { templateId, projectId, ownerOverrides });
    }
  }

  /**
   * Marks a lead Won without the manual conversion flow — the path the
   * automation engine's Deal-Won rule reacts to. Kept separate from
   * `updateStage`, which refuses WON precisely because a human conversion
   * needs project details.
   */
  async markWon(user: RequestUser, id: string) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found.");
    this.cityScope.assertCanAccessCity(user, lead.cityId);
    const updated = await this.prisma.client.lead.update({ where: { id: lead.id }, data: { stage: "WON", updatedById: user.id } });
    const results = await this.automation.emit({
      trigger: "lead.stage_changed:Won",
      workspaceId: user.workspaceId,
      entityId: lead.id,
      entityType: "lead",
    });
    return { lead: updated, automation: results };
  }
}
