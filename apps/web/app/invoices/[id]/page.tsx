"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "../../../components/AppShell";
import { StatusPill } from "../../../components/StatusPill";
import { api, apiDownload, ApiError } from "../../../lib/api";
import type { InvoiceDetailDto } from "../../../lib/types";

const num = (v: string | number) => Number(v);

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<"payment" | "credit" | "debit" | null>(null);

  const { data: inv, isLoading } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDetailDto>(`/invoices/${id}`),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["invoice", id] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };
  const onError = (e: ApiError) => setError(e.message);

  const issue = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/issue`),
    onSuccess: () => { setError(null); setNotice("Invoice issued — its number and GST split are now final."); refresh(); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/invoices/${id}/cancel`, { reason: reason || undefined }),
    onSuccess: () => { setError(null); router.push("/invoices"); },
    onError,
  });
  const email = useMutation({
    mutationFn: () => api.post<{ to: string; mode: string }>(`/invoices/${id}/email`),
    onSuccess: (r) => {
      setError(null);
      setNotice(
        r.mode === "sandbox"
          ? `E-mail is in sandbox mode — the message to ${r.to} was rendered but deliberately NOT sent.`
          : `Invoice e-mailed to ${r.to}.`,
      );
    },
    onError,
  });

  if (isLoading || !inv) {
    return (
      <AppShell crumb="Invoices">
        <div className="empty">Loading…</div>
      </AppShell>
    );
  }

  const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
  const credited = inv.creditNotes.reduce((s, n) => s + num(n.amount), 0);
  const debited = inv.debitNotes.reduce((s, n) => s + num(n.amount), 0);
  const balance = num(inv.total) - paid - credited + debited;
  const isDraft = inv.status === "DRAFT";
  const intra = num(inv.igst) === 0;

  return (
    <AppShell crumb={`Invoices / ${inv.invoiceNo}`}>
      <div className="page-head">
        <div>
          <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="mono">{inv.invoiceNo}</span>
            <StatusPill status={inv.status} />
          </div>
          <div className="page-sub">
            {inv.client.name} · {inv.project.name} · billed from {inv.city.name} ({inv.city.gstStateCode}) → place of
            supply {inv.placeOfSupply}
          </div>
        </div>
        <div className="page-actions">
          {isDraft && (
            <button className="btn-primary" onClick={() => issue.mutate()} disabled={issue.isPending}>
              {issue.isPending ? "Issuing…" : "Issue invoice"}
            </button>
          )}
          {!isDraft && (
            <>
              <button
                className="btn-ghost"
                onClick={() =>
                  apiDownload(`/invoices/${id}/pdf`, `${inv.invoiceNo.replace(/\//g, "-")}.pdf`).catch((e) =>
                    onError(e as ApiError),
                  )
                }
              >
                Download PDF
              </button>
              <button className="btn-ghost" onClick={() => email.mutate()} disabled={email.isPending}>
                {email.isPending ? "Sending…" : "E-mail invoice"}
              </button>
              <button className="btn-ghost" onClick={() => setPanel(panel === "credit" ? null : "credit")}>
                Credit note
              </button>
              <button className="btn-ghost" onClick={() => setPanel(panel === "debit" ? null : "debit")}>
                Debit note
              </button>
              {inv.status !== "PAID" && (
                <button className="btn-primary" onClick={() => setPanel(panel === "payment" ? null : "payment")}>
                  Record payment
                </button>
              )}
            </>
          )}
          {isDraft && <CancelButton onCancel={(reason) => cancel.mutate(reason)} pending={cancel.isPending} />}
        </div>
      </div>

      {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="info" onDismiss={() => setNotice(null)}>{notice}</Banner>}

      {panel === "payment" && (
        <AmountForm
          title="Record a payment"
          submitLabel="Record payment"
          withMethod
          onCancel={() => setPanel(null)}
          onSubmit={async ({ amount, method }) => {
            try {
              await api.post(`/invoices/${id}/payments`, { amount, method });
              setPanel(null);
              setError(null);
              refresh();
            } catch (e) { onError(e as ApiError); }
          }}
        />
      )}
      {panel === "credit" && (
        <AmountForm
          title="Raise a credit note"
          hint="An issued invoice is immutable — a credit note is the correction path, never an edit."
          submitLabel="Create credit note"
          withReason
          onCancel={() => setPanel(null)}
          onSubmit={async ({ amount, reason }) => {
            try {
              await api.post(`/invoices/${id}/credit-notes`, { amount, reason });
              setPanel(null);
              setError(null);
              refresh();
            } catch (e) { onError(e as ApiError); }
          }}
        />
      )}
      {panel === "debit" && (
        <AmountForm
          title="Raise a debit note"
          submitLabel="Create debit note"
          withReason
          onCancel={() => setPanel(null)}
          onSubmit={async ({ amount, reason }) => {
            try {
              await api.post(`/invoices/${id}/debit-notes`, { amount, reason });
              setPanel(null);
              setError(null);
              refresh();
            } catch (e) { onError(e as ApiError); }
          }}
        />
      )}

      <div className="grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div className="panel-title">Line items</div>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>HSN/SAC</th>
                  <th className="tright">Qty</th>
                  <th className="tright">Rate</th>
                  <th className="tright">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td className="mono small">{it.hsnSac ?? "—"}</td>
                    <td className="tright mono">{num(it.qty)}</td>
                    <td className="tright mono">{fmtINR(num(it.rate))}</td>
                    <td className="tright mono">{fmtINR(num(it.qty) * num(it.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {inv.payments.length > 0 && (
            <div className="panel">
              <div className="panel-title">Payments</div>
              <table>
                <thead>
                  <tr><th>Received</th><th>Method</th><th className="tright">Amount</th></tr>
                </thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono small">{fmtDate(p.receivedAt)}</td>
                      <td className="small">{p.method}</td>
                      <td className="tright mono">{fmtINR(num(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(inv.creditNotes.length > 0 || inv.debitNotes.length > 0) && (
            <div className="panel">
              <div className="panel-title">Adjustment notes</div>
              <table>
                <thead>
                  <tr><th>Type</th><th>Reason</th><th className="tright">Amount</th></tr>
                </thead>
                <tbody>
                  {inv.creditNotes.map((n) => (
                    <tr key={n.id}><td>Credit</td><td className="small">{n.reason}</td><td className="tright mono">− {fmtINR(num(n.amount))}</td></tr>
                  ))}
                  {inv.debitNotes.map((n) => (
                    <tr key={n.id}><td>Debit</td><td className="small">{n.reason}</td><td className="tright mono">+ {fmtINR(num(n.amount))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div className="panel-title">GST breakdown</div>
            <Row label="Taxable value" value={fmtINR(num(inv.taxableAmount))} />
            {intra ? (
              <>
                <Row label="CGST @ 9%" value={fmtINR(num(inv.cgst))} />
                <Row label="SGST @ 9%" value={fmtINR(num(inv.sgst))} />
              </>
            ) : (
              <Row label="IGST @ 18%" value={fmtINR(num(inv.igst))} />
            )}
            <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
            <Row label="Total" value={fmtINR(num(inv.total))} strong />
            {isDraft && (
              <div className="small" style={{ color: "var(--text-faint)", marginTop: 8 }}>
                GST is computed when the invoice is issued — these are zero until then.
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">Position</div>
            <Row label="Invoice total" value={fmtINR(num(inv.total))} />
            <Row label="Paid" value={fmtINR(paid)} />
            {credited > 0 && <Row label="Credit notes" value={`− ${fmtINR(credited)}`} />}
            {debited > 0 && <Row label="Debit notes" value={`+ ${fmtINR(debited)}`} />}
            <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
            <Row label="Balance due" value={fmtINR(balance)} strong tone={balance > 0 ? "red" : "green"} />
          </div>

          <div className="panel">
            <div className="panel-title">Dates</div>
            <Row label="Issued" value={inv.issueDate ? fmtDate(inv.issueDate) : "—"} />
            <Row label="Due" value={fmtDate(inv.dueDate)} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "red" | "green" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: strong ? 13.5 : 12.3 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span
        className="mono"
        style={{
          fontWeight: strong ? 600 : 400,
          color: tone === "red" ? "var(--red)" : tone === "green" ? "var(--green)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Banner({ tone, children, onDismiss }: { tone: "error" | "info"; children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      className="panel"
      style={{
        marginBottom: 14,
        borderColor: tone === "error" ? "var(--red)" : "var(--line)",
        color: tone === "error" ? "var(--red)" : "var(--text)",
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span className="small">{children}</span>
      <button className="btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function CancelButton({ onCancel, pending }: { onCancel: (reason: string) => void; pending: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  if (!confirming) {
    return <button className="btn-warn" onClick={() => setConfirming(true)}>Cancel draft</button>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input className="inp" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn-warn" disabled={pending} onClick={() => onCancel(reason)}>
        {pending ? "Cancelling…" : "Confirm cancel"}
      </button>
      <button className="btn-ghost btn-sm" onClick={() => setConfirming(false)}>Keep</button>
    </span>
  );
}

function AmountForm({
  title,
  hint,
  submitLabel,
  withMethod,
  withReason,
  onSubmit,
  onCancel,
}: {
  title: string;
  hint?: string;
  submitLabel: string;
  withMethod?: boolean;
  withReason?: boolean;
  onSubmit: (v: { amount: number; method: string; reason: string }) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reason, setReason] = useState("");
  const valid = Number(amount) > 0 && (!withReason || reason.trim().length > 0);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">{title}</div>
      {hint && <div className="small" style={{ color: "var(--text-faint)", marginBottom: 10 }}>{hint}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="small" style={{ color: "var(--text-dim)" }}>Amount (INR)</span>
          <input className="inp tright mono" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {withMethod && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="small" style={{ color: "var(--text-dim)" }}>Method</span>
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
              {["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "CARD", "OTHER"].map((m) => (
                <option key={m} value={m}>{m.replace("_", " ")}</option>
              ))}
            </select>
          </label>
        )}
        {withReason && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
            <span className="small" style={{ color: "var(--text-dim)" }}>Reason</span>
            <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this adjustment is being raised" />
          </label>
        )}
        <button className="btn-primary" disabled={!valid} onClick={() => onSubmit({ amount: Number(amount), method, reason: reason.trim() })}>
          {submitLabel}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
