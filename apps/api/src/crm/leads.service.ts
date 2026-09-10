import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ConvertLeadInput, CreateLeadInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  list(user: RequestUser, cityId?: string) {
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.lead.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...scope },
      orderBy: { createdAt: "desc" },
    });
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
    return this.prisma.client.lead.update({ where: { id: lead.id }, data: { stage, updatedById: user.id } });
  }

  /**
   * Automation au1, "Deal Won -> Project Auto-Creation" (blueprint §5A):
   * marks the lead Won, creates (or reuses) the client, creates the project,
   * and creates its chat channel — atomically, so a failure partway through
   * never leaves a Won lead with no project. Task/flow generation "from
   * playbook defaults" is left to Phase 3's flow/task modules to wire once
   * a template is chosen; this endpoint sets up the project shell those
   * hang off.
   */
  async convert(user: RequestUser, id: string, input: ConvertLeadInput) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!lead) throw new NotFoundException("Lead not found.");
    this.cityScope.assertCanAccessCity(user, lead.cityId);
    if (!input.clientId && !input.clientName) {
      throw new BadRequestException("Provide clientId (existing) or clientName (to create one).");
    }

    return this.prisma.client.$transaction(async (tx) => {
      const client = input.clientId
        ? await tx.client.findUniqueOrThrow({ where: { id: input.clientId } })
        : await tx.client.create({
            data: {
              workspaceId: user.workspaceId,
              name: input.clientName!,
              type: input.clientType ?? "INDIVIDUAL",
              cityId: lead.cityId,
              ltv: lead.value,
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
          cityId: lead.cityId,
          eventDate: input.eventDate,
          pmId: input.pmId,
          status: "PLANNING",
          revenue: lead.value,
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
  }
}
