"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { PurchaseOrderDto, PurchaseRequestDto } from "../../lib/types";

type Tab = "requests" | "orders";

export default function ProcurementPage() {
  const [tab, setTab] = useState<Tab>("requests");

  const { data: requests, isLoading: loadingRequests } = useQuery({
    queryKey: ["purchase-requests"],
    queryFn: () => api.get<PurchaseRequestDto[]>("/purchase-requests"),
  });
  const { data: orders, isLoading: loadingOrders } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => api.get<PurchaseOrderDto[]>("/purchase-orders"),
  });

  return (
    <AppShell crumb="Procurement">
      <div className="page-head">
        <div>
          <div className="page-title">Procurement</div>
          <div className="page-sub">Purchase request → approval → purchase order → goods receipt → inventory ledger</div>
        </div>
        <div className="page-actions">
          <Link className="btn-primary" href="/procurement/requests/new">
            New purchase request
          </Link>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>
          Requests
        </button>
        <button className={`tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>
          Orders
        </button>
      </div>

      {tab === "requests" && (
        <div className="panel">
          {loadingRequests && <div className="empty">Loading…</div>}
          {!loadingRequests && (requests?.length ?? 0) === 0 && <div className="empty">No purchase requests yet.</div>}
          {(requests?.length ?? 0) > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Vendor</th>
                  <th>Project</th>
                  <th className="tright">Amount</th>
                  <th>Status</th>
                  <th className="mono small">Raised</th>
                </tr>
              </thead>
              <tbody>
                {requests!.map((pr) => (
                  <tr key={pr.id}>
                    <td>
                      <Link className="linkish" href={`/procurement/requests/${pr.id}`}>
                        {pr.item}
                      </Link>
                    </td>
                    <td className="small">{pr.vendor.name}</td>
                    <td className="small">{pr.project?.name ?? "—"}</td>
                    <td className="tright mono">{fmtINR(Number(pr.amount))}</td>
                    <td>
                      <StatusPill status={pr.status} />
                    </td>
                    <td className="mono small">{fmtDate(pr.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="panel">
          {loadingOrders && <div className="empty">Loading…</div>}
          {!loadingOrders && (orders?.length ?? 0) === 0 && <div className="empty">No purchase orders yet.</div>}
          {(orders?.length ?? 0) > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>From request</th>
                  <th className="tright">Total</th>
                  <th>Lines</th>
                  <th>Status</th>
                  <th className="mono small">Raised</th>
                </tr>
              </thead>
              <tbody>
                {orders!.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <Link className="linkish" href={`/procurement/orders/${po.id}`}>
                        {po.vendor.name}
                      </Link>
                    </td>
                    <td className="small">{po.purchaseRequest.item}</td>
                    <td className="tright mono">{fmtINR(Number(po.total))}</td>
                    <td className="small">{po.items.length}</td>
                    <td>
                      <StatusPill status={po.status} />
                    </td>
                    <td className="mono small">{fmtDate(po.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </AppShell>
  );
}
