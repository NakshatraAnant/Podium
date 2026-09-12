"use client";

import { fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";
import type { CashFlowDto, CityOptionDto, ForecastDto, PnlActualsDto, PnlByCityDto } from "../../lib/types";

type Scope = "company" | "city";

/**
 * Reports / P&L (Phase C).
 *
 * The one rule this screen exists to enforce visually, not just structurally:
 * ACTUALS and FORECAST never appear as the same number, in the same card, or
 * added together anywhere on this page. They come from two separately-typed
 * API responses (`kind: "actuals"` vs `kind: "forecast"`) and are rendered in
 * two visually distinct sections with their own headers — a forecast card
 * carries a permanent "PROJECTION — NOT ACTUALS" label, and nothing on this
 * page ever sums a `netRevenue` with a `projectedNetRevenue`.
 *
 * Every figure shown is server-computed. This screen also replaces the
 * dashboard's old client-side sum of `project.revenue` (a bookings figure,
 * not real recognised revenue) with the actual P&L endpoint.
 */
export default function ReportsPage() {
  const [scope, setScope] = useState<Scope>("company");
  const [cityId, setCityId] = useState("");
  const [baseline, setBaseline] = useState("");

  const { data: cities } = useQuery({ queryKey: ["cities"], queryFn: () => api.get<CityOptionDto[]>("/cities") });

  const pnlQuery = useQuery({
    queryKey: ["reports-pnl", scope, cityId],
    queryFn: () =>
      api.get<PnlActualsDto>(`/reports/pnl?scope=${scope}${scope === "city" && cityId ? `&cityId=${cityId}` : ""}`),
    enabled: scope === "company" || Boolean(cityId),
  });
  const byCityQuery = useQuery({
    queryKey: ["reports-pnl-by-city"],
    queryFn: () => api.get<PnlByCityDto>("/reports/pnl/by-city"),
  });
  const cashFlowQuery = useQuery({
    queryKey: ["reports-cash-flow", cityId],
    queryFn: () => api.get<CashFlowDto>(`/reports/cash-flow${cityId ? `?cityId=${cityId}` : ""}`),
  });
  const forecastQuery = useQuery({
    queryKey: ["reports-forecast", cityId, baseline],
    queryFn: () =>
      api.get<ForecastDto>(
        `/reports/forecast?${cityId ? `cityId=${cityId}&` : ""}${baseline ? `baseline=${Number(baseline)}` : ""}`,
      ),
  });

  const pnl = pnlQuery.data;

  return (
    <AppShell crumb="Reports & P&L">
      <div className="page-head">
        <div>
          <div className="page-title">Reports &amp; P&amp;L</div>
          <div className="page-sub">
            Actuals are computed only from real invoices, payments, expenses and received purchase orders.
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <button className={`chipbtn ${scope === "company" ? "on" : ""}`} onClick={() => setScope("company")}>
            Company
          </button>
          <button className={`chipbtn ${scope === "city" ? "on" : ""}`} onClick={() => setScope("city")}>
            By city
          </button>
        </div>
        {scope === "city" && (
          <select className="inp" value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">Select a city…</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ============================================================ ACTUALS */}
      <SectionLabel>Actuals</SectionLabel>
      {pnlQuery.isLoading && <div className="empty">Loading…</div>}
      {pnl && !pnl.hasData && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="empty" style={{ padding: 20 }}>{pnl.explanation}</div>
        </div>
      )}
      {pnl && pnl.hasData && (
        <div className="grid g4" style={{ marginBottom: 18 }}>
          <Stat label="Net revenue (ex-GST)" value={fmtINR(pnl.revenue.netRevenue)} sub={`${pnl.revenue.invoiceCount} invoice(s)`} accent="green" />
          <Stat label="Collected" value={fmtINR(pnl.collections.received)} sub={`${fmtINR(pnl.collections.outstanding)} outstanding`} accent="blue" />
          <Stat label="Total costs" value={fmtINR(pnl.costs.total)} sub={`${fmtINR(pnl.costs.expenses)} expenses + ${fmtINR(pnl.costs.purchaseOrders)} POs`} accent="brass" />
          <Stat
            label="Gross margin"
            value={fmtINR(pnl.margin.grossMargin)}
            sub={pnl.margin.grossMarginPct === null ? "no revenue to divide by" : `${pnl.margin.grossMarginPct}%`}
            accent={pnl.margin.grossMargin >= 0 ? "green" : "red"}
          />
        </div>
      )}

      {pnl && pnl.hasData && (
        <div className="grid g2" style={{ marginBottom: 18 }}>
          <div className="panel">
            <div className="panel-title">Revenue breakdown</div>
            <Row label="Gross invoiced" value={fmtINR(pnl.revenue.grossInvoiced)} />
            <Row label="GST collected (held for the state, not revenue)" value={fmtINR(pnl.revenue.gstCollected)} />
            <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0" }} />
            <Row label="Net revenue" value={fmtINR(pnl.revenue.netRevenue)} strong />
          </div>
          <div className="panel">
            <div className="panel-title">Costs</div>
            <Row label="Approved / reimbursed expenses" value={fmtINR(pnl.costs.expenses)} />
            <Row label="Received purchase orders" value={fmtINR(pnl.costs.purchaseOrders)} />
            <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0" }} />
            <Row label="Total costs" value={fmtINR(pnl.costs.total)} strong />
          </div>
        </div>
      )}

      {/* ---- per-city breakdown, always available regardless of scope ---- */}
      {byCityQuery.data && byCityQuery.data.hasData && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-title">Per-city actuals</div>
          <table>
            <thead>
              <tr>
                <th>City</th>
                <th className="tright">Net revenue</th>
                <th className="tright">Collected</th>
                <th className="tright">Costs</th>
                <th className="tright">Gross margin</th>
              </tr>
            </thead>
            <tbody>
              {byCityQuery.data.cities.map((c) => (
                <tr key={c.city.id}>
                  <td>{c.city.name}</td>
                  {c.hasData ? (
                    <>
                      <td className="tright mono">{fmtINR(c.revenue.netRevenue)}</td>
                      <td className="tright mono">{fmtINR(c.collections.received)}</td>
                      <td className="tright mono">{fmtINR(c.costs.total)}</td>
                      <td className="tright mono" style={{ color: c.margin.grossMargin >= 0 ? "var(--green)" : "var(--red)" }}>
                        {fmtINR(c.margin.grossMargin)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="small" style={{ color: "var(--text-faint)" }}>
                      No real transactions in range
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- cash flow: real money in vs out, never invoice totals ---- */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-title">Cash flow — money received vs. money paid out, by month</div>
        {cashFlowQuery.data && !cashFlowQuery.data.hasData && (
          <div className="empty" style={{ padding: 20 }}>{cashFlowQuery.data.explanation}</div>
        )}
        {cashFlowQuery.data && cashFlowQuery.data.hasData && <CashFlowTable data={cashFlowQuery.data} />}
      </div>

      {/* =========================================================== FORECAST */}
      <SectionLabel tone="forecast">Forecast — projection only, never actuals</SectionLabel>
      <div className="panel" style={{ border: "1px dashed var(--brass)", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div className="panel-title" style={{ marginBottom: 0 }}>
            Projected net revenue
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="small" style={{ color: "var(--text-dim)" }}>Override monthly baseline (INR)</span>
            <input
              className="inp tright mono"
              style={{ width: 130 }}
              type="number"
              min="0"
              placeholder="auto"
              value={baseline}
              onChange={(e) => setBaseline(e.target.value)}
            />
          </label>
        </div>

        {forecastQuery.data && (
          <>
            <div
              className="small"
              style={{
                background: "var(--paper)",
                border: "1px solid var(--brass)",
                borderRadius: 6,
                padding: "8px 12px",
                margin: "12px 0",
                color: "var(--text-dim)",
              }}
            >
              ⚠ {forecastQuery.data.explanation}
            </div>

            {!forecastQuery.data.hasData ? (
              <div className="empty" style={{ padding: 10 }}>No forecast available.</div>
            ) : (
              <>
                <div className="small" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
                  Basis: {forecastQuery.data.basis === "caller_supplied_baseline" ? "your baseline override" : "trailing 12-month actuals"}
                  {forecastQuery.data.monthlyBaseline !== undefined && ` · ${fmtINR(forecastQuery.data.monthlyBaseline)}/mo`}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="tright">Seasonality</th>
                      <th className="tright">Projected net revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastQuery.data.series.map((m) => (
                      <tr key={m.month}>
                        <td className="mono small">{m.month}</td>
                        <td className="tright mono small">{m.seasonalityIndex.toFixed(2)}×</td>
                        <td className="tright mono" style={{ color: "var(--brass)" }}>{fmtINR(m.projectedNetRevenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function SectionLabel({ children, tone }: { children: React.ReactNode; tone?: "forecast" }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: tone === "forecast" ? "var(--brass)" : "var(--text-dim)",
        margin: "22px 0 10px",
      }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: "green" | "blue" | "brass" | "red" }) {
  return (
    <div className="stat" style={{ borderLeftColor: `var(--${accent})` }}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="d">{sub}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: strong ? 13.5 : 12.3 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className="mono" style={{ fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function CashFlowTable({ data }: { data: CashFlowDto }) {
  const maxAbs = useMemo(
    () => Math.max(1, ...data.series.flatMap((m) => [Math.abs(m.inflow), Math.abs(m.outflow)])),
    [data.series],
  );
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th className="tright">Inflow</th>
            <th className="tright">Outflow</th>
            <th className="tright">Net</th>
            <th style={{ width: 160 }}></th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((m) => (
            <tr key={m.month}>
              <td className="mono small">{m.month}</td>
              <td className="tright mono" style={{ color: "var(--green)" }}>{fmtINR(m.inflow)}</td>
              <td className="tright mono" style={{ color: "var(--red)" }}>{fmtINR(m.outflow)}</td>
              <td className="tright mono" style={{ fontWeight: 600 }}>{fmtINR(m.net)}</td>
              <td>
                <div style={{ display: "flex", height: 8, gap: 2, background: "var(--paper)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(Math.abs(m.inflow) / maxAbs) * 100}%`, background: "var(--green)" }} />
                  <div style={{ width: `${(Math.abs(m.outflow) / maxAbs) * 100}%`, background: "var(--red)" }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 8 }}>
        <Row label="Total inflow" value={fmtINR(data.totals.inflow)} />
        <Row label="Total outflow" value={fmtINR(data.totals.outflow)} />
        <Row label="Net" value={fmtINR(data.totals.net)} strong />
      </div>
    </>
  );
}
