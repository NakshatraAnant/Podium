"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";

interface ClientDto {
  id: string;
  name: string;
  type: string;
  ltv: string;
  since: string | null;
  city: { name: string };
  projects: unknown[];
}

export default function ClientsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["clients"], queryFn: () => api.get<ClientDto[]>("/clients") });

  return (
    <AppShell crumb="Clients">
      <div className="page-head">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-sub">{data?.length ?? 0} client accounts</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th>City</th>
              <th className="tright">Lifetime value</th>
              <th>Client since</th>
              <th className="tright">Active projects</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id} className="rowhover">
                <td>{c.name}</td>
                <td>
                  <span className="pill blue">{c.type}</span>
                </td>
                <td>{c.city.name}</td>
                <td className="tright mono">{fmtINR(Number(c.ltv))}</td>
                <td className="mono">{c.since ? fmtDate(c.since) : "—"}</td>
                <td className="tright mono">{c.projects?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
