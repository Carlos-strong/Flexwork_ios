"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  MessageSquare,
  Phone,
  Video,
  Paperclip,
  Smile,
  Send,
  MoreVertical,
  X,
  CheckCheck,
  ChevronDown,
  Image as ImageIcon,
  File as FileIcon,
  ShieldCheck,
  Clock,
  LifeBuoy,
  Download,
} from "lucide-react";

import { useWebRTC } from "@/lib/webrtc/useWebRTC";
import CallPanel from "@/components/chat/CallPanel";

type Conversation = {
  id: string;
  name: string;
  flag: string;
  project: string;
  budget: string;
  lastMessage: string;
  time: string;
  unread: number;
  online: boolean;
  role: string;
  location: string;
  rating: number;
  initials: string;
  gradient: string;
  status: string;
  peerId: string;
};

type Message = {
  id: number | string;
  type: "system" | "sent" | "received";
  text: string;
  time: string;
  status?: "sent" | "delivered" | "read";
  file?: {
    name: string;
    size: number;
    mime: string;
    url: string;
  };
};

type ApiConversation = {
  missionId: string;
  mission: { titre: string; budget: number; currency: string; status: string };
  interlocutor: { id: string; name: string; role: string; country: string } | null;
  lastMessage: { content: string; createdAt: string; sent: boolean; type?: string; fileName?: string | null } | null;
};

const GRADIENTS = [
  "from-[#FF6B35] to-[#F7C948]",
  "from-[#1B9C6A] to-[#0A1931]",
  "from-[#8B2E86] to-[#FF3E6C]",
  "from-[#0A1931] to-[#1B9C6A]",
  "from-[#FF6B35] to-[#8B2E86]",
];

const COUNTRY_FLAGS: Record<string, string> = {
  BJ: "🇧🇯", NG: "🇳🇬", SN: "🇸🇳", CI: "🇨🇮", ML: "🇲🇱",
  TG: "🇹🇬", GH: "🇬🇭", BF: "🇧🇫", NE: "🇳🇪", FR: "🇫🇷",
};

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤩", "🥳", "😅", "🙂", "😉", "😜", "🤔", "😴",
  "😭", "😤", "👍", "👎", "🙏", "👏", "💪", "🔥",
  "✨", "🎉", "❤️", "💯", "✅", "🚀", "🎯", "💼",
];

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agoOf(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h`;
  return `${Math.floor(diffMin / (24 * 60))}j`;
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["o", "Ko", "Mo", "Go"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function mapConversation(c: ApiConversation, i: number): Conversation {
  const name = c.interlocutor?.name || "Interlocuteur";
  return {
    id: c.missionId,
    name,
    flag: COUNTRY_FLAGS[c.interlocutor?.country ?? ""] ?? "",
    project: c.mission.titre,
    budget: `${c.mission.budget.toLocaleString("fr-FR")} ${c.mission.currency}`,
    lastMessage: c.lastMessage
      ? c.lastMessage.type === "file"
        ? `📎 ${c.lastMessage.fileName ?? c.lastMessage.content}`
        : c.lastMessage.content
      : "",
    time: c.lastMessage ? agoOf(c.lastMessage.createdAt) : "",
    unread: c.lastMessage && !c.lastMessage.sent ? 1 : 0,
    online: false,
    role: c.interlocutor?.role ?? "",
    location: c.interlocutor?.country ?? "",
    rating: 0,
    initials: initialsOf(name),
    gradient: GRADIENTS[i % GRADIENTS.length],
    status: c.mission.status,
    peerId: c.interlocutor?.id ?? "",
  };
}

export default function Messagerie({ currentUserId }: { currentUserId: string }) {
  const [activeId, setActiveId] = useState("");
  const [filter, setFilter] = useState("Tous");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [showCall, setShowCall] = useState(false);

  const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];

  const {
    callState,
    error: callError,
    remoteUser: peerId,
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

  const callPeer = conversations.find((c) => c.peerId === peerId);
  const callName = callPeer?.name ?? conv?.name ?? "Interlocuteur";

  const handleCall = (video: boolean) => {
    if (!conv) return;
    setShowCall(true);
    startCall(conv.peerId, video, true);
  };

  // Ouvre la vue d'appel à la réception d'un appel entrant
  useEffect(() => {
    if (callState === "ringing") {
      setShowCall(true);
      if (callPeer) setActiveId(callPeer.id);
    }
    if (callState === "ended") {
      const t = setTimeout(() => setShowCall(false), 1200);
      return () => clearTimeout(t);
    }
  }, [callState, callPeer?.id]);

  // Chargement des conversations réelles
  useEffect(() => {
    let cancelled = false;
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d) => {
        if (cancelled) return;
        const list = (d.conversations ?? []).map(mapConversation);
        setConversations(list);
        if (list.length) setActiveId(list[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  // Chargement des messages de la conversation sélectionnée
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    fetch(`/api/messages?missionId=${activeId}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => {
        if (cancelled) return;
        setThread(
          (d.messages ?? []).map((m: {
            id: string; content: string; createdAt: string; sent: boolean;
            type?: string; fileName?: string | null; fileSize?: number | null;
            mimeType?: string | null; url?: string | null;
          }) => ({
            id: m.id,
            type: m.sent ? ("sent" as const) : ("received" as const),
            text: m.content,
            time: clockOf(m.createdAt),
            status: "sent" as const,
            file: m.type === "file" && m.url
              ? { name: m.fileName ?? m.content, size: m.fileSize ?? 0, mime: m.mimeType ?? "", url: m.url }
              : undefined,
          }))
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  const filtered = conversations.filter((c) => {
    if (filter === "Non lus" && c.unread === 0) return false;
    if (filter === "Archivés") return false;
    if (search && !`${c.name} ${c.project}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const send = async () => {
    if (!draft.trim() || !conv) return;
    const content = draft.trim();
    const time = clockOf(new Date().toISOString());
    setDraft("");
    setThread((prev) => [...prev, { id: Date.now(), type: "sent", text: content, time, status: "sent" }]);
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, lastMessage: content, time: "À l'instant" } : c))
    );
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: conv.id, content }),
      });
    } catch {}
  };

  const sendFile = async (file: File) => {
    if (!conv) return;
    const tempId = Date.now();
    const time = clockOf(new Date().toISOString());
    // Message optimiste
    setThread((prev) => [
      ...prev,
      {
        id: tempId,
        type: "sent" as const,
        text: file.name,
        time,
        status: "sent" as const,
        file: { name: file.name, size: file.size, mime: file.type, url: "" },
      },
    ]);
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, lastMessage: `📎 ${file.name}`, time: "À l'instant" } : c))
    );

    const formData = new FormData();
    formData.append("missionId", conv.id);
    formData.append("file", file);

    try {
      const res = await fetch("/api/messages/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload_failed");
      const data = await res.json();
      const m = data.message;
      setThread((prev) =>
        prev.map((msg) =>
          msg.id === tempId
            ? {
                id: m.id,
                type: "sent" as const,
                text: m.fileName ?? m.content,
                time: clockOf(m.createdAt),
                status: "sent" as const,
                file: m.url
                  ? { name: m.fileName, size: m.fileSize ?? 0, mime: m.mimeType ?? "", url: m.url }
                  : undefined,
              }
            : msg
        )
      );
    } catch {
      // Supprimer le message optimiste en cas d'échec
      setThread((prev) => prev.filter((m) => m.id !== tempId));
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-68px)] -m-4 md:-m-6 flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="h-[calc(100vh-68px)] -m-4 md:-m-6 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2">💬</div>
          <p className="text-[13px] text-gray-500 font-medium">Aucune conversation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-68px)] -m-4 md:-m-6">
      <div className="max-w-[1400px] mx-auto p-3 lg:p-4 h-full flex gap-3 lg:gap-4">
        {/* Colonne conversations */}
        <div
          className={`${activeId ? "hidden lg:flex" : "flex"}
            w-full lg:w-[320px] lg:min-w-[320px] xl:w-[350px] xl:min-w-[350px] bg-white rounded-[20px] border border-orange-100 flex-col overflow-hidden`}
        >
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-[16px] font-bold text-[#0A1931]">Messages</h1>
              <span className="bg-[#FF3E6C]/10 text-[#FF3E6C] text-[11px] font-bold px-2.5 py-1 rounded-full">{conversations.filter((c) => c.unread > 0).length} non lus</span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une conversation"
                className="w-full h-10 pl-10 pr-4 rounded-full bg-[#F8F5F2] border border-transparent focus:border-orange-200 focus:bg-white outline-none text-[13px] transition"
              />
            </div>
            <div className="flex gap-1.5 mt-3">
              {["Tous", "Non lus", "Archivés"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3.5 h-7 rounded-full text-[12px] font-medium transition ${filter === f ? "bg-[#0A1931] text-white" : "bg-[#F8F5F2] text-gray-500 hover:bg-gray-100"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left p-3 rounded-[14px] flex gap-3 transition border ${activeId === c.id ? "bg-[#FFF1E8] border-orange-200" : "bg-white border-transparent hover:bg-[#F8F5F2]"}`}
              >
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${c.gradient} flex items-center justify-center text-white font-bold text-[12px]`}>{c.initials}</div>
                  {c.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#1B9C6A] border-2 border-white rounded-full" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-[13px] text-[#0A1931] truncate">{c.name}</span>
                      <span className="text-[13px]">{c.flag}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 shrink-0">{c.time}</span>
                  </div>
                  <div className="text-[11px] text-[#FF6B35] font-medium truncate">{c.project}</div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[12px] text-gray-500 truncate">{c.lastMessage}</span>
                    {c.unread > 0 && (
                      <span className="bg-[#FF3E6C] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">{c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="p-3 border-t border-gray-100">
            <div className="bg-[#0A1931] rounded-[14px] p-3 flex items-center gap-2.5 text-white">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-[12px] font-semibold">Messagerie sécurisée</div>
                <div className="text-[11px] text-white/60">Chiffrement bout-en-bout</div>
              </div>
            </div>
          </div>
        </div>

        {/* Fenêtre de chat / visio */}
        <div className="flex-1 bg-white rounded-[20px] border border-orange-100 flex flex-col overflow-hidden min-w-0">
          {showCall ? (
            <CallPanel
              callState={callState}
              remoteUser={callName}
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
          {/* En-tête conversation */}
              <div className="h-[68px] border-b border-gray-100 flex items-center justify-between px-4 gap-2 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => setActiveId("")} className="lg:hidden w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${conv.gradient} flex items-center justify-center text-white font-bold text-[13px]`}>{conv.initials}</div>
                    {conv.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#1B9C6A] border-2 border-white rounded-full" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[14px] text-[#0A1931] truncate">{conv.name} {conv.flag}</span>
                      {conv.online && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] bg-[#1B9C6A]/10 text-[#1B9C6A] px-2 py-0.5 rounded-full font-medium">
                          <span className="w-1.5 h-1.5 bg-[#1B9C6A] rounded-full" />
                          En ligne
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span className="truncate">{conv.role} • {conv.location}</span>
                      {conv.rating > 0 && (
                        <span className="hidden sm:inline-flex items-center gap-0.5 text-[#F7C948]">★ {conv.rating}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button className="hidden sm:flex w-9 h-9 rounded-full bg-[#F8F5F2] hover:bg-gray-100 items-center justify-center text-[#0A1931]">
                    <Search className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleCall(true)} className="w-9 h-9 sm:h-9 sm:w-auto sm:px-4 rounded-full bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,62,108,0.25)] hover:scale-[1.02] transition">
                    <Video className="w-4 h-4" />
                    <span className="hidden sm:inline text-[13px] font-semibold">Visio</span>
                  </button>
                  <button onClick={() => handleCall(false)} className="w-9 h-9 rounded-full bg-[#F8F5F2] hover:bg-gray-100 flex items-center justify-center text-[#0A1931]">
                    <Phone className="w-4 h-4" />
                  </button>
                  <button onClick={() => setShowDetails((v) => !v)} className="w-9 h-9 rounded-full bg-[#F8F5F2] hover:bg-gray-100 flex items-center justify-center text-[#0A1931]">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FFF8F0]/50">
                {thread.map((m) => {
                  if (m.type === "system") {
                    return (
                      <div key={m.id} className="flex justify-center py-2">
                        <div className="bg-white border border-orange-100 shadow-sm text-[11px] font-medium text-[#0A1931]/70 px-3.5 py-1.5 rounded-full flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#F7C948] flex items-center justify-center">
                            <MessageSquare className="w-3 h-3 text-white" />
                          </div>
                          {m.text}
                        </div>
                      </div>
                    );
                  }
                  const sent = m.type === "sent";
                  if (m.file) {
                    const isImage = m.file.mime.startsWith("image/");
                    return (
                      <div key={m.id} className={`flex ${sent ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] sm:max-w-[60%] rounded-[16px] p-3 ${sent ? "bg-gradient-to-br from-[#FF6B35] to-[#FF3E6C] text-white rounded-br-[6px] shadow-[0_2px_10px_rgba(255,107,53,0.2)]" : "bg-white border border-gray-100 text-[#0A1931] rounded-bl-[6px] shadow-sm"}`}>
                          {isImage && m.file.url ? (
                            <a href={m.file.url} target="_blank" rel="noreferrer" className="block mb-2">
                              <img src={m.file.url} alt={m.file.name} className="w-full max-h-44 object-cover rounded-[10px]" />
                            </a>
                          ) : (
                            <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center mb-2 ${sent ? "bg-white/15 text-white" : "bg-[#FFF1E8] text-[#FF6B35]"}`}>
                              {isImage ? <ImageIcon className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold truncate">{m.file.name}</div>
                              <div className={`text-[11px] ${sent ? "text-white/70" : "text-gray-400"}`}>{formatSize(m.file.size)}</div>
                            </div>
                            {m.file.url && (
                              <a
                                href={m.file.url}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${sent ? "bg-white/15 hover:bg-white/25 text-white" : "bg-[#F8F5F2] hover:bg-gray-100 text-[#0A1931]"}`}
                                title="Télécharger"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                          <div className={`flex items-center justify-end gap-1 mt-1.5 text-[10px] ${sent ? "text-white/70" : "text-gray-400"}`}>
                            <span>{m.time}</span>
                            {sent && m.status && <CheckCheck className={`w-3.5 h-3.5 ${m.status === "read" ? "text-white" : "text-white/70"}`} />}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={`flex ${sent ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] sm:max-w-[68%] rounded-[18px] px-4 py-2.5 text-[13px] leading-[1.45] relative ${sent ? "bg-gradient-to-br from-[#FF6B35] to-[#FF3E6C] text-white rounded-br-[6px] shadow-[0_2px_10px_rgba(255,107,53,0.2)]" : "bg-white border border-gray-100 text-[#0A1931] rounded-bl-[6px] shadow-sm"}`}>
                        <div>{m.text}</div>
                        <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${sent ? "text-white/80" : "text-gray-400"}`}>
                          <span>{m.time}</span>
                          {sent && m.status && <CheckCheck className={`w-3.5 h-3.5 ${m.status === "read" ? "text-white" : "text-white/70"}`} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={scrollRef} />
              </div>

              {/* Saisie */}
              <div className="p-3 border-t border-gray-100 bg-white relative">
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-10 h-10 rounded-full bg-[#F8F5F2] hover:bg-gray-100 flex items-center justify-center text-[#0A1931] shrink-0"
                    title="Joindre un fichier"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) sendFile(f);
                      e.target.value = "";
                    }}
                  />
                  <div className="flex-1 relative">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                      placeholder={`Message à ${conv.name.split(" ")[0]}...`}
                      className="w-full h-11 pl-4 pr-12 rounded-full bg-[#F8F5F2] border border-transparent focus:border-orange-200 focus:bg-white outline-none text-[13px] placeholder:text-gray-400 transition"
                    />
                    <button
                      onClick={() => setEmojiOpen((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border flex items-center justify-center text-gray-500 hover:text-[#0A1931]"
                      title="Émojis"
                    >
                      <Smile className="w-4 h-4" />
                    </button>
                  </div>
                  <button onClick={send} className="w-11 h-11 rounded-full bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white flex items-center justify-center shadow-[0_4px_12px_rgba(255,62,108,0.25)] hover:scale-105 transition shrink-0">
                    <Send className="w-4 h-4 ml-0.5" />
                  </button>
                </div>

                {emojiOpen && (
                  <div className="absolute bottom-[calc(100%-4px)] right-3 z-20 w-[280px] max-w-[calc(100vw-24px)] bg-white border border-gray-100 shadow-[0_8px_32px_rgba(0,0,0,0.12)] rounded-[16px] p-2">
                    <div className="grid grid-cols-8 gap-0.5">
                      {EMOJIS.map((em) => (
                        <button
                          key={em}
                          onClick={() => { setDraft((d) => d + em); setEmojiOpen(false); }}
                          className="w-8 h-8 rounded-[8px] hover:bg-[#FFF1E8] text-[18px] flex items-center justify-center transition"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="hidden sm:flex items-center gap-3 mt-2 px-1 text-[11px] text-gray-400">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Entrée pour envoyer • Shift+Entrée pour nouvelle ligne</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Panneau détails mission */}
        <div className={`w-[264px] shrink-0 bg-white rounded-[20px] border border-orange-100 flex-col overflow-hidden ${showDetails ? "flex" : "hidden 2xl:flex"}`}>
          <div onClick={() => setDetailsCollapsed((v) => !v)} className="p-4 border-b border-gray-100 flex items-center justify-between cursor-pointer">
            <h2 className="font-bold text-[14px] text-[#0A1931]">Détails mission</h2>
            <div className="flex items-center gap-1">
              <ChevronDown className={`w-4 h-4 transition-transform ${detailsCollapsed ? "rotate-180" : ""}`} />
              <button
                onClick={(e) => { e.stopPropagation(); setShowDetails(false); }}
                className="xl:hidden w-8 h-8 rounded-full bg-[#F8F5F2] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {!detailsCollapsed && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="rounded-[16px] border border-orange-100 overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-[#FF6B35] to-[#F7C948]" />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="font-bold text-[14px] text-[#0A1931]">{conv.project}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">Ref #{conv.id.slice(-6).toUpperCase()} • Créé il y a 4j</div>
                  </div>
                  <span className="bg-[#1B9C6A]/10 text-[#1B9C6A] text-[11px] font-semibold px-2.5 py-1 rounded-full">En cours</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-[#FFF8F0] rounded-[12px] p-2.5">
                    <div className="text-[11px] text-gray-500">Budget</div>
                    <div className="font-bold text-[14px] text-[#0A1931]">{conv.budget}</div>
                  </div>
                  <div className="bg-[#FFF8F0] rounded-[12px] p-2.5">
                    <div className="text-[11px] text-gray-500">Échéance</div>
                    <div className="font-bold text-[14px] text-[#FF3E6C] flex items-center gap-1"><Clock className="w-3 h-3" /> J-2</div>
                  </div>
                </div>
                <div className="mb-4">
                  <div className="flex justify-between text-[11px] mb-1.5">
                    <span className="text-gray-500 font-medium">Progression</span>
                    <span className="font-bold text-[#0A1931]">65%</span>
                  </div>
                  <div className="h-2 bg-[#F8F5F2] rounded-full overflow-hidden">
                    <div className="h-full w-[65%] bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 h-9 rounded-full bg-[#0A1931] text-white text-[12px] font-semibold">Voir mission</button>
                  <button className="flex-1 h-9 rounded-full border border-gray-200 text-[#0A1931] text-[12px] font-semibold">Facture</button>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-[12px] text-[#0A1931] uppercase tracking-wider mb-2.5">Fichiers partagés • 4</h3>
              <div className="space-y-2">
                {[
                  { name: "Logo_Wax_Final_v2.ai", size: "4.2 Mo", type: "file" },
                  { name: "Moodboard_Wax.png", size: "1.8 Mo", type: "img" },
                  { name: "Brief_Client.pdf", size: "890 Ko", type: "file" },
                ].map((f) => (
                  <div key={f.name} className="flex items-center gap-2.5 p-2.5 rounded-[12px] border border-gray-100 hover:bg-[#F8F5F2] transition">
                    <div className="w-9 h-9 rounded-[10px] bg-[#FFF1E8] flex items-center justify-center shrink-0">
                      {f.type === "img" ? <ImageIcon className="w-4 h-4 text-[#FF6B35]" /> : <FileIcon className="w-4 h-4 text-[#FF6B35]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[#0A1931] truncate">{f.name}</div>
                      <div className="text-[11px] text-gray-400">{f.size} • il y a 2h</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <div className="bg-gradient-to-br from-[#0A1931] to-[#1B1E4A] rounded-[16px] p-4 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-[#FF6B35]/20 to-transparent rounded-full blur-xl" />
                <div className="relative">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-2.5">
                    <LifeBuoy className="w-4 h-4" />
                  </div>
                  <div className="font-semibold text-[13px]">Besoin d'un médiateur ?</div>
                  <div className="text-[11px] text-white/60 mt-1 leading-snug">Notre équipe peut rejoindre la visio pour débloquer la mission.</div>
                  <button className="mt-3 h-8 px-4 rounded-full bg-white text-[#0A1931] text-[12px] font-semibold">Demander aide</button>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

    </div>
  );
}
