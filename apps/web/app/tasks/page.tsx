"use client";

import { fmtDate } from "@podium/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";
import type { TaskDto } from "../../lib/types";

const STATUS_COLS = ["BACKLOG", "PLANNED", "IN_PROGRESS", "CLIENT_REVIEW", "APPROVED", "COMPLETED"] as const;
const COL_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  CLIENT_REVIEW: "Client Review",
  APPROVED: "Approved",
  COMPLETED: "Completed",
};

export default function TasksPage() {
  const qc = useQueryClient();
  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => api.get<TaskDto[]>("/tasks") });

  const updateStatus = useMutation({
    mutationFn: ({ id, status, expectedUpdatedAt }: { id: string; status: string; expectedUpdatedAt: string }) =>
      api.patch(`/tasks/${id}`, { status, expectedUpdatedAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return (
    <AppShell crumb="Tasks">
      <div className="page-head">
        <div>
          <div className="page-title">Tasks</div>
          <div className="page-sub">{tasks?.length ?? 0} tasks across all projects</div>
        </div>
      </div>
      {isLoading && <div className="empty">Loading…</div>}
      <div className="kanban">
        {STATUS_COLS.map((col) => {
          const items = (tasks ?? []).filter((t) => t.status === col);
          return (
            <div className="kcol" key={col}>
              <div className="kcol-head">
                <span>{COL_LABEL[col]}</span>
                <span className="n">{items.length}</span>
              </div>
              {items.map((t) => {
                const late = t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== "COMPLETED";
                return (
                  <div className="kcard" key={t.id}>
                    <div className="t">{t.name}</div>
                    <div className="foot">
                      <span className={`due ${late ? "late" : ""}`}>{t.dueAt ? fmtDate(t.dueAt) : "—"}</span>
                      <select
                        className="inp btn-sm"
                        value={t.status}
                        onChange={(e) => updateStatus.mutate({ id: t.id, status: e.target.value, expectedUpdatedAt: t.updatedAt })}
                      >
                        {STATUS_COLS.map((s) => (
                          <option key={s} value={s}>
                            {COL_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && <div className="small faint" style={{ padding: 8 }}>Empty</div>}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
