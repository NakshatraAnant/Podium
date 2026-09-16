import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProjectInput, UpdateProjectInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { PrismaService } from "../common/prisma/prisma.service";
import { SAFE_USER_INCLUDE, SAFE_USER_SELECT } from "../common/safe-user";
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
      include: { client: true, city: true, pm: { select: SAFE_USER_SELECT } },
      orderBy: { eventDate: "asc" },
    });
  }

  async get(user: RequestUser, id: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
      include: {
        client: true,
        city: true,
        pm: { select: SAFE_USER_SELECT },
        members: { include: { user: SAFE_USER_INCLUDE } },
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
   * Archive a project. Soft delete only — the row, its tasks, its flow
   * instances and its invoices all stay, because a project is the spine every
   * other record hangs off and a hard delete would take them with it.
   */
  async archive(user: RequestUser, id: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
    });
    if (!project) throw new NotFoundException("Project not found.");
    this.cityScope.assertCanAccessCity(user, project.cityId);
    return this.prisma.client.project.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
  }

  /**
   * Un-archive a project — and the one place BUG-007's invariant can be met
   * from the other direction.
   *
   * The invariant is ONE LEAD CONVERSION -> AT MOST ONE LIVE INITIAL PROJECT.
   * Archiving a converted project frees its lead to be converted again, which
   * is deliberate: a project archived in error must not make the lead
   * permanently unconvertible. But that means a lead can end up with an
   * archived conversion AND a live one, and restoring the archived one would
   * put two live projects on a single conversion.
   *
   * The database refuses that outright — `projects_one_live_conversion_per_lead`
   * would raise a P2002. What a user must never see is that P2002. A raw
   * constraint error names an index, leaks the schema, and arrives as a 500
   * that reads like a bug in Podium rather than a decision they need to make.
   * So the conflict is detected here, first, and returned as a 409 naming the
   * project that currently holds the conversion and what to do about it.
   *
   * The `catch` after it is not redundant: two simultaneous restores both pass
   * the check and only the database can separate them. That path produces the
   * same 409, never a 500.
   */
  async restore(user: RequestUser, id: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: { not: null } },
    });
    if (!project) throw new NotFoundException("No archived project with that id.");
    this.cityScope.assertCanAccessCity(user, project.cityId);

    if (project.convertedFromLeadId) {
      const occupant = await this.prisma.client.project.findFirst({
        where: {
          convertedFromLeadId: project.convertedFromLeadId,
          deletedAt: null,
          workspaceId: user.workspaceId,
        },
        select: { id: true, name: true },
      });
      if (occupant) throw new ConflictException(this.conversionConflict(occupant));
    }

    try {
      return await this.prisma.client.project.update({
        where: { id },
        data: { deletedAt: null, updatedById: user.id },
      });
    } catch (err) {
      if (!isConversionUniqueViolation(err)) throw err;
      const occupant = await this.prisma.client.project.findFirst({
        where: { convertedFromLeadId: project.convertedFromLeadId, deletedAt: null },
        select: { id: true, name: true },
      });
      throw new ConflictException(this.conversionConflict(occupant));
    }
  }

  private conversionConflict(occupant: { id: string; name: string } | null) {
    return (
      "This project came from a lead conversion, and that lead has since been converted again. " +
      `Its live project is now ${occupant ? `"${occupant.name}" (${occupant.id})` : "another project"}. ` +
      "A conversion can only have one live project at a time — archive that one first if this is the project you want back, " +
      "or create this one as a new project of the same client instead. " +
      "(The client itself may hold as many projects as it likes; the limit is on the conversion, not the client.)"
    );
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

/**
 * A Prisma P2002 raised by the conversion index.
 *
 * Matched on the COLUMN, because that is what Prisma actually reports:
 * `meta.target` for this violation is `["converted_from_lead_id"]`, never the
 * index name. Matching on the name looked tidier and silently never matched —
 * the concurrent-restore test got a 500 rather than the 409 it was written to
 * prove, which is the entire failure this function exists to prevent.
 *
 * Narrow on purpose. Only a violation naming this exact column becomes a 409;
 * any other unique violation is a different bug and must keep its 500 rather
 * than be dressed up as a conversion conflict.
 */
const CONVERSION_UNIQUE_COLUMN = "converted_from_lead_id";

function isConversionUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.includes(CONVERSION_UNIQUE_COLUMN);
}
