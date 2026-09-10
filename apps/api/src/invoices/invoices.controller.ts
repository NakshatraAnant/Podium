import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { createAdjustmentNoteSchema, createInvoiceSchema, recordPaymentSchema } from "@podium/shared-types";
import { Audit } from "../common/decorators/audit.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { RequestUser } from "../common/types";
import { InvoicesService } from "./invoices.service";

@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions("invoices:view")
  list(@CurrentUser() user: RequestUser, @Query("cityId") cityId?: string) {
    return this.invoices.list(user, cityId);
  }

  @Get(":id")
  @RequirePermissions("invoices:view")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.invoices.get(user, id);
  }

  @Post()
  @RequirePermissions("invoices:create")
  @Audit("invoice", "invoice.create_draft")
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: ReturnType<typeof createInvoiceSchema.parse>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.invoices.create(user, body, idempotencyKey);
  }

  /** Locks the invoice number and its GST split — irreversible; see InvoicesService class doc. */
  @Post(":id/issue")
  @RequirePermissions("invoices:edit")
  @Audit("invoice", "invoice.issue")
  issue(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.invoices.issue(user, id);
  }

  @Post(":id/payments")
  @RequirePermissions("payments:create")
  @Audit("payment", "invoice.payment_recorded")
  recordPayment(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: ReturnType<typeof recordPaymentSchema.parse>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.invoices.recordPayment(user, id, body, idempotencyKey);
  }

  @Post(":id/credit-notes")
  @RequirePermissions("invoices:edit")
  @Audit("credit_note", "invoice.credit_note")
  creditNote(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(createAdjustmentNoteSchema)) body: ReturnType<typeof createAdjustmentNoteSchema.parse>) {
    return this.invoices.createCreditNote(user, id, body);
  }

  @Post(":id/debit-notes")
  @RequirePermissions("invoices:edit")
  @Audit("debit_note", "invoice.debit_note")
  debitNote(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(createAdjustmentNoteSchema)) body: ReturnType<typeof createAdjustmentNoteSchema.parse>) {
    return this.invoices.createDebitNote(user, id, body);
  }
}
