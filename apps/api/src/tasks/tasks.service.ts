import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTaskInput, UpdateTaskInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  async list(user: RequestUser, projectId?: string) {
    if (projectId) {
      const project = await this.prisma.client.project.findFirst({ where: { id: projectId, workspaceId: user.workspaceId } });
      if (!project) throw new NotFoundException("Project not found.");
      this.cityScope.assertCanAccessCity(user, project.cityId);
      return this.prisma.client.task.findMany({ where: { projectId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    }
    const scope = this.cityScope.scopeFilter(user);
    return this.prisma.client.task.findMany({
      where: { deletedAt: null, project: { workspaceId: user.workspaceId, ...scope } },
      include: { project: { select: { id: true, name: true, cityId: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(user: RequestUser, input: CreateTaskInput) {
    const project = await this.prisma.client.project.findFirst({ where: { id: input.projectId, workspaceId: user.workspaceId } });
    if (!project) throw new NotFoundException("Project not found.");
    this.cityScope.assertCanAccessCity(user, project.cityId);
    return this.prisma.client.task.create({
      data: { ...input, status: "BACKLOG", createdById: user.id, updatedById: user.id },
    });
  }

  async update(user: RequestUser, id: string, input: UpdateTaskInput) {
    const task = await this.prisma.client.task.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
    if (!task || task.project.workspaceId !== user.workspaceId) throw new NotFoundException("Task not found.");
    this.cityScope.assertCanAccessCity(user, task.project.cityId);

    // Optimistic concurrency: kanban drag-and-drop from a stale client should
    // not silently clobber a status change made by someone else in between.
    if (input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== task.updatedAt.getTime()) {
      throw new ConflictException("This task changed since you last loaded it. Refresh and try again.");
    }
    const { expectedUpdatedAt: _ignored, ...rest } = input;
    return this.prisma.client.task.update({
      where: { id: task.id },
      data: { ...rest, updatedById: user.id },
    });
  }
}
