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
