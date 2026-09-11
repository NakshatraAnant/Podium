import { Controller, Get, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { RequestUser } from "../common/types";
import { AutomationScheduler } from "./automation.scheduler";
import { AutomationService } from "./automation.service";

@Controller("automation")
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly scheduler: AutomationScheduler,
  ) {}

  /** The run log — success, blocked and failed, with the reason. */
  @Get("runs")
  @RequirePermissions("automation:view")
  runs(@CurrentUser() user: RequestUser, @Query("limit") limit?: string) {
    return this.automation.runsFor(user.workspaceId, limit ? Number(limit) : undefined);
  }

  @Get("triggers")
  @RequirePermissions("automation:view")
  triggers() {
    return { registered: this.automation.registeredTriggers() };
  }

  /**
   * Runs the time/threshold sweep now. Same code path the cron uses, so a
   * manual run and a scheduled one cannot diverge.
   */
  @Post("sweep")
  @RequirePermissions("automation:edit")
  sweep(@CurrentUser() user: RequestUser) {
    return this.scheduler.sweepWorkspace(user.workspaceId);
  }
}
