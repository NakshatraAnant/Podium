import { Module } from "@nestjs/common";
import { AutomationModule } from "../automation/automation.module";
import { FlowsModule } from "../flows/flows.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";

@Module({
  imports: [AutomationModule, FlowsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class CrmModule {}
