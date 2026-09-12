export interface ProjectDto {
  id: string;
  name: string;
  type: string;
  status: string;
  health: "GREEN" | "AMBER" | "RED";
  revenue: string | number;
  estCost: string | number;
  actCost: string | number;
  eventDate: string;
  city: { id: string; name: string };
  client: { id: string; name: string };
  pm: { id: string; name: string };
}

export interface TaskDto {
  id: string;
  projectId: string;
  name: string;
  status: string;
  priority: string;
  dueAt: string | null;
  ownerId: string;
  updatedAt: string;
}

export interface RiskDto {
  id: string;
  projectId: string;
  title: string;
  severity: string;
  status: string;
  ownerId: string;
}

export interface ApprovalDto {
  id: string;
  projectId: string;
  title: string;
  type: string;
  status: string;
  approverRef: string;
}

export interface InvoiceDto {
  id: string;
  invoiceNo: string;
  status: string;
  total: string | number;
  dueDate: string;
  client: { name: string };
  project: { name: string };
}

export interface FlowStepDto {
  id: string;
  key: string;
  name: string;
  role: string;
  status: string;
  ownerId: string;
  readyAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
}

export interface FlowInstanceDto {
  id: string;
  name: string;
  status: string;
  steps: FlowStepDto[];
  project: { id: string; name: string; cityId: string };
}

// ---------------------------------------------------------------- invoices
// Phase A. The detail shape mirrors InvoicesService.get()'s include set
// exactly — every money value arrives as a string (Prisma Decimal) and is
// parsed only for display. The server's number is always the authoritative
// one; nothing here recomputes a total for anything but a live preview.

export interface InvoiceItemDto {
  id: string;
  description: string;
  qty: string | number;
  rate: string | number;
  hsnSac: string | null;
}

export interface PaymentDto {
  id: string;
  amount: string | number;
  method: string;
  receivedAt: string;
}

export interface AdjustmentNoteDto {
  id: string;
  amount: string | number;
  reason: string;
  createdAt: string;
}

export interface InvoiceDetailDto {
  id: string;
  invoiceNo: string;
  status: string;
  issueDate: string | null;
  dueDate: string;
  placeOfSupply: string;
  taxableAmount: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  total: string | number;
  client: { id: string; name: string; email: string | null; gstin: string | null };
  project: { id: string; name: string };
  city: { id: string; name: string; code: string; gstStateCode: string };
  items: InvoiceItemDto[];
  payments: PaymentDto[];
  creditNotes: AdjustmentNoteDto[];
  debitNotes: AdjustmentNoteDto[];
}

export interface ClientOptionDto {
  id: string;
  name: string;
  cityId: string | null;
  gstStateCode: string | null;
}

export interface CityOptionDto {
  id: string;
  name: string;
  code: string;
  gstStateCode: string;
}
