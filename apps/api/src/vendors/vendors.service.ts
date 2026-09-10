import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateVendorInput, UpdateVendorInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
  ) {}

  list(user: RequestUser, cityId?: string) {
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.vendor.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...scope },
      orderBy: { name: "asc" },
    });
  }

  async get(user: RequestUser, id: string) {
    const vendor = await this.prisma.client.vendor.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
    if (!vendor) throw new NotFoundException("Vendor not found.");
    this.cityScope.assertCanAccessCity(user, vendor.cityId);
    return vendor;
  }

  async create(user: RequestUser, input: CreateVendorInput) {
    this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.vendor.create({ data: { ...input, workspaceId: user.workspaceId, createdById: user.id, updatedById: user.id } });
  }

  async update(user: RequestUser, id: string, input: UpdateVendorInput) {
    const existing = await this.get(user, id);
    if (input.cityId) this.cityScope.assertCanAccessCity(user, input.cityId);
    return this.prisma.client.vendor.update({ where: { id: existing.id }, data: { ...input, updatedById: user.id } });
  }
}
