import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { CitiesModule } from "./cities/cities.module";
import { ClientsModule } from "./clients/clients.module";
import { CommonModule } from "./common/common.module";
import { CrmModule } from "./crm/crm.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { MustChangePasswordGuard } from "./common/guards/must-change-password.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";
import { MailModule } from "./common/mail/mail.module";
import { PrismaModule } from "./common/prisma/prisma.module";
import { FinanceModule } from "./finance/finance.module";
import { FlowsModule } from "./flows/flows.module";
import { GovernanceModule } from "./governance/governance.module";
import { InventoryModule } from "./inventory/inventory.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { GoogleModule } from "./google/google.module";
import { AutomationModule } from "./automation/automation.module";
import { DocumentsModule } from "./documents/documents.module";
import { EventDayModule } from "./eventday/eventday.module";
import { PlaybooksModule } from "./playbooks/playbooks.module";
import { ProcurementModule } from "./procurement/procurement.module";
import { RecipesModule } from "./recipes/recipes.module";
import { ReportsModule } from "./reports/reports.module";
import { ProjectsModule } from "./projects/projects.module";
import { TasksModule } from "./tasks/tasks.module";
import { UsersModule } from "./users/users.module";
import { VendorsModule } from "./vendors/vendors.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    PrismaModule,
    CommonModule,
    MailModule,
    AuthModule,
    ChatModule,
    UsersModule,
    CitiesModule,
    ClientsModule,
    CrmModule,
    AutomationModule,
    DocumentsModule,
    EventDayModule,
    GoogleModule,
    ProcurementModule,
    ProjectsModule,
    ReportsModule,
    TasksModule,
    FinanceModule,
    FlowsModule,
    GovernanceModule,
    InventoryModule,
    InvoicesModule,
    PlaybooksModule,
    RecipesModule,
    VendorsModule,
  ],
  providers: [
    // Order matters: JWT auth resolves req.user first, then the forced
    // password-change gate (BUG-003) runs before RBAC — a user mid-forced-
    // change has no business reaching a permission check at all.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
