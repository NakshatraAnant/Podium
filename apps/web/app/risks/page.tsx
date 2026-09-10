"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { RiskDto } from "../../lib/types";

export default function RisksPage() {
  const { data, isLoading } = useQuery({ queryKey: ["risks"], queryFn: () => api.get<RiskDto[]>("/risks") });

  return (
    <AppShell crumb="Risks & Issues">
      <div className="page-head">
        <div>
          <div className="page-title">Risks &amp; Issues</div>
          <div className="page-sub">{data?.length ?? 0} risks across projects — feeds project health scoring</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Risk</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id} className="rowhover">
                <td>{r.title}</td>
                <td>
                  <StatusPill status={r.severity} />
                </td>
                <td>
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
