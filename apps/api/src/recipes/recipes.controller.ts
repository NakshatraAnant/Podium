import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { createRecipeSchema, updateRecipeSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { RecipesService } from "./recipes.service";

@Controller("recipes")
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequirePermissions("recipes:view")
  list(@CurrentUser() user: RequestUser) {
    return this.recipes.list(user);
  }

  @Get(":id")
  @RequirePermissions("recipes:view")
  get(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.recipes.get(user, id);
  }

  @Post()
  @RequirePermissions("recipes:create")
  @Audit("recipe", "recipe.create")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createRecipeSchema)) body: ReturnType<typeof createRecipeSchema.parse>,
  ) {
    return this.recipes.create(user, body);
  }

  @Patch(":id")
  @RequirePermissions("recipes:edit")
  @Audit("recipe", "recipe.update")
  update(
    @CurrentUser() user: RequestUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRecipeSchema)) body: ReturnType<typeof updateRecipeSchema.parse>,
  ) {
    return this.recipes.update(user, id, body);
  }

  @Delete(":id")
  @RequirePermissions("recipes:delete")
  @Audit("recipe", "recipe.delete")
  remove(@CurrentUser() user: RequestUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.recipes.remove(user, id);
  }
}
