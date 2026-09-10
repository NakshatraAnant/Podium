import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { createMovementSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { InventoryService } from "./inventory.service";

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("balances")
  @RequirePermissions("inventory:view")
  balances(@CurrentUser() user: RequestUser, @Query("cityId") cityId?: string) {
    return this.inventory.listBalances(user, cityId);
  }

  /** All inventory mutation goes through this one endpoint, typed by `type` (blueprint §40). */
  @Post("movements")
  @RequirePermissions("inventory:edit")
  @Audit("inventory_movement", "inventory.movement")
  createMovement(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createMovementSchema)) body: ReturnType<typeof createMovementSchema.parse>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.inventory.createMovement(user, body, idempotencyKey);
  }
}
