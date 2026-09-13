"use client";

import { fmtDate, fmtINR, initials } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { BudgetPanel } from "../../../components/BudgetPanel";
import { DocumentsPanel } from "../../../components/DocumentsPanel";
import { EventDayPanel } from "../../../components/EventDayPanel";
import { FlowCanvas } from "../../../components/FlowCanvas";
import { StatusPill } from "../../../components/StatusPill";
import { api } from "../../../lib/api";

interface ProjectDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  health: string;
  revenue: string;
  estCost: string;
  actCost: string;
  eventDate: string;
  city: { name: string };
  client: { id: string; name: string };
  pm: { id: string; name: string };
  members: Array<{ user: { id: string; name: string } }>;
  vendors: Array<{ vendor: { id: string; name: string; category: string } }>;
  tasks: Array<{ id: string; name: string; status: string; priority: string; dueAt: string | null }>;
  risks: Array<{ id: string; title: string; severity: string; status: string }>;
  flowInstances: Array<{ id: string; name: string; status: string; steps: Array<{ id: string; key: string; name: string; status: string; ownerId: string; role: string }> }>;
}

const TABS = ["overview", "tasks", "flows", "budget", "event day", "documents", "risks", "team"] as const;

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const { data: p, isLoading } = useQuery({
    queryKey: ["project", params.id],
    queryFn: () => api.get<ProjectDetail>(`/projects/${params.id}`),
  });

  if (isLoading || !p) {
    return (
      <AppShell crumb="Projects">
        <div className="empty">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={`Projects / ${p.name}`}>
      <div className="proj-header" style={{ marginBottom: 6 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600 }}>{p.name}</h1>
          <div className="proj-meta-row" style={{ display: "flex", gap: 22, marginTop: 8, flexWrap: "wrap" }}>
            <MetaItem label="City" value={p.city.name} />
            <MetaItem label="Client" value={p.client.name} />
            <MetaItem label="Event date" value={fmtDate(p.eventDate)} />
            <MetaItem label="PM" value={p.pm.name} />
            <MetaItem label="Status" value={<StatusPill status={p.status} />} />
          </div>
        </div>
      </div>

      <div className="grid g4" style={{ margin: "16px 0" }}>
        <div className="stat">
          <div className="k">Revenue</div>
          <div className="v">{fmtINR(Number(p.revenue))}</div>
        </div>
        <div className="stat">
          <div className="k">Estimated cost</div>
          <div className="v">{fmtINR(Number(p.estCost))}</div>
        </div>
        <div className="stat" style={{ borderLeftColor: "var(--green)" }}>
          <div className="k">Actual cost</div>
          <div className="v">{fmtINR(Number(p.actCost))}</div>
        </div>
        <div className="stat" style={{ borderLeftColor: `var(--${p.health === "RED" ? "red" : p.health === "AMBER" ? "brass" : "green"})` }}>
          <div className="k">Health</div>
          <div className="v" style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`health-dot ${p.health}`} /> {p.health}
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid g2">
          <div className="panel">
            <div className="panel-title">Vendors</div>
            {p.vendors.length === 0 && <div className="empty">No vendors assigned.</div>}
            {p.vendors.map((v) => (
              <div key={v.vendor.id} className="row" style={{ padding: "7px 0", borderBottom: "1px solid #F1EEE5", justifyContent: "space-between" }}>
                <span>{v.vendor.name}</span>
                <span className="small muted">{v.vendor.category}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-title">Open risks</div>
            {p.risks.filter((r) => r.status !== "CLOSED").length === 0 && <div className="empty">No open risks.</div>}
            {p.risks
              .filter((r) => r.status !== "CLOSED")
              .map((r) => (
                <div key={r.id} className="row" style={{ padding: "7px 0", borderBottom: "1px solid #F1EEE5", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12 }}>{r.title}</span>
                  <StatusPill status={r.severity} />
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Priority</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {p.tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    <StatusPill status={t.priority} />
                  </td>
                  <td className="mono small">{t.dueAt ? fmtDate(t.dueAt) : "—"}</td>
                  <td>
                    <StatusPill status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "flows" && (
        <div>
          {p.flowInstances.length === 0 && <div className="empty">No flows launched on this project yet.</div>}
          {p.flowInstances.map((f) => (
            <div key={f.id} className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-title">
                {f.name} <StatusPill status={f.status} />
              </div>
              <FlowCanvas steps={f.steps} />
            </div>
          ))}
        </div>
      )}

      {tab === "budget" && <BudgetPanel projectId={p.id} />}

      {tab === "event day" && (
        <EventDayPanel
          projectId={p.id}
          people={[p.pm, ...p.members.map((m) => m.user)].filter(
            (person, i, arr) => arr.findIndex((x) => x.id === person.id) === i,
          )}
        />
      )}

      {tab === "documents" && <DocumentsPanel projectId={p.id} />}

      {tab === "risks" && (
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
              {p.risks.map((r) => (
                <tr key={r.id}>
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
      )}

      {tab === "team" && (
        <div className="panel">
          <div className="avatars-stack" style={{ marginBottom: 10 }}>
            {p.members.map((m) => (
              <div key={m.user.id} className="av" title={m.user.name}>
                {initials(m.user.name)}
              </div>
            ))}
          </div>
          {p.members.map((m) => (
            <div key={m.user.id} style={{ padding: "6px 0" }}>
              {m.user.name}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="item">
      <span className="small muted">{label}</span>
      <b style={{ display: "block", marginTop: 1 }}>{value}</b>
    </div>
  );
}
