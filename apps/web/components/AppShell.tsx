"use client";

import { initials } from "@podium/ui";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { NotificationBell } from "./NotificationBell";

const NAV_GROUPS: Array<{ label: string; items: Array<{ href: string; icon: string; label: string }> }> = [
  {
    label: "",
    items: [
      { href: "/dashboard", icon: "⌂", label: "Home" },
      { href: "/flows", icon: "⇢", label: "Flows" },
      { href: "/chat", icon: "✎", label: "Chat" },
    ],
  },
  {
    label: "Sales & CRM",
    items: [
      { href: "/pipeline", icon: "⌬", label: "Pipeline" },
      { href: "/leads", icon: "☍", label: "Leads" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/projects", icon: "◧", label: "Projects" },
      { href: "/tasks", icon: "☑", label: "Tasks" },
      { href: "/risks", icon: "⚠", label: "Risks & Issues" },
      { href: "/playbooks", icon: "❧", label: "Playbooks" },
      { href: "/documents", icon: "▧", label: "Documents" },
    ],
  },
  {
    label: "Bar & stock",
    items: [
      { href: "/inventory", icon: "▣", label: "Inventory" },
      { href: "/procurement", icon: "⛁", label: "Procurement" },
      { href: "/menu", icon: "☕", label: "Menu Costing" },
    ],
  },
  {
    label: "Revenue & money",
    items: [
      { href: "/clients", icon: "☺", label: "Clients" },
      { href: "/invoices", icon: "₹", label: "Invoices" },
      { href: "/expenses", icon: "⇄", label: "Expenses" },
      { href: "/reports", icon: "▤", label: "Reports & P&L" },
    ],
  },
  {
    label: "People & governance",
    items: [
      { href: "/compliance", icon: "§", label: "Compliance" },
      { href: "/approvals", icon: "✓", label: "Approvals" },
    ],
  },
];

export function AppShell({ children, crumb }: { children: ReactNode; crumb: string }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="center-screen">
        <div className="muted">Loading Podium…</div>
      </div>
    );
  }

  return (
    <div id="app">
      <aside className="sidebar">
        <div className="brandmark">
          <div className="mark">P</div>
          <div className="names">
            <div className="company">Podium</div>
            <div className="sub">AMM Brands LLP</div>
          </div>
        </div>
        {NAV_GROUPS.map((group, i) => (
          <div className="navgroup" key={i}>
            {group.label && <div className="label">{group.label}</div>}
            {group.items.map((item) => (
              <div
                key={item.href}
                className={`navitem ${pathname?.startsWith(item.href) ? "active" : ""}`}
                onClick={() => router.push(item.href)}
              >
                <span className="ic">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        ))}
        <div className="navfooter">
          <div className="user">
            <div className="avatar">{initials(user.name)}</div> {user.name.split(" ")[0]} · {user.roles[0]}
          </div>
          <span className="linkish" onClick={logout} style={{ color: "#9CA0A5" }}>
            Sign out
          </span>
        </div>
      </aside>
      <header className="topbar">
        <div className="crumb">
          <b>{crumb}</b>
        </div>
        <div className="searchbtn">
          <span>⌕</span>
          <span>Search projects, flows, people, invoices, stock…</span>
        </div>
        <div className="topbar-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NotificationBell />
          <button className="topbar-avatar" title={user.name}>
            {initials(user.name)}
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
