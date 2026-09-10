import { Global, Module } from "@nestjs/common";
import { CityScopeService } from "./city-scope/city-scope.service";

@Global()
@Module({
  providers: [CityScopeService],
  exports: [CityScopeService],
})
export class CommonModule {}
