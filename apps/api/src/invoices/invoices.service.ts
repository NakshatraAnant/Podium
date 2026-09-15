import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@podium/db";
import { randomUUID } from "crypto";
import type { CreateAdjustmentNoteInput, CreateInvoiceInput, RecordPaymentInput } from "@podium/shared-types";
import { CityScopeService } from "../common/city-scope/city-scope.service";
import { MailService } from "../common/mail/mail.service";
import { PrismaService } from "../common/prisma/prisma.service";
import type { RequestUser } from "../common/types";
import { InvoicePdfService, type InvoicePdfData } from "./invoice-pdf.service";

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const GST_RATE = 0.18;

/**
 * One line's taxable value: quantity x rate, less its own discount.
 *
 * Shared by create() and issue() deliberately. The draft total and the issued
 * total have to be computed the same way, or a discount silently changes the
 * moment an invoice is issued — and the issued figure is the one that is
 * filed.
 */
function lineTaxable(qty: number, rate: number, discountPct: number): number {
  const gross = qty * rate;
  return gross - gross * (discountPct / 100);
}

function financialYearFor(date: Date): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? y : y - 1; // Indian FY: Apr-Mar
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

/**
 * The invoice engine (blueprint §17). Two rules are load-bearing and must
 * never be relaxed:
 *  1. Numbering (AMM/{CITY}/{FY}/{SEQ}) is sequential per city per FY and
 *     gap-free — the counter row is locked (SELECT ... FOR UPDATE) in the
 *     same transaction that mints the number, so two concurrent "issue"
 *     calls for the same city/FY can never collide or skip.
 *  2. An ISSUED invoice is immutable. There is no update path for its
 *     items/amounts once issued — corrections are a credit_note or
 *     debit_note, always. This service does not expose an "edit issued
 *     invoice" method at all, not even a guarded one.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cityScope: CityScopeService,
    private readonly pdf: InvoicePdfService,
    private readonly mail: MailService,
  ) {}

  list(user: RequestUser, cityId?: string) {
    const scope = this.cityScope.scopeFilter(user, cityId);
    return this.prisma.client.invoice.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...scope },
      include: { items: true, payments: true, client: true, project: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(user: RequestUser, id: string) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id, workspaceId: user.workspaceId, deletedAt: null },
      include: {
        items: { orderBy: [{ scope: "asc" }, { sortOrder: "asc" }] },
        payments: true,
        creditNotes: true,
        debitNotes: true,
        client: true,
        project: true,
        city: true,
        brand: true,
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found.");
    this.cityScope.assertCanAccessCity(user, invoice.cityId);
    return invoice;
  }

  /** Creates a DRAFT invoice — no number is minted, nothing is final, still freely editable via delete+recreate. */
  async create(user: RequestUser, input: CreateInvoiceInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.client.invoice.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }
    this.cityScope.assertCanAccessCity(user, input.cityId);
    const client = await this.prisma.client.client.findUniqueOrThrow({ where: { id: input.clientId } });
    const taxable = input.items.reduce((s, i) => s + lineTaxable(i.qty, i.rate, i.discountPct), 0);

    return this.prisma.client.invoice.create({
      data: {
        workspaceId: user.workspaceId,
        invoiceNo: `DRAFT-${Date.now()}`, // placeholder, replaced by a real number on issue
        clientId: input.clientId,
        projectId: input.projectId,
        cityId: input.cityId,
        brandId: input.brandId,
        docType: input.docType,
        dueDate: input.dueDate,
        paymentTerms: input.paymentTerms,
        quotationRef: input.quotationRef,
        serviceLocation: input.serviceLocation,
        status: "DRAFT",
        placeOfSupply: client.gstStateCode ?? "",
        taxableAmount: taxable,
        idempotencyKey,
        items: {
          // sortOrder is the caller's array order: the printed document
          // numbers lines 01, 02… within each scope, and an invoice whose
          // lines reshuffle between renders is not a document anyone can
          // reconcile against.
          create: input.items.map((i, index) => ({
            description: i.description,
            detail: i.detail,
            qty: i.qty,
            unit: i.unit,
            rate: i.rate,
            discountPct: i.discountPct,
            hsnSac: i.hsnSac,
            scope: i.scope,
            sortOrder: index,
          })),
        },
        createdById: user.id,
      },
      include: { items: true },
    });
  }

  /**
   * Locks the invoice number, computes the final GST split from the
   * issuing city's GST state code vs. the client's, and flips DRAFT -> ISSUED.
   * From this point on the invoice is immutable — see class doc.
   */
  async issue(user: RequestUser, id: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null }, include: { items: true, city: true, client: true } });
      if (!invoice) throw new NotFoundException("Invoice not found.");
      this.cityScope.assertCanAccessCity(user, invoice.cityId);
      if (invoice.status !== "DRAFT") {
        throw new ConflictException(`Invoice is already ${invoice.status} — only a DRAFT invoice can be issued.`);
      }
      if (!invoice.client.gstStateCode) {
        throw new BadRequestException("Client has no GST state code on file — cannot determine place of supply.");
      }

      const invoiceNo = await this.mintInvoiceNumber(tx, user.workspaceId, invoice.cityId, invoice.city.code, new Date());
      const taxable = invoice.items.reduce(
        (s, i) => s + lineTaxable(i.qty.toNumber(), i.rate.toNumber(), i.discountPct.toNumber()),
        0,
      );
      const intra = invoice.city.gstStateCode === invoice.client.gstStateCode;
      const tax = Math.round(taxable * GST_RATE);
      const cgst = intra ? tax / 2 : 0;
      const sgst = intra ? tax / 2 : 0;
      const igst = intra ? 0 : tax;

      // AMM's invoices present a whole-rupee grand total, with the rounding
      // shown as its own line. Storing the adjustment rather than silently
      // folding it into the total is what lets the printed SUMMARY column
      // add up exactly — and what keeps the GST figures equal to what was
      // actually computed.
      const beforeRounding = taxable + tax;
      const total = Math.round(beforeRounding);
      const roundOff = Number((total - beforeRounding).toFixed(2));

      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          invoiceNo,
          issueDate: new Date(),
          status: "ISSUED",
          placeOfSupply: invoice.client.gstStateCode,
          taxableAmount: taxable,
          cgst, sgst, igst,
          roundOff,
          total,
        },
        include: { items: true },
      });
    });
  }

  /** Sequential, gap-free, never-reused numbering per city per financial year — locked under the same transaction as the invoice update. */
  private async mintInvoiceNumber(tx: Tx, workspaceId: string, cityId: string, cityCode: string, at: Date): Promise<string> {
    const fy = financialYearFor(at);
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO invoice_counters (id, workspace_id, city_id, financial_year, last_sequence)
                 VALUES (${randomUUID()}::uuid, ${workspaceId}::uuid, ${cityId}::uuid, ${fy}, 0)
                 ON CONFLICT (city_id, financial_year) DO NOTHING`,
    );
    const [locked] = await tx.$queryRaw<Array<{ last_sequence: number }>>(
      Prisma.sql`SELECT last_sequence FROM invoice_counters WHERE city_id = ${cityId}::uuid AND financial_year = ${fy} FOR UPDATE`,
    );
    const nextSeq = (locked?.last_sequence ?? 0) + 1;
    await tx.$executeRaw(
      Prisma.sql`UPDATE invoice_counters SET last_sequence = ${nextSeq} WHERE city_id = ${cityId}::uuid AND financial_year = ${fy}`,
    );
    return `AMM/${cityCode}/${fy}/${String(nextSeq).padStart(4, "0")}`;
  }

  async recordPayment(user: RequestUser, invoiceId: string, input: RecordPaymentInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.client.payment.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }
    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, workspaceId: user.workspaceId, deletedAt: null }, include: { payments: true } });
      if (!invoice) throw new NotFoundException("Invoice not found.");
      this.cityScope.assertCanAccessCity(user, invoice.cityId);
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
        throw new BadRequestException(`Cannot record a payment against a ${invoice.status} invoice.`);
      }

      const payment = await tx.payment.create({
        data: { invoiceId, amount: input.amount, method: input.method, receivedAt: input.receivedAt ?? new Date(), createdById: user.id, idempotencyKey },
      });

      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount.toNumber(), 0) + input.amount;
      const total = invoice.total.toNumber();
      const status = totalPaid >= total ? "PAID" : totalPaid > 0 ? "PARTIALLY_PAID" : invoice.status;
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });

      return payment;
    });
  }

  /** Corrections to an ISSUED invoice — never an UPDATE on the invoice row itself. */
  async createCreditNote(user: RequestUser, invoiceId: string, input: CreateAdjustmentNoteInput) {
    const invoice = await this.get(user, invoiceId);
    if (invoice.status === "DRAFT") throw new BadRequestException("Credit notes apply to issued invoices only — edit the draft directly instead.");
    return this.prisma.client.creditNote.create({ data: { invoiceId, amount: input.amount, reason: input.reason, createdById: user.id } });
  }

  async createDebitNote(user: RequestUser, invoiceId: string, input: CreateAdjustmentNoteInput) {
    const invoice = await this.get(user, invoiceId);
    if (invoice.status === "DRAFT") throw new BadRequestException("Debit notes apply to issued invoices only — edit the draft directly instead.");
    return this.prisma.client.debitNote.create({ data: { invoiceId, amount: input.amount, reason: input.reason, createdById: user.id } });
  }

  /**
   * Cancels a DRAFT invoice. DRAFT-only, deliberately: an ISSUED invoice has
   * a minted, gap-free number and is a tax document, so it is never
   * cancelled or deleted — the only correction path is a credit note (see
   * class doc). Soft-deletes rather than hard-deleting so the number
   * placeholder and the audit trail stay resolvable.
   */
  async cancel(user: RequestUser, id: string, reason?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id, workspaceId: user.workspaceId, deletedAt: null } });
      if (!invoice) throw new NotFoundException("Invoice not found.");
      this.cityScope.assertCanAccessCity(user, invoice.cityId);
      if (invoice.status !== "DRAFT") {
        throw new ConflictException(
          `Only a DRAFT invoice can be cancelled — this one is ${invoice.status}. An issued invoice is a tax ` +
            "document and is corrected with a credit note, never cancelled.",
        );
      }
      return tx.invoice.update({
        where: { id },
        data: { status: "CANCELLED", deletedAt: new Date() },
      });
    });
  }

  /**
   * Loads an invoice and renders it as a PDF. Every value on the page comes
   * from the stored row — nothing is passed in by the caller beyond the id.
   */
  async renderPdf(user: RequestUser, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.get(user, id);
    const workspace = await this.prisma.client.workspace.findUniqueOrThrow({ where: { id: invoice.workspaceId } });

    const data: InvoicePdfData = {
      invoiceNo: invoice.invoiceNo,
      docType: invoice.docType,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      placeOfSupply: invoice.placeOfSupply,
      paymentTerms: invoice.paymentTerms,
      quotationRef: invoice.quotationRef,
      serviceLocation: invoice.serviceLocation,
      taxableAmount: invoice.taxableAmount.toNumber(),
      cgst: invoice.cgst.toNumber(),
      sgst: invoice.sgst.toNumber(),
      igst: invoice.igst.toNumber(),
      roundOff: invoice.roundOff.toNumber(),
      total: invoice.total.toNumber(),
      workspace: {
        name: workspace.name,
        gstin: workspace.gstin,
        address: workspace.address,
        website: workspace.website,
        bankName: workspace.bankName,
        bankAccountName: workspace.bankAccountName,
        bankAccountNo: workspace.bankAccountNo,
        bankIfsc: workspace.bankIfsc,
        invoiceTerms: workspace.invoiceTerms,
        invoiceDeclaration: workspace.invoiceDeclaration,
      },
      brand: invoice.brand ? { name: invoice.brand.name, tagline: invoice.brand.tagline, website: invoice.brand.website } : null,
      city: { name: invoice.city.name, state: invoice.city.state, gstStateCode: invoice.city.gstStateCode },
      client: {
        name: invoice.client.name,
        address: invoice.client.address,
        gstin: invoice.client.gstin,
        gstStateCode: invoice.client.gstStateCode,
      },
      project: { name: invoice.project.name, eventDate: invoice.project.eventDate },
      items: invoice.items.map((i) => ({
        description: i.description,
        detail: i.detail,
        qty: i.qty.toNumber(),
        unit: i.unit,
        rate: i.rate.toNumber(),
        discountPct: i.discountPct.toNumber(),
        hsnSac: i.hsnSac,
        scope: i.scope,
      })),
      payments: invoice.payments.map((p) => ({ amount: p.amount.toNumber(), receivedAt: p.receivedAt, method: p.method })),
      creditNotes: invoice.creditNotes.map((n) => ({ amount: n.amount.toNumber(), reason: n.reason })),
      debitNotes: invoice.debitNotes.map((n) => ({ amount: n.amount.toNumber(), reason: n.reason })),
    };

    const buffer = await this.pdf.render(data);
    // Invoice numbers contain slashes (AMM/JPR/26-27/0001) which are not
    // legal in a filename.
    const filename = `${invoice.invoiceNo.replace(/\//g, "-")}.pdf`;
    return { buffer, filename };
  }

  /**
   * E-mails an issued invoice to the client, PDF attached. DRAFT invoices
   * are not sendable — an unissued invoice has no real number and no final
   * GST split, so sending one would put a document in a client's inbox that
   * does not correspond to anything in AMM's books.
   */
  async emailToClient(user: RequestUser, id: string) {
    const invoice = await this.get(user, id);
    if (invoice.status === "DRAFT") {
      throw new BadRequestException("This invoice is still a DRAFT — issue it before sending it to the client.");
    }
    if (!invoice.client.email) {
      throw new BadRequestException(`${invoice.client.name} has no e-mail address on file — add one before sending.`);
    }

    const { buffer, filename } = await this.renderPdf(user, id);
    const total = invoice.total.toNumber();
    const paid = invoice.payments.reduce((s, p) => s + p.amount.toNumber(), 0);
    const balance = total - paid;

    const sent = await this.mail.send({
      to: invoice.client.email,
      subject: `Invoice ${invoice.invoiceNo} from AMM Brands LLP`,
      text:
        `Dear ${invoice.client.name},\n\n` +
        `Please find attached invoice ${invoice.invoiceNo} for ${invoice.project.name}.\n\n` +
        `Invoice total: INR ${total.toFixed(2)}\n` +
        `Balance due: INR ${balance.toFixed(2)}\n` +
        `Due date: ${invoice.dueDate.toISOString().slice(0, 10)}\n\n` +
        `Please quote ${invoice.invoiceNo} in your payment reference.\n\n` +
        `AMM Brands LLP`,
      attachments: [{ filename, content: buffer, contentType: "application/pdf" }],
    });

    await this.prisma.client.auditLog.create({
      data: {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: "invoice.emailed",
        entityType: "invoice",
        entityId: id,
        after: { to: invoice.client.email, mode: sent.mode, messageId: sent.messageId },
      },
    });

    return { ok: true, to: invoice.client.email, mode: sent.mode, messageId: sent.messageId };
  }

  /**
   * Transitions ISSUED / PARTIALLY_PAID invoices past their due date to
   * OVERDUE. Run from the BullMQ worker (workers/), NOT an in-process cron —
   * with more than one API instance an in-process schedule fires once per
   * instance, and "it's idempotent so the duplicate is harmless" is a
   * mitigation, not a design.
   *
   * Deliberately NOT city-scoped and NOT permission-gated: it runs as the
   * system, over the whole workspace, with no user in the request context.
   * It is exported as a service method (rather than living in the worker) so
   * the same code path is what the e2e test drives.
   */
  async sweepOverdue(now: Date = new Date()): Promise<{ transitioned: number; invoiceIds: string[] }> {
    const due = await this.prisma.client.invoice.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        dueDate: { lt: now },
      },
      include: { project: true, client: true },
    });
    if (due.length === 0) return { transitioned: 0, invoiceIds: [] };

    const transitioned: string[] = [];
    for (const invoice of due) {
      await this.prisma.client.$transaction(async (tx) => {
        // Re-read under the transaction: a payment could have landed between
        // the scan above and this write, taking the invoice to PAID. The
        // status filter in the update makes that a no-op rather than a
        // regression from PAID back to OVERDUE.
        const updated = await tx.invoice.updateMany({
          where: { id: invoice.id, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
          data: { status: "OVERDUE" },
        });
        if (updated.count === 0) return;

        transitioned.push(invoice.id);
        await tx.auditLog.create({
          data: {
            workspaceId: invoice.workspaceId,
            actorId: null, // system sweep, not a human action
            action: "invoice.marked_overdue",
            entityType: "invoice",
            entityId: invoice.id,
            after: { invoiceNo: invoice.invoiceNo, dueDate: invoice.dueDate, previousStatus: invoice.status },
          },
        });

        // Notify the project's PM. If the project has no PM there is nobody
        // specific to tell — the audit row above is still written, so the
        // transition is never silent.
        if (invoice.project.pmId) {
          await tx.notification.create({
            data: {
              workspaceId: invoice.workspaceId,
              userId: invoice.project.pmId,
              icon: "⚠",
              text: `Invoice ${invoice.invoiceNo} (${invoice.client.name}) is overdue — due ${invoice.dueDate.toISOString().slice(0, 10)}.`,
              sourceType: "invoice",
              sourceId: invoice.id,
            },
          });
        }
      });
    }

    if (transitioned.length > 0) {
      this.logger.log(`Overdue sweep: ${transitioned.length} invoice(s) transitioned to OVERDUE.`);
    }
    return { transitioned: transitioned.length, invoiceIds: transitioned };
  }
}
