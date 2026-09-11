import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateClientInput, UpdateClientInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export interface ListClientsOptions {
  cityId?: string;
  segment?: "EVENT_CLIENT" | "RETAIL_CUSTOMER";
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  /**
   * Defaults to the EVENT_CLIENT segment. The Cocktail Shop retail dump is
   * ~100x larger than the real B2B client list, so an unfiltered list would
   * bury it — the caller must ask for RETAIL_CUSTOMER explicitly. Results are
   * paged because either segment is far too large to ship whole.
   */
  async list(user: RequestUser, opts: ListClientsOptions = {}) {
    const scope = this.cityScope.scopeFilter(user, opts.cityId);
    const take = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const where = {
      workspaceId: user.workspaceId,
      deletedAt: null,
      segment: opts.segment ?? ("EVENT_CLIENT" as const),
      ...(opts.search ? { name: { contains: opts.search, mode: "insensitive" as const } } : {}),
      ...scope,
    };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.client.count({ where }),
      this.prisma.client.client.findMany({
        where,
        include: { city: true, contacts: true },
        orderBy: { name: "asc" },
        take,
        skip: opts.offset ?? 0,
      }),
    ]);
    return { total, limit: take, offset: opts.offset ?? 0, rows };
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
