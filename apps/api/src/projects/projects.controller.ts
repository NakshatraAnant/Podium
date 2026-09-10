import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createProjectSchema, updateProjectSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions("projects:view")
  list(@CurrentUser() user: RequestUser, @Query("cityId") cityId?: string) {
    return this.projects.list(user, cityId);
  }

  @Get(":id")
  @RequirePermissions("projects:view")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.projects.get(user, id);
  }

  @Post()
  @RequirePermissions("projects:create")
  @Audit("project", "project.create")
  create(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(createProjectSchema)) body: ReturnType<typeof createProjectSchema.parse>) {
    return this.projects.create(user, body);
  }

  @Patch(":id")
  @RequirePermissions("projects:edit")
  @Audit("project", "project.update")
  update(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(updateProjectSchema)) body: ReturnType<typeof updateProjectSchema.parse>) {
    return this.projects.update(user, id, body);
  }
}
