"use client";

import { fmtINR } from "@podium/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { api, ApiError } from "../../../lib/api";
import type { CityOptionDto, ProjectDto } from "../../../lib/types";

interface DraftItem {
  description: string;
  qty: string;
  rate: string;
  hsnSac: string;
}

const emptyItem = (): DraftItem => ({ description: "", qty: "1", rate: "", hsnSac: "" });

export default function NewInvoicePage() {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [cityId, setCityId] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);

  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectDto[]>("/projects") });
  const { data: cities } = useQuery({ queryKey: ["cities"], queryFn: () => api.get<CityOptionDto[]>("/cities") });

  /**
   * The project is the primary selection and the client is DERIVED from it,
   * rather than being a second dropdown the user has to keep consistent.
   *
   * Two reasons. Every invoice must belong to a project (`projectId` is
   * non-null in the schema), so the client is never ambiguous once a project
   * is chosen — a separate client picker only creates the opportunity to
   * select a mismatched pair the server would reject anyway. And in practice
   * the Finance role, which is exactly who raises invoices, does not hold
   * `clients:view` under the seeded RBAC matrix, so a client dropdown backed
   * by GET /clients renders empty for them (see docs/STATUS.md — reported as
   * an RBAC finding rather than quietly widening a role's permissions).
   * GET /projects already returns the client on each row.
   */
  const selectedProject = useMemo(
    () => (projects ?? []).find((p) => p.id === projectId),
    [projects, projectId],
  );

  /**
   * A display-only preview. The server computes the authoritative taxable
   * amount, the CGST/SGST vs IGST split and the total when the invoice is
   * issued — this exists so the person filling the form can sanity-check
   * their own arithmetic, and is deliberately labelled as an estimate.
   */
  const previewTaxable = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0),
    [items],
  );

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/invoices", {
        clientId,
        projectId,
        cityId,
        dueDate: new Date(dueDate).toISOString(),
        items: items
          .filter((i) => i.description.trim() && i.rate !== "")
          .map((i) => ({
            description: i.description.trim(),
            qty: Number(i.qty) || 1,
            rate: Number(i.rate),
            ...(i.hsnSac.trim() ? { hsnSac: i.hsnSac.trim() } : {}),
          })),
      }),
    onSuccess: (inv) => router.push(`/invoices/${inv.id}`),
    onError: (e: ApiError) => setError(e.message),
  });

  const patchItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const valid =
    clientId && projectId && cityId && dueDate && items.some((i) => i.description.trim() && i.rate !== "");

  return (
    <AppShell crumb="Invoices / New">
      <div className="page-head">
        <div>
          <div className="page-title">New invoice</div>
          <div className="page-sub">
            Creates a DRAFT. The invoice number and the GST split are minted by the server when you issue it.
          </div>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-title">Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <Field label="Project">
            <select
              className="inp"
              value={projectId}
              onChange={(e) => {
                const p = (projects ?? []).find((x) => x.id === e.target.value);
                setProjectId(e.target.value);
                setClientId(p?.client.id ?? "");
                // Default the billing branch to the project's own city; the
                // user can still override it, since AMM can bill a project
                // from a different branch.
                if (p?.city?.id && !cityId) setCityId(p.city.id);
              }}
            >
              <option value="">Select a project…</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Client" hint="Taken from the project — an invoice always belongs to one">
            <input className="inp" readOnly value={selectedProject?.client.name ?? ""} placeholder="Pick a project first" />
          </Field>

          <Field label="Billing city (branch)" hint="Decides CGST+SGST vs IGST against the client's state">
            <select className="inp" value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">Select a city…</option>
              {cities?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.gstStateCode})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due date">
            <input className="inp" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Line items</div>
        <table>
          <thead>
            <tr>
              <th style={{ width: "45%" }}>Description</th>
              <th style={{ width: 110 }}>HSN/SAC</th>
              <th style={{ width: 80 }} className="tright">
                Qty
              </th>
              <th style={{ width: 130 }} className="tright">
                Rate
              </th>
              <th style={{ width: 130 }} className="tright">
                Amount
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <input
                    className="inp"
                    style={{ width: "100%" }}
                    placeholder="Event management & production services"
                    value={it.description}
                    onChange={(e) => patchItem(idx, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="inp"
                    style={{ width: "100%" }}
                    placeholder="9963"
                    value={it.hsnSac}
                    onChange={(e) => patchItem(idx, { hsnSac: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="inp tright"
                    style={{ width: "100%" }}
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.qty}
                    onChange={(e) => patchItem(idx, { qty: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="inp tright"
                    style={{ width: "100%" }}
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.rate}
                    onChange={(e) => patchItem(idx, { rate: e.target.value })}
                  />
                </td>
                <td className="tright mono small">
                  {fmtINR((Number(it.qty) || 0) * (Number(it.rate) || 0))}
                </td>
                <td>
                  {items.length > 1 && (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <button className="btn-ghost btn-sm" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            + Add line
          </button>
          <div className="small" style={{ color: "var(--text-dim)" }}>
            Estimated taxable value <span className="mono">{fmtINR(previewTaxable)}</span> · GST is calculated by
            the server on issue
          </div>
        </div>
      </div>

      <div className="page-actions" style={{ marginTop: 16 }}>
        <button className="btn-primary" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create draft"}
        </button>
        <button className="btn-ghost" onClick={() => router.push("/invoices")}>
          Cancel
        </button>
      </div>
    </AppShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="small" style={{ color: "var(--text-dim)", fontWeight: 500 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="small" style={{ color: "var(--text-faint)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
