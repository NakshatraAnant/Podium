import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateClientInput, UpdateClientInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  list(user: RequestUser, cityId?: string) {
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.client.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...scope },
      include: { city: true, contacts: true },
      orderBy: { name: "asc" },
    });
  }

  async get(user: RequestUser, id: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
      include: { city: true, contacts: true, projects: true },
    });
    if (!client) throw new NotFoundException("Client not found.");
    this.cityScope.assertCanAccessCity(user, client.cityId);
    return client;
  }

  async create(user: RequestUser, input: CreateClientInput) {
    this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.client.create({
      data: { ...input, workspaceId: user.workspaceId, createdById: user.id, updatedById: user.id },
    });
  }

  async update(user: RequestUser, id: string, input: UpdateClientInput) {
    const existing = await this.get(user, id);
    if (input.cityId) this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.client.update({
      where: { id: existing.id },
      data: { ...input, updatedById: user.id },
    });
  }
}
