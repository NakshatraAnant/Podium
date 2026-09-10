"use client";

import { fmtDate, fmtINR } from "@podium/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { StatusPill } from "../../components/StatusPill";
import { api } from "../../lib/api";
import type { ProjectDto } from "../../lib/types";

export default function ProjectsPage() {
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectDto[]>("/projects") });

  return (
    <AppShell crumb="Projects">
      <div className="page-head">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-sub">{data?.length ?? 0} projects · {data?.filter((p) => p.status !== "COMPLETED").length ?? 0} active</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="plist">
        {data?.map((p) => (
          <div key={p.id} className="pcard" onClick={() => router.push(`/projects/${p.id}`)}>
            <span className={`health-dot ${p.health}`} />
            <div className="pbar">
              <div className="pname">{p.name}</div>
              <div className="pmeta">
                {p.type} · {p.city.name} · Client: {p.client.name} · PM {p.pm.name}
              </div>
            </div>
            <div className="pright">
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{fmtINR(Number(p.revenue))}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>revenue · {fmtDate(p.eventDate)}</div>
              </div>
              <StatusPill status={p.status} />
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
