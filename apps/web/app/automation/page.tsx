"use client";

import { fmtDate } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api, ApiError } from "../../lib/api";
import type { AutomationRuleDto, AutomationRunDto } from "../../lib/types";

/**
 * Phase I: blueprint screen 30 — the rule list with an on/off toggle. The
 * automation engine (Phase 11) and its run log have existed since well
 * before this, but nothing ever showed the rules themselves; GET
 * /automation/rules and the toggle endpoint were added alongside this page
 * since neither existed before. Founder/Admin only (the "automation"
 * resource is workspace-config, not a role/city-scoped concern).
 */
export default function AutomationPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: rules, isLoading } = useQuery({ queryKey: ["automation-rules"], queryFn: () => api.get<AutomationRuleDto[]>("/automation/rules") });
  const { data: runs } = useQuery({ queryKey: ["automation-runs"], queryFn: () => api.get<AutomationRunDto[]>("/automation/runs?limit=30") });

  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) => api.patch(`/automation/rules/${id}`, { isEnabled }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["automation-rules"] }); },
    onError: (e: ApiError) => setError(e.message),
  });

  const actionSummary = (actions: AutomationRuleDto["actions"]) =>
    actions.map((a) => (typeof a === "string" ? a : a.type ?? "action")).join(", ");

  return (
    <AppShell crumb="Automation">
      <div className="page-head">
        <div>
          <div className="page-title">Automation</div>
          <div className="page-sub">{(rules?.length ?? 0)} rules · trigger → action, real engine (blueprint §12)</div>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <span className="small">{error}</span>
          <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-title">Rules</div>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Trigger type</th>
              <th>Actions</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules?.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="small mono">{r.triggerType}</td>
                <td className="small">{actionSummary(r.actions)}</td>
                <td className="small mono">{fmtDate(r.updatedAt)}</td>
                <td>
                  <button
                    className={r.isEnabled ? "btn-warn btn-sm" : "btn-primary btn-sm"}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: r.id, isEnabled: !r.isEnabled })}
                  >
                    {r.isEnabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-title">Recent runs</div>
        {(runs?.length ?? 0) === 0 && <div className="empty">No runs yet.</div>}
        {(runs?.length ?? 0) > 0 && (
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Status</th>
                <th>When</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs!.map((run) => (
                <tr key={run.id}>
                  <td className="small">{run.rule.name}</td>
                  <td><StatusPill status={run.status} /></td>
                  <td className="small mono">{fmtDate(run.startedAt)}</td>
                  <td className="small" style={{ color: "var(--text-faint)" }}>{run.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
