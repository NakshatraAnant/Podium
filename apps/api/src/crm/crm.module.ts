import { Module } from "@nestjs/common";
import { AutomationModule } from "../automation/automation.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";

@Module({
  imports: [AutomationModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class CrmModule {}
