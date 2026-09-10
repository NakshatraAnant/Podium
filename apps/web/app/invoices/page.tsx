"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { InvoiceDto } from "../../lib/types";

export default function InvoicesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get<InvoiceDto[]>("/invoices") });
  const issue = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/issue`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  return (
    <AppShell crumb="Invoices">
      <div className="page-head">
        <div>
          <div className="page-title">Invoices</div>
          <div className="page-sub">GST invoices per city branch — CGST+SGST intra-state, IGST inter-state</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Invoice no.</th>
              <th>Client</th>
              <th>Project</th>
              <th>Due</th>
              <th className="tright">Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.invoiceNo}</td>
                <td>{inv.client.name}</td>
                <td className="small">{inv.project.name}</td>
                <td className="mono small">{fmtDate(inv.dueDate)}</td>
                <td className="tright mono">{fmtINR(Number(inv.total))}</td>
                <td>
                  <StatusPill status={inv.status} />
                </td>
                <td>
                  {inv.status === "DRAFT" && (
                    <button className="btn-ghost btn-sm" onClick={() => issue.mutate(inv.id)}>
                      Issue
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
