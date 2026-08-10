"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

type Message = { id: string; senderId: string; content: string; createdAt: string };

// Messagerie de mission — aligné sur formulaires-flexwork-tous-profils.html.
// Polling 4s, blocage fuite hors plateforme (US-1301).
export default function ChatPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/messages`);
    if (res.ok) setMessages((await res.json()).items);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      setContent("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "message_blocked_leakage_attempt" ? "Message bloqué : partage de coordonnées ou de paiement direct détecté." : "Échec de l'envoi.");
    }
  }

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">💬 Messagerie de mission</span>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="chat-container" ref={containerRef}>
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble ${m.senderId === userId ? "chat-right" : "chat-left"}`}>
              {m.content}
            </div>
          ))}
        </div>

        <form onSubmit={send} style={{ display: "flex", gap: 10 }}>
          <input type="text" placeholder="Votre message..." style={{ flex: 1 }} value={content} onChange={(e) => setContent(e.target.value)} />
          <button type="submit" className="btn btn-primary">Envoyer</button>
        </form>
      </div>
    </div>
  );
}
