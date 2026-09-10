"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";

interface BalanceDto {
  id: string;
  qtyOnHand: number;
  reorderLevel: number;
  item: { name: string; sku: string; unit: string };
  location: { name: string; city: { name: string } };
}

export default function InventoryPage() {
  const { data, isLoading } = useQuery({ queryKey: ["inventory-balances"], queryFn: () => api.get<BalanceDto[]>("/inventory/balances") });

  return (
    <AppShell crumb="Inventory">
      <div className="page-head">
        <div>
          <div className="page-title">Inventory</div>
          <div className="page-sub">Stock per city store vs. reorder point — derived from the movement ledger, never edited directly</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th>Store</th>
              <th className="tright">On hand</th>
              <th className="tright">Reorder level</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((b) => {
              const low = b.qtyOnHand < b.reorderLevel;
              return (
                <tr key={b.id} className={low ? "" : undefined}>
                  <td className="mono small">{b.item.sku}</td>
                  <td>{b.item.name}</td>
                  <td className="small">{b.location.city.name}</td>
                  <td className={`tright mono ${low ? "negative" : ""}`} style={low ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                    {b.qtyOnHand} {b.item.unit}
                  </td>
                  <td className="tright mono">{b.reorderLevel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
