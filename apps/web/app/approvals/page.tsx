"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { ApprovalDto } from "../../lib/types";

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["approvals"], queryFn: () => api.get<ApprovalDto[]>("/approvals") });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "APPROVED" | "REJECTED" }) => api.post(`/approvals/${id}/decide`, { decision }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });

  return (
    <AppShell crumb="Approvals">
      <div className="page-head">
        <div>
          <div className="page-title">Approvals</div>
          <div className="page-sub">{data?.filter((a) => a.status === "PENDING").length ?? 0} pending across projects</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Approver</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>
                  <span className="pill gray">{a.type}</span>
                </td>
                <td>{a.approverRef}</td>
                <td>
                  <StatusPill status={a.status} />
                </td>
                <td>
                  {a.status === "PENDING" && (
                    <div className="row">
                      <button className="btn-ok btn-sm" onClick={() => decide.mutate({ id: a.id, decision: "APPROVED" })}>
                        Approve
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => decide.mutate({ id: a.id, decision: "REJECTED" })}>
                        Decline
                      </button>
                    </div>
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
