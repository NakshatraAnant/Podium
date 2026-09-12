import { z } from "zod";

export const invoiceStatusEnum = z.enum([
  "DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED",
]);

export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().positive().default(1),
  rate: z.number().nonnegative(),
  hsnSac: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
  cityId: z.string().uuid(),
  dueDate: z.coerce.date(),
  items: z.array(invoiceItemSchema).min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD", "OTHER"]),
  receivedAt: z.coerce.date().optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const createAdjustmentNoteSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1),
});
export type CreateAdjustmentNoteInput = z.infer<typeof createAdjustmentNoteSchema>;

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(1).optional(),
});
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;
