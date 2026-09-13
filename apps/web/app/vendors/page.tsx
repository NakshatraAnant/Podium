"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api, ApiError } from "../../lib/api";
import type { CityOptionDto, VendorDto } from "../../lib/types";

/**
 * Phase I: the vendor master (blueprint screen 17) has had a real, tested
 * CRUD backend since the procurement build — every purchase request already
 * picks a vendor from it — but nothing ever rendered the master list or
 * detail on its own. Procurement's own dropdown only ever showed a name.
 */
export default function VendorsPage() {
  const qc = useQueryClient();
  const [cityId, setCityId] = useState("");
  const [editing, setEditing] = useState<VendorDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: cities } = useQuery({ queryKey: ["cities"], queryFn: () => api.get<CityOptionDto[]>("/cities") });
  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors", cityId],
    queryFn: () => api.get<VendorDto[]>(`/vendors${cityId ? `?cityId=${cityId}` : ""}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["vendors"] });

  return (
    <AppShell crumb="Vendors">
      <div className="page-head">
        <div>
          <div className="page-title">Vendors</div>
          <div className="page-sub">{(vendors?.length ?? 0).toLocaleString("en-IN")} vendors on file</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEditing("new")}>New vendor</button>
        </div>
      </div>

      <div className="toolbar">
        <select className="inp" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">All cities</option>
          {cities?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <span className="small">{error}</span>
          <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {editing && (
        <VendorEditor
          vendor={editing === "new" ? null : editing}
          cities={cities ?? []}
          onDone={() => { setEditing(null); setError(null); refresh(); }}
          onCancel={() => setEditing(null)}
          onError={(e) => setError(e.message)}
        />
      )}

      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Category</th>
              <th>City</th>
              <th>Contact</th>
              <th className="tright">Rating</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vendors?.map((v) => (
              <tr key={v.id} className="rowhover">
                <td>{v.name}</td>
                <td className="small">{v.category ?? "—"}</td>
                <td>{cities?.find((c) => c.id === v.cityId)?.name ?? "—"}</td>
                <td className="small">{v.contactName ?? v.phone ?? v.email ?? "—"}</td>
                <td className="tright mono">{v.rating !== null ? Number(v.rating).toFixed(1) : "—"}</td>
                <td><StatusPill status={v.status} /></td>
                <td>
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(v)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && (vendors?.length ?? 0) === 0 && <div className="empty">No vendors match this filter.</div>}
      </div>
    </AppShell>
  );
}

function VendorEditor({
  vendor,
  cities,
  onDone,
  onCancel,
  onError,
}: {
  vendor: VendorDto | null;
  cities: CityOptionDto[];
  onDone: () => void;
  onCancel: () => void;
  onError: (e: ApiError) => void;
}) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [category, setCategory] = useState(vendor?.category ?? "");
  const [cityId, setCityId] = useState(vendor?.cityId ?? "");
  const [contactName, setContactName] = useState(vendor?.contactName ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [gstin, setGstin] = useState(vendor?.gstin ?? "");
  const [rating, setRating] = useState(vendor?.rating !== null && vendor?.rating !== undefined ? String(Number(vendor.rating)) : "");
  const [status, setStatus] = useState<VendorDto["status"]>(vendor?.status ?? "APPROVED");

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        category: category.trim(),
        cityId,
        contactName: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        rating: rating ? Number(rating) : undefined,
        gstin: gstin.trim() || undefined,
        status,
      };
      return vendor ? api.patch(`/vendors/${vendor.id}`, payload) : api.post("/vendors", payload);
    },
    onSuccess: onDone,
    onError: (e: ApiError) => onError(e),
  });

  const valid = name.trim() && category.trim() && cityId;

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">{vendor ? "Edit vendor" : "New vendor"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 14 }}>
        <Field label="Name">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rajwada Caterers" />
        </Field>
        <Field label="Category">
          <input className="inp" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catering, Production…" />
        </Field>
        <Field label="City">
          <select className="inp" value={cityId} onChange={(e) => setCityId(e.target.value)}>
            <option value="">Select a city…</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="inp" value={status} onChange={(e) => setStatus(e.target.value as VendorDto["status"])}>
            <option value="APPROVED">Approved</option>
            <option value="PREFERRED">Preferred</option>
            <option value="BLACKLISTED">Blacklisted</option>
          </select>
        </Field>
        <Field label="Contact name">
          <input className="inp" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Address">
          <input className="inp" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="GSTIN">
          <input className="inp" value={gstin} onChange={(e) => setGstin(e.target.value)} />
        </Field>
        <Field label="Rating (0–5)">
          <input className="inp tright mono" type="number" min="0" max="5" step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} />
        </Field>
      </div>
      <div className="page-actions">
        <button className="btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save vendor"}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="small" style={{ color: "var(--text-dim)", fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}
