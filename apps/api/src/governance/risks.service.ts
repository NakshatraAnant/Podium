import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateRiskInput, UpdateRiskInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class RisksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  async list(user: RequestUser, projectId?: string) {
    const scope = this.cityScope.scopeFilter(user);
    return this.prisma.client.risk.findMany({
      where: { deletedAt: null, ...(projectId ? { projectId } : {}), project: { workspaceId: user.workspaceId, ...scope } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(user: RequestUser, input: CreateRiskInput) {
    const project = await this.prisma.client.project.findFirst({ where: { id: input.projectId, workspaceId: user.workspaceId } });
    if (!project) throw new NotFoundException("Project not found.");
    this.cityScope.assertCanAccessCity(user, project.cityId);
    return this.prisma.client.risk.create({ data: { ...input, status: "OPEN" } });
  }

  async update(user: RequestUser, id: string, input: UpdateRiskInput) {
    const risk = await this.prisma.client.risk.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
    if (!risk || risk.project.workspaceId !== user.workspaceId) throw new NotFoundException("Risk not found.");
    this.cityScope.assertCanAccessCity(user, risk.project.cityId);
    return this.prisma.client.risk.update({ where: { id: risk.id }, data: input });
  }
}
