import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProjectInput, UpdateProjectInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  list(user: RequestUser, cityId?: string) {
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.project.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...scope },
      include: { client: true, city: true, pm: true },
      orderBy: { eventDate: "asc" },
    });
  }

  async get(user: RequestUser, id: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
      include: {
        client: true,
        city: true,
        pm: true,
        members: { include: { user: true } },
        vendors: { include: { vendor: true } },
        tasks: true,
        risks: true,
        flowInstances: { include: { steps: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found.");
    this.cityScope.assertCanAccessCity(user, project.cityId);
    return project;
  }

  async create(user: RequestUser, input: CreateProjectInput) {
    this.cityScope.assertCanAccessCity(user, input.cityId);
    const project = await this.prisma.client.project.create({
      data: {
        workspaceId: user.workspaceId,
        name: input.name,
        clientId: input.clientId,
        playbookId: input.playbookId,
        type: input.type,
        cityId: input.cityId,
        eventDate: input.eventDate,
        pmId: input.pmId,
        revenue: input.revenue,
        estCost: input.estCost,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    // Auto-create the project's chat channel, mirroring the prototype's
    // CHANNELS auto-creation on project creation (blueprint §5A/§23).
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await this.prisma.client.channel.create({
      data: { workspaceId: user.workspaceId, name: slug, kind: "PROJECT", projectId: project.id },
    });
    return project;
  }

  async update(user: RequestUser, id: string, input: UpdateProjectInput) {
    const existing = await this.get(user, id);
    if (input.cityId) this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.project.update({
      where: { id: existing.id },
      data: { ...input, updatedById: user.id },
    });
  }

  /**
   * Recomputes `health` from overdue tasks, open critical risks, and
   * days-to-event (blueprint §19) — never client-set. Thresholds here are a
   * documented starting assumption (see docs/STATUS.md); tune once Ops has
   * real signal on what should flip a project amber/red.
   */
  async recomputeHealth(projectId: string): Promise<"GREEN" | "AMBER" | "RED"> {
    const [overdueTasks, openCriticalRisks, project] = await Promise.all([
      this.prisma.client.task.count({ where: { projectId, status: { not: "COMPLETED" }, dueAt: { lt: new Date() }, deletedAt: null } }),
      this.prisma.client.risk.count({ where: { projectId, severity: "CRITICAL", status: { in: ["OPEN", "MITIGATING"] }, deletedAt: null } }),
      this.prisma.client.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    const daysToEvent = Math.ceil((project.eventDate.getTime() - Date.now()) / 86_400_000);
    const budgetVarianceRatio = project.estCost.toNumber() > 0 ? project.actCost.toNumber() / project.estCost.toNumber() : 0;

    let health: "GREEN" | "AMBER" | "RED" = "GREEN";
    if (openCriticalRisks > 0 || (daysToEvent >= 0 && daysToEvent <= 3 && overdueTasks > 0) || budgetVarianceRatio > 1.15) {
      health = "RED";
    } else if (overdueTasks > 0 || budgetVarianceRatio > 1.0) {
      health = "AMBER";
    }
    await this.prisma.client.project.update({ where: { id: projectId }, data: { health } });
    return health;
  }
}
