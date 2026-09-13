"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Video } from "lucide-react";
import { Avatar } from "@/components/avatar";
import CallPanel from "@/components/chat/CallPanel";
import { useWebRTC } from "@/lib/webrtc/useWebRTC";

type Props = {
  missionId: string;
  currentUserId: string;
  interlocutorId: string;
  interlocutorName: string;
  interlocutorAvatarPath?: string | null;
};

type ThreadMessage = {
  id: string;
  content: string;
  createdAt: string;
  sent: boolean;
  type: string;
  fileName: string | null;
  url: string | null;
};

const QUICK_REPLIES = [
  "Bonjour, je souhaite en savoir plus sur cette mission.",
  "Pouvez-vous préciser le délai et le budget ?",
  "Je suis disponible, quand pouvons-nous échanger ?",
];

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Bulle de messagerie flottante — premier contact rapide, scopé à UNE mission (Message.
// missionId est obligatoire, pas de conversation hors mission — voir plan « Bulle de
// messagerie »). N'apparaît que lorsque l'interlocuteur est non ambigu : le composant
// parent (missions/[id]/page.tsx) ne la monte pas sinon.
//
// Fil de discussion + appel audio/vidéo WebRTC intégrés (mêmes briques que
// src/components/dashboard/Messagerie.tsx : useWebRTC + CallPanel) — avant, un appel
// entrant sur cette page n'avait aucune UI pour y répondre alors que useWebRTC écoute déjà
// les signaux SSE pour tout utilisateur connecté ; seuls les dashboards (Messagerie/ex-
// ChatView) savaient afficher un appel. Envoie un vrai message via POST /api/messages,
// endpoint partagé avec Messagerie — aucune logique d'envoi dupliquée ou simulée.
export function MessageBubble({ missionId, currentUserId, interlocutorId, interlocutorName, interlocutorAvatarPath }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [showCall, setShowCall] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const {
    callState,
    error: callError,
    setRemoteVideoRef,
    setLocalVideoRef,
    setRemoteAudioRef,
    startCall,
    acceptCall,
    hangup,
    muted: callMuted,
    videoOff,
    isVideo,
    toggleMute,
    toggleVideo,
  } = useWebRTC(currentUserId);

  function loadThread() {
    setLoadingThread(true);
    fetch(`/api/messages?missionId=${missionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const messages: ThreadMessage[] = d?.messages ?? [];
        setThread(messages);
        const last = messages[messages.length - 1];
        setHasUnread(!!last && !last.sent);
      })
      .catch(() => {})
      .finally(() => setLoadingThread(false));
  }

  // Vérifie les messages non lus même bulle fermée (badge sur le bouton flottant).
  useEffect(() => { loadThread(); }, [missionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recharge le fil à l'ouverture — capte les messages reçus pendant que la bulle était fermée.
  useEffect(() => { if (open) loadThread(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [thread, open]);

  // Un appel entrant arrive via SSE (useWebRTC) même bulle fermée — on ouvre la bulle et
  // bascule sur la vue d'appel plutôt que de laisser l'utilisateur sans aucune UI pour
  // décrocher (c'était le cas avant : la bulle ne savait pas du tout qu'un appel arrivait).
  useEffect(() => {
    if (callState === "ringing") {
      setOpen(true);
      setShowCall(true);
    }
    if (callState === "ended") {
      const t = setTimeout(() => setShowCall(false), 1200);
      return () => clearTimeout(t);
    }
  }, [callState]);

  async function send() {
    if (!content.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, content: content.trim() }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // US-1301 — même garde que Messagerie.tsx (POST /api/messages, src/lib/leakage-detection.ts).
      setError(data.error === "message_blocked_leakage_attempt" ? "Message bloqué : partage de coordonnées ou de paiement direct détecté." : "Échec de l'envoi du message.");
      return;
    }
    setContent("");
    loadThread();
  }

  function handleCall(video: boolean) {
    setShowCall(true);
    startCall(interlocutorId, video, true);
  }

  const initials = interlocutorName.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
  const inCall = callState !== "idle";

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <>
          <div className="fixed inset-0 bg-black/15 z-40" onClick={() => { if (!inCall) setOpen(false); }} />
          <div className="relative z-50 w-[360px] max-w-[92vw] h-[480px] bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col">
            {showCall ? (
              <CallPanel
                callState={callState}
                remoteUser={interlocutorName}
                error={callError}
                muted={callMuted}
                videoOff={videoOff}
                isVideo={isVideo}
                onToggleMute={toggleMute}
                onToggleVideo={toggleVideo}
                onAccept={() => acceptCall()}
                onHangup={() => { hangup(); setShowCall(false); }}
                onSetLocalVideo={setLocalVideoRef}
                onSetRemoteVideo={setRemoteVideoRef}
                onSetRemoteAudio={setRemoteAudioRef}
              />
            ) : (
              <>
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between bg-gradient-to-r from-zinc-50 to-white">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={interlocutorAvatarPath ? `/api/users/${interlocutorId}/avatar` : null} initials={initials} size={40} />
                    <div className="leading-tight min-w-0">
                      <div className="font-bold text-[13px] text-[#0A1931] truncate">{interlocutorName}</div>
                      <div className="text-[11px] text-zinc-500">Message concernant cette mission</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleCall(false)} title="Appel audio" className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-500">
                      <Phone className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleCall(true)} title="Appel vidéo" className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-500">
                      <Video className="w-4 h-4" />
                    </button>
                    <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-500">✕</button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-2.5 bg-zinc-50/50">
                  {loadingThread && thread.length === 0 ? (
                    <p className="text-[12px] text-zinc-400 text-center mt-4">Chargement...</p>
                  ) : thread.length === 0 ? (
                    <p className="text-[12px] text-zinc-400 text-center mt-4">Aucun message pour l&apos;instant.</p>
                  ) : (
                    thread.map((m) => (
                      <div key={m.id} className={`flex ${m.sent ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${m.sent ? "bg-[#008751] text-white rounded-br-sm" : "bg-white border border-zinc-200 text-[#0A1931] rounded-bl-sm"}`}>
                          {m.type === "file" && m.url ? (
                            <a href={m.url} target="_blank" rel="noreferrer" className={`underline ${m.sent ? "text-white" : "text-[#008751]"}`}>{m.fileName ?? "Pièce jointe"}</a>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          )}
                          <div className={`text-[10px] mt-1 ${m.sent ? "text-white/70" : "text-zinc-400"}`}>{clockOf(m.createdAt)}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={threadEndRef} />
                </div>

                <div className="p-3 border-t border-zinc-100 bg-white">
                  {thread.length === 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {QUICK_REPLIES.map((q) => (
                        <button
                          key={q}
                          onClick={() => setContent(q)}
                          className="px-3 py-1.5 rounded-full bg-zinc-100 hover:bg-[#008751]/10 hover:text-[#008751] text-[11px] text-left border border-transparent transition"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                  {error && <p className="text-[11px] text-red-600 mb-1.5">{error}</p>}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value.slice(0, 2500))}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                      placeholder="Écrivez un message..."
                      className="flex-1 h-[42px] max-h-[110px] rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] resize-none"
                    />
                    <button
                      disabled={!content.trim() || sending}
                      onClick={send}
                      className={`h-[42px] px-4 rounded-xl font-medium text-[13px] transition shrink-0 ${content.trim() && !sending ? "bg-[#008751] text-white hover:bg-[#006d43]" : "bg-zinc-200 text-zinc-500 cursor-not-allowed"}`}
                    >
                      {sending ? "..." : "Envoyer"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white text-[22px] transition-all ${open ? "bg-zinc-900" : "bg-[#2563eb] hover:bg-[#008751]"}`}
        style={{ boxShadow: "0 10px 24px rgba(0,0,0,.18)" }}
      >
        💬
        {hasUnread && !open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#E8112D] border-2 border-white" />
        )}
      </button>
    </div>
  );
}
