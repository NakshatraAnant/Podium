"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { api } from "../../lib/api";

interface ChannelDto {
  id: string;
  name: string;
  kind: string;
}
interface MessageDto {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export default function ChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { data: channels } = useQuery({ queryKey: ["channels"], queryFn: () => api.get<ChannelDto[]>("/channels") });
  const active = activeId ?? channels?.[0]?.id;
  const { data: messages } = useQuery({
    queryKey: ["messages", active],
    queryFn: () => api.get<MessageDto[]>(`/channels/${active}/messages`),
    enabled: !!active,
  });
  const post = useMutation({
    mutationFn: (body: string) => api.post(`/channels/${active}/messages`, { body }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["messages", active] });
    },
  });

  return (
    <AppShell crumb="Chat">
      <div className="chat">
        <div className="chat-side">
          <div className="grp">Channels</div>
          {channels?.map((c) => (
            <div key={c.id} className={`chrow ${active === c.id ? "on" : ""}`} onClick={() => setActiveId(c.id)}>
              <span className="hash">#</span>
              {c.name}
            </div>
          ))}
        </div>
        <div className="chat-main">
          <div className="chat-head">
            <div className="nm">#{channels?.find((c) => c.id === active)?.name}</div>
          </div>
          <div className="msgs">
            {[...(messages ?? [])].reverse().map((m) => (
              <div key={m.id} className={`msg ${!m.authorId ? "botmsg" : ""}`}>
                <div className="av-s bot">{m.authorId ? "U" : "P"}</div>
                <div className="body">
                  <div className="tx">{m.body}</div>
                </div>
              </div>
            ))}
            {messages?.length === 0 && <div className="empty">No messages yet.</div>}
          </div>
          <div className="composer">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message this channel…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
                  e.preventDefault();
                  post.mutate(draft.trim());
                }
              }}
            />
            <button className="btn-primary" disabled={!draft.trim()} onClick={() => draft.trim() && post.mutate(draft.trim())}>
              Send
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
