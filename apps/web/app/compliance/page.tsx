"use client";

import { fmtDate } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";

interface LicenceDto {
  id: string;
  type: string;
  authority: string;
  status: string;
  refNo: string | null;
  dueDate: string;
  city: { name: string };
  project: { name: string } | null;
}

export default function CompliancePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["licences"], queryFn: () => api.get<LicenceDto[]>("/licences") });
  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/licences/${id}/advance`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licences"] }),
  });

  return (
    <AppShell crumb="Compliance">
      <div className="page-head">
        <div>
          <div className="page-title">Compliance &amp; licences</div>
          <div className="page-sub">Liquor licences, permits, and music licences tracked against every event date</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Permit</th>
              <th>Event</th>
              <th>Authority</th>
              <th>Needed by</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data?.map((l) => (
              <tr key={l.id}>
                <td>
                  <b style={{ fontWeight: 500 }}>{l.type}</b>
                  <div className="small faint">{l.city.name}</div>
                </td>
                <td className="small">{l.project?.name ?? "Company-wide"}</td>
                <td className="small">{l.authority}</td>
                <td className="mono small">{fmtDate(l.dueDate)}</td>
                <td>
                  <StatusPill status={l.status} />
                </td>
                <td>
                  {l.status !== "APPROVED" && (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => advance.mutate({ id: l.id, status: l.status === "NOT_APPLIED" ? "APPLIED" : "APPROVED" })}
                    >
                      {l.status === "NOT_APPLIED" ? "Mark applied" : "Mark approved"}
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
