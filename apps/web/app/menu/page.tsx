"use client";

import { fmtINR } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api, ApiError } from "../../lib/api";
import type { InventoryItemOptionDto, RecipeDto } from "../../lib/types";

interface DraftLine { skuId: string; qtyMl: string }

/**
 * Menu costing (Phase E, blueprint §19/§40). Every cost/margin figure shown
 * comes from the server's `costing` field, computed live from real
 * inventory_items.standard_cost/size_ml — never recomputed or trusted from
 * this page except as an in-progress preview while editing, which is
 * clearly not what gets saved (the server recomputes on every read anyway).
 */
export default function MenuCostingPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RecipeDto | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: recipes, isLoading } = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api.get<RecipeDto[]>("/recipes"),
  });
  const { data: skus } = useQuery({
    queryKey: ["inventory-items"],
    queryFn: () => api.get<InventoryItemOptionDto[]>("/inventory/items"),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["recipes"] });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/recipes/${id}`),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <AppShell crumb="Menu Costing">
      <div className="page-head">
        <div>
          <div className="page-title">Menu Costing</div>
          <div className="page-sub">Real ingredient cost and margin, computed server-side from live inventory pricing.</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setEditing("new")}>New recipe</button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <span className="small">{error}</span>
          <button className="btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {editing && (
        <RecipeEditor
          recipe={editing === "new" ? null : editing}
          skus={skus ?? []}
          onDone={() => { setEditing(null); setError(null); refresh(); }}
          onCancel={() => setEditing(null)}
          onError={(e) => setError(e.message)}
        />
      )}

      <div className="panel">
        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && (recipes?.length ?? 0) === 0 && <div className="empty">No recipes yet.</div>}
        {(recipes?.length ?? 0) > 0 && (
          <table>
            <thead>
              <tr>
                <th>Recipe</th>
                <th>Glass</th>
                <th className="tright">Price</th>
                <th className="tright">Cost</th>
                <th className="tright">Margin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recipes!.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="small">{r.glass}</td>
                  <td className="tright mono">{fmtINR(Number(r.price))}</td>
                  <td className="tright mono">
                    {r.costing.allCostable ? fmtINR(r.costing.totalCost!) : <span style={{ color: "var(--text-faint)" }}>not costable</span>}
                  </td>
                  <td className="tright mono" style={{ color: !r.costing.allCostable ? "var(--text-faint)" : r.costing.margin! < 0 ? "var(--red)" : "var(--green)" }}>
                    {r.costing.allCostable ? `${fmtINR(r.costing.margin!)} (${r.costing.marginPct}%)` : "—"}
                  </td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(r)}>Edit</button>
                    <button className="btn-warn btn-sm" onClick={() => remove.mutate(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function RecipeEditor({
  recipe,
  skus,
  onDone,
  onCancel,
  onError,
}: {
  recipe: RecipeDto | null;
  skus: InventoryItemOptionDto[];
  onDone: () => void;
  onCancel: () => void;
  onError: (e: ApiError) => void;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [glass, setGlass] = useState(recipe?.glass ?? "");
  const [garnishCost, setGarnishCost] = useState(recipe ? String(Number(recipe.garnishCost)) : "0");
  const [price, setPrice] = useState(recipe ? String(Number(recipe.price)) : "");
  const [lines, setLines] = useState<DraftLine[]>(
    recipe?.items.length ? recipe.items.map((i) => ({ skuId: i.skuId, qtyMl: String(i.qtyMl) })) : [{ skuId: "", qtyMl: "" }],
  );

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        glass: glass.trim(),
        garnishCost: Number(garnishCost) || 0,
        price: Number(price),
        items: lines.filter((l) => l.skuId && l.qtyMl).map((l) => ({ skuId: l.skuId, qtyMl: Number(l.qtyMl) })),
      };
      return recipe ? api.patch(`/recipes/${recipe.id}`, payload) : api.post("/recipes", payload);
    },
    onSuccess: onDone,
    onError: (e: ApiError) => onError(e),
  });

  const patch = (i: number, p: Partial<DraftLine>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  // Live preview only — the server recomputes this from scratch on save/read.
  let previewCost = 0;
  let previewAllCostable = true;
  for (const l of lines) {
    if (!l.skuId || !l.qtyMl) continue;
    const sku = skus.find((s) => s.id === l.skuId);
    if (!sku || !sku.sizeMl) { previewAllCostable = false; continue; }
    previewCost += Number(l.qtyMl) * (Number(sku.standardCost) / sku.sizeMl);
  }
  previewCost += Number(garnishCost) || 0;
  const previewMargin = Number(price) > 0 ? Number(price) - previewCost : null;

  const valid = name.trim() && glass.trim() && Number(price) > 0 && lines.some((l) => l.skuId && l.qtyMl);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">{recipe ? "Edit recipe" : "New recipe"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 14 }}>
        <Field label="Name">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gin & Tonic" />
        </Field>
        <Field label="Glass">
          <input className="inp" value={glass} onChange={(e) => setGlass(e.target.value)} placeholder="Highball" />
        </Field>
        <Field label="Garnish cost (INR)">
          <input className="inp tright mono" type="number" min="0" step="0.01" value={garnishCost} onChange={(e) => setGarnishCost(e.target.value)} />
        </Field>
        <Field label="Menu price (INR)">
          <input className="inp tright mono" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th className="tright" style={{ width: 120 }}>Qty (ml)</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select className="inp" style={{ width: "100%" }} value={l.skuId} onChange={(e) => patch(i, { skuId: e.target.value })}>
                  <option value="">Select a SKU…</option>
                  {skus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sku}){!s.sizeMl && " — no size, not costable"}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input className="inp tright" style={{ width: "100%" }} type="number" min="1" value={l.qtyMl} onChange={(e) => patch(i, { qtyMl: e.target.value })} />
              </td>
              <td>
                {lines.length > 1 && (
                  <button className="btn-ghost btn-sm" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}>×</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setLines((prev) => [...prev, { skuId: "", qtyMl: "" }])}>
        + Add ingredient
      </button>

      <div className="small" style={{ color: "var(--text-faint)", marginTop: 12 }}>
        Preview only — recalculated from scratch by the server on save.{" "}
        {previewAllCostable ? (
          <>Estimated cost {fmtINR(previewCost)}{previewMargin !== null && ` · margin ${fmtINR(previewMargin)}`}</>
        ) : (
          "One or more ingredients has no size set — the saved recipe will show as not costable."
        )}
      </div>

      <div className="page-actions" style={{ marginTop: 14 }}>
        <button className="btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save recipe"}
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
