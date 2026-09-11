import { Module, type OnModuleInit } from "@nestjs/common";
import { AutomationController } from "./automation.controller";
import { AutomationScheduler } from "./automation.scheduler";
import { AutomationService } from "./automation.service";
import { DealWonHandler, LicenceEscalationHandler, LowStockHandler } from "./handlers";

@Module({
  controllers: [AutomationController],
  providers: [AutomationService, AutomationScheduler, DealWonHandler, LowStockHandler, LicenceEscalationHandler],
  exports: [AutomationService],
})
export class AutomationModule implements OnModuleInit {
  constructor(
    private readonly automation: AutomationService,
    private readonly dealWon: DealWonHandler,
    private readonly lowStock: LowStockHandler,
    private readonly licence: LicenceEscalationHandler,
  ) {}

  /** Handlers are registered once at boot, keyed by the trigger they answer. */
  onModuleInit() {
    this.automation.register(this.dealWon);
    this.automation.register(this.lowStock);
    this.automation.register(this.licence);
  }
}
