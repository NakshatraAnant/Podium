import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import type { RequestUser } from "../common/types";
import { BudgetsService } from "../finance/budgets.service";
import { ReportsService, type Scope } from "./reports.service";

/**
 * Actuals and Forecast are separate routes returning separately-`kind`ed
 * objects on purpose (blueprint §18): there is no endpoint that returns a
 * figure blending the two, so no screen can accidentally display one.
 */
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
  ) {}

  @Get("pnl")
  @RequirePermissions("projects:view")
  pnl(
    @CurrentUser() user: RequestUser,
    @Query("scope") scope: Scope = "company",
    @Query("cityId") cityId?: string,
    @Query("projectId") projectId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.reports.pnl(user, { scope, cityId, projectId, from, to });
  }

  @Get("pnl/by-city")
  @RequirePermissions("projects:view")
  byCity(@CurrentUser() user: RequestUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.pnlByCity(user, from, to);
  }

  @Get("cash-flow")
  @RequirePermissions("projects:view")
  cashFlow(
    @CurrentUser() user: RequestUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("cityId") cityId?: string,
  ) {
    return this.reports.cashFlow(user, from, to, cityId);
  }

  /**
   * Budget vs. actual for one project (Phase B). Lives under /reports as
   * well as /budgets/variance because this is the figure the P&L screen
   * shows alongside revenue — same service method, so the two can never
   * disagree. Planned is a plan; every actual is a committed transaction.
   */
  @Get("budget-variance")
  @RequirePermissions("budgets:view")
  budgetVariance(@CurrentUser() user: RequestUser, @Query("projectId") projectId: string) {
    return this.budgets.variance(user, projectId);
  }

  /** Clearly and separately labelled — see ReportsService.forecast. */
  @Get("forecast")
  @RequirePermissions("projects:view")
  forecast(
    @CurrentUser() user: RequestUser,
    @Query("cityId") cityId?: string,
    @Query("months") months?: string,
    @Query("baseline") baseline?: string,
  ) {
    return this.reports.forecast(user, {
      cityId,
      months: months ? Number(months) : undefined,
      baseline: baseline ? Number(baseline) : undefined,
    });
  }
}
