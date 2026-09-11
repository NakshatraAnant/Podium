"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";

interface ClientDto {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  ltv: string;
  since: string | null;
  /** Null for imported clients whose source sheet carried no city. */
  city: { name: string } | null;
  projects: unknown[];
}

interface ClientPage {
  total: number;
  limit: number;
  offset: number;
  rows: ClientDto[];
}

type Segment = "EVENT_CLIENT" | "RETAIL_CUSTOMER";

const PAGE = 50;

/**
 * Two segments live in `clients`: the real, name-rich B2B event accounts and
 * the Cocktail Shop retail dump, which outnumbers them ~90:1. The screen
 * opens on event clients and only shows retail when explicitly asked, which
 * is the whole point of the `client_segment` column.
 */
export default function ClientsPage() {
  const [segment, setSegment] = useState<Segment>("EVENT_CLIENT");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["clients", segment, search, offset],
    queryFn: () =>
      api.get<ClientPage>(
        `/clients?segment=${segment}&limit=${PAGE}&offset=${offset}` + (search ? `&search=${encodeURIComponent(search)}` : ""),
      ),
    placeholderData: keepPreviousData,
  });

  function pick(next: Segment) {
    setSegment(next);
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const shown = data?.rows.length ?? 0;

  return (
    <AppShell crumb="Clients">
      <div className="page-head">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-sub">
            {total.toLocaleString("en-IN")} {segment === "EVENT_CLIENT" ? "event client accounts" : "Cocktail Shop retail customers"}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="chips">
          <button type="button" className={`chipbtn${segment === "EVENT_CLIENT" ? " on" : ""}`} onClick={() => pick("EVENT_CLIENT")}>
            Event clients
          </button>
          <button type="button" className={`chipbtn${segment === "RETAIL_CUSTOMER" ? " on" : ""}`} onClick={() => pick("RETAIL_CUSTOMER")}>
            Cocktail Shop retail
          </button>
        </div>
        <div className="field" style={{ maxWidth: 260 }}>
          <input
            value={search}
            placeholder="Search by name…"
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>

      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th>Phone</th>
              <th>City</th>
              <th className="tright">Lifetime value</th>
              <th>Client since</th>
              <th className="tright">Active projects</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((c) => (
              <tr key={c.id} className="rowhover">
                <td>{c.name}</td>
                <td>
                  <span className="pill blue">{c.type}</span>
                </td>
                <td className="mono">{c.phone ?? "—"}</td>
                <td>{c.city?.name ?? "—"}</td>
                <td className="tright mono">{fmtINR(Number(c.ltv))}</td>
                <td className="mono">{c.since ? fmtDate(c.since) : "—"}</td>
                <td className="tright mono">{c.projects?.length ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ← Previous
          </button>
          <span className="mono" style={{ fontSize: 12 }}>
            {shown === 0 ? 0 : offset + 1}–{offset + shown} of {total.toLocaleString("en-IN")}
          </span>
          <button type="button" className="btn-ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            Next →
          </button>
        </div>
      )}
    </AppShell>
  );
}
