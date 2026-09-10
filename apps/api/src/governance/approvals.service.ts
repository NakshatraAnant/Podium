import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateApprovalInput, DecideApprovalInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  async list(user: RequestUser, projectId?: string) {
    const scope = this.cityScope.scopeFilter(user);
    return this.prisma.client.approval.findMany({
      where: { deletedAt: null, ...(projectId ? { projectId } : {}), project: { workspaceId: user.workspaceId, ...scope } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(user: RequestUser, input: CreateApprovalInput) {
    const project = await this.prisma.client.project.findFirst({ where: { id: input.projectId, workspaceId: user.workspaceId } });
    if (!project) throw new NotFoundException("Project not found.");
    this.cityScope.assertCanAccessCity(user, project.cityId);
    return this.prisma.client.approval.create({ data: { ...input, requesterId: user.id, status: "PENDING" } });
  }

  async decide(user: RequestUser, id: string, input: DecideApprovalInput) {
    const approval = await this.prisma.client.approval.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
    if (!approval || approval.project.workspaceId !== user.workspaceId) throw new NotFoundException("Approval not found.");
    this.cityScope.assertCanAccessCity(user, approval.project.cityId);
    return this.prisma.client.approval.update({
      where: { id: approval.id },
      data: { status: input.decision, decisionReason: input.reason, decidedAt: new Date() },
    });
  }
}
