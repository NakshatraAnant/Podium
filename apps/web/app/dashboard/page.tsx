"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { ApprovalDto, PnlActualsDto, ProjectDto, RiskDto } from "../../lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectDto[]>("/projects") });
  // A user without a grant on a widget's underlying resource (e.g. Finance
  // lacks risks:view) must not blow up the whole dashboard with a failed
  // query — retry: false and a plain empty state instead, per-widget.
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api.get<ApprovalDto[]>("/approvals"),
    retry: false,
  });
  const risks = useQuery({ queryKey: ["risks"], queryFn: () => api.get<RiskDto[]>("/risks"), retry: false });
  // Real net revenue (blueprint §18), not a client-side sum of project.revenue
  // (a bookings figure — the value a deal was won at, not recognised
  // revenue). Company-wide, trailing from the start of the calendar year —
  // ReportsService's own default range.
  const pnl = useQuery({
    queryKey: ["dashboard-pnl"],
    queryFn: () => api.get<PnlActualsDto>("/reports/pnl?scope=company"),
    retry: false,
  });

  const list = projects.data ?? [];
  const activeCount = list.filter((p) => p.status !== "COMPLETED").length;
  const redCount = list.filter((p) => p.health === "RED").length;
  const upcoming = [...list].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime()).slice(0, 6);
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.status === "PENDING").slice(0, 5);
  const openRisks = (risks.data ?? []).filter((r) => r.status !== "CLOSED").slice(0, 5);

  return (
    <AppShell crumb="Home">
      <div className="page-head">
        <div>
          <div className="page-title">Control tower</div>
          <div className="page-sub">Podium — AMM Brands LLP · six cities</div>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="stat" style={{ borderLeftColor: "var(--brass)" }}>
          <div className="k">Active projects</div>
          <div className="v">{activeCount}</div>
          <div className="d">{redCount} at risk</div>
        </div>
        <div className="stat" style={{ borderLeftColor: "var(--green)", cursor: "pointer" }} onClick={() => router.push("/reports")}>
          <div className="k">Net revenue — actuals, this year</div>
          <div className="v">{pnl.data?.hasData ? fmtINR(pnl.data.revenue.netRevenue) : "—"}</div>
          <div className="d">
            {pnl.data && !pnl.data.hasData
              ? "no real transactions yet"
              : pnl.data
                ? `${fmtINR(pnl.data.collections.outstanding)} outstanding · full P&L →`
                : ""}
          </div>
        </div>
        <div className="stat" style={{ borderLeftColor: "var(--blue)" }}>
          <div className="k">Pending approvals</div>
          <div className="v">{approvals.data?.filter((a) => a.status === "PENDING").length ?? 0}</div>
        </div>
        <div className="stat" style={{ borderLeftColor: "var(--red)" }}>
          <div className="k">Open risks</div>
          <div className="v">{risks.data?.filter((r) => r.status !== "CLOSED").length ?? 0}</div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        <div className="panel">
          <div className="panel-title">
            Project health <a onClick={() => router.push("/projects")}>View all →</a>
          </div>
          {projects.isLoading && <div className="empty">Loading…</div>}
          <div className="plist">
            {list.slice(0, 7).map((p) => (
              <div key={p.id} className="pcard" onClick={() => router.push(`/projects/${p.id}`)}>
                <span className={`health-dot ${p.health}`} />
                <div className="pbar">
                  <div className="pname">{p.name}</div>
                  <div className="pmeta">
                    {p.type} · {p.city.name} · {fmtDate(p.eventDate)} · PM {p.pm.name}
                  </div>
                </div>
                <div className="pright">
                  <StatusPill status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div className="panel-title">Pending approvals</div>
            {pendingApprovals.length === 0 && <div className="empty">Nothing pending.</div>}
            {pendingApprovals.map((a) => (
              <div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1EEE5" }}>
                <span style={{ fontSize: 12 }}>{a.title}</span>
                <span className="pill amber">{a.type}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-title">Open risks</div>
            {openRisks.length === 0 && <div className="empty">No open risks.</div>}
            {openRisks.map((r) => (
              <div key={r.id} style={{ padding: "7px 0", borderBottom: "1px solid #F1EEE5" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{r.title}</span>
                  <StatusPill status={r.severity} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Upcoming events</div>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((p) => (
              <tr key={p.id} className="rowhover" onClick={() => router.push(`/projects/${p.id}`)}>
                <td>{p.name}</td>
                <td className="mono">{fmtDate(p.eventDate)}</td>
                <td>
                  <StatusPill status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
