"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { ExpenseDto, ProjectDto } from "../../lib/types";

const FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED", "REIMBURSED"] as const;

export default function ExpensesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("PENDING");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => api.get<ExpenseDto[]>("/expenses"),
  });

  const rows = useMemo(
    () => (data ?? []).filter((e) => filter === "ALL" || e.status === filter),
    [data, filter],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["expenses"] });
  const onError = (e: ApiError) => setError(e.message);

  const decide = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: string; reason?: string }) =>
      api.post(`/expenses/${id}/decide`, { decision, reason }),
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });
  const reimburse = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/reimburse`),
    onSuccess: () => { setError(null); refresh(); },
    onError,
  });

  return (
    <AppShell crumb="Expenses">
      <div className="page-head">
        <div>
          <div className="page-title">Expenses</div>
          <div className="page-sub">
            Claims are approved by someone other than the claimant — you cannot decide your own.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "Submit a claim"}
          </button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <span className="small">{error}</span>
          <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <SubmitClaimForm
          onDone={() => { setShowForm(false); setError(null); refresh(); }}
          onError={onError}
        />
      )}

      <div className="toolbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f} className={`chipbtn ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {f === "ALL" ? "All" : f.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="empty">Loading…</div>}
      {!isLoading && rows.length === 0 && <div className="empty">No {filter.toLowerCase()} claims.</div>}

      {rows.length > 0 && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Incurred</th>
                <th>Claimant</th>
                <th>Project</th>
                <th>Category</th>
                <th className="tright">Amount</th>
                <th>Status</th>
                <th>Decided by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const isOwn = e.user.id === user?.id;
                return (
                  <tr key={e.id}>
                    <td className="mono small">{fmtDate(e.incurredAt)}</td>
                    <td>{e.user.name}{isOwn && <span className="small" style={{ color: "var(--text-faint)" }}> (you)</span>}</td>
                    <td className="small">{e.project.name}</td>
                    <td className="small">{e.category}</td>
                    <td className="tright mono">{fmtINR(Number(e.amount))}</td>
                    <td><StatusPill status={e.status} /></td>
                    <td className="small">{e.approvedBy?.name ?? "—"}</td>
                    <td>
                      {e.status === "PENDING" && !isOwn && (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button className="btn-ok btn-sm" onClick={() => decide.mutate({ id: e.id, decision: "APPROVED" })}>
                            Approve
                          </button>
                          <RejectButton onReject={(reason) => decide.mutate({ id: e.id, decision: "REJECTED", reason })} />
                        </span>
                      )}
                      {e.status === "PENDING" && isOwn && (
                        <span className="small" style={{ color: "var(--text-faint)" }}>Awaiting someone else</span>
                      )}
                      {e.status === "APPROVED" && (
                        <button className="btn-ghost btn-sm" onClick={() => reimburse.mutate(e.id)}>
                          Mark reimbursed
                        </button>
                      )}
                      {e.status === "REJECTED" && e.decisionReason && (
                        <span className="small" style={{ color: "var(--text-faint)" }}>{e.decisionReason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

function RejectButton({ onReject }: { onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className="btn-warn btn-sm" onClick={() => setOpen(true)}>Reject</button>;
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <input className="inp" style={{ width: 170 }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-warn btn-sm" disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>Confirm</button>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>×</button>
    </span>
  );
}

function SubmitClaimForm({ onDone, onError }: { onDone: () => void; onError: (e: ApiError) => void }) {
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectDto[]>("/projects") });

  const submit = useMutation({
    mutationFn: () => api.post("/expenses", { projectId, category: category.trim(), amount: Number(amount), note: note.trim() || undefined }),
    onSuccess: onDone,
    onError: (e: ApiError) => onError(e),
  });

  const valid = projectId && category.trim() && Number(amount) > 0;

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">Submit a claim</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
          <span className="small" style={{ color: "var(--text-dim)" }}>Project</span>
          <select className="inp" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select…</option>
            {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="small" style={{ color: "var(--text-dim)" }}>Category</span>
          <input className="inp" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Transport & Logistics" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="small" style={{ color: "var(--text-dim)" }}>Amount (INR)</span>
          <input className="inp tright mono" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          <span className="small" style={{ color: "var(--text-dim)" }}>Note</span>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this was for" />
        </label>
        <button className="btn-primary" disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>
          {submit.isPending ? "Submitting…" : "Submit claim"}
        </button>
      </div>
    </div>
  );
}
