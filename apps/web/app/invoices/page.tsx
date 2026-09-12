"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { InvoiceDto } from "../../lib/types";

const STATUSES = ["ALL", "DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;

export default function InvoicesPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const { data, isLoading } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get<InvoiceDto[]>("/invoices") });

  const rows = useMemo(
    () => (data ?? []).filter((inv) => status === "ALL" || inv.status === status),
    [data, status],
  );

  return (
    <AppShell crumb="Invoices">
      <div className="page-head">
        <div>
          <div className="page-title">Invoices</div>
          <div className="page-sub">GST invoices per city branch — CGST+SGST intra-state, IGST inter-state</div>
        </div>
        <div className="page-actions">
          <Link className="btn-primary" href="/invoices/new">
            New invoice
          </Link>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          {STATUSES.map((s) => (
            <button key={s} className={`chipbtn ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>
              {s === "ALL" ? "All" : s.replace("_", " ").toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="empty">Loading…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="empty">
          {data?.length === 0
            ? "No invoices yet — create one to get started."
            : `No ${status.replace("_", " ").toLowerCase()} invoices.`}
        </div>
      )}

      {rows.length > 0 && (
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
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">
                    <Link className="linkish" href={`/invoices/${inv.id}`}>
                      {inv.invoiceNo}
                    </Link>
                  </td>
                  <td>{inv.client.name}</td>
                  <td className="small">{inv.project.name}</td>
                  <td className="mono small">{fmtDate(inv.dueDate)}</td>
                  <td className="tright mono">{fmtINR(Number(inv.total))}</td>
                  <td>
                    <StatusPill status={inv.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
