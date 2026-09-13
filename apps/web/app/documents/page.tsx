"use client";

import { AppShell } from "../../components/AppShell";
import { DocumentsPanel } from "../../components/DocumentsPanel";

export default function DocumentsPage() {
  return (
    <AppShell crumb="Documents">
      <div className="page-head">
        <div>
          <div className="page-title">Documents</div>
          <div className="page-sub">Contracts, designs, permits, and other files — versioned, stored per project or workspace-wide.</div>
        </div>
      </div>
      <DocumentsPanel />
    </AppShell>
  );
}
