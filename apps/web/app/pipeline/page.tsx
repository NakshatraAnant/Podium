"use client";

import { fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";
import type { CityOptionDto, LeadDto, LeadListResponse, LeadStage } from "../../lib/types";

const STAGES: LeadStage[] = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

/**
 * Phase F.5: the board view of the ~200 real pipeline opportunities
 * (LeadsService.list()'s own docstring), grouped by stage. Fetches the
 * PIPELINE kind at a high limit rather than paging — the same "board, not a
 * paged table" shape this data was designed for.
 */
export default function PipelinePage() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["leads", "pipeline-board"],
    queryFn: () => api.get<LeadListResponse>("/leads?kind=PIPELINE&limit=500"),
  });
  const { data: cities } = useQuery({ queryKey: ["cities"], queryFn: () => api.get<CityOptionDto[]>("/cities") });

  const byStage: Record<LeadStage, LeadDto[]> = { LEAD: [], QUALIFIED: [], PROPOSAL: [], NEGOTIATION: [], WON: [], LOST: [] };
  for (const lead of data?.rows ?? []) byStage[lead.stage].push(lead);

  const totalValue = (leads: LeadDto[]) => leads.reduce((s, l) => s + (l.value !== null ? Number(l.value) : 0), 0);

  return (
    <AppShell crumb="Pipeline">
      <div className="page-head">
        <div>
          <div className="page-title">Pipeline</div>
          <div className="page-sub">{(data?.total ?? 0).toLocaleString("en-IN")} opportunities across all stages</div>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={() => router.push("/leads")}>View as list</button>
        </div>
      </div>

      {isLoading && <div className="empty">Loading…</div>}
      {!isLoading && (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {STAGES.map((stage) => (
            <div key={stage} className="panel" style={{ minWidth: 240, flex: "0 0 240px" }}>
              <div className="panel-title" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{stage}</span>
                <span className="small mono" style={{ color: "var(--text-faint)" }}>{byStage[stage].length}</span>
              </div>
              <div className="small mono" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
                {fmtINR(totalValue(byStage[stage]))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {byStage[stage].map((lead) => (
                  <div
                    key={lead.id}
                    className="panel rowhover"
                    style={{ padding: 10, cursor: "pointer" }}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <div className="small" style={{ fontWeight: 600 }}>{lead.name}</div>
                    <div className="small" style={{ color: "var(--text-faint)" }}>
                      {cities?.find((c) => c.id === lead.cityId)?.name ?? "No city"}
                    </div>
                    <div className="small mono">{lead.value !== null ? fmtINR(Number(lead.value)) : "Unestimated"}</div>
                  </div>
                ))}
                {byStage[stage].length === 0 && <div className="small" style={{ color: "var(--text-faint)" }}>Empty</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
