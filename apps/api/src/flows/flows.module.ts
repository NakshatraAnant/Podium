import { Module } from "@nestjs/common";
import { FlowsController } from "./flows.controller";
import { FlowsService } from "./flows.service";

@Module({
  controllers: [FlowsController],
  providers: [FlowsService],
  exports: [FlowsService],
})
export class FlowsModule {}
