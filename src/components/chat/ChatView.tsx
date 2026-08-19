"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ArrowLeft, Send, Paperclip, Smile, Phone, Video,
  ChevronDown, ChevronUp, RefreshCw, AlertCircle,
} from "lucide-react";
import VideoCallModal from "./VideoCall";
import { useWebRTC } from "@/lib/webrtc/useWebRTC";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChatUser = {
  id: string;
  name: string;
  role: string;
  country: string | null;
};

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  sent: boolean;
  _pending?: boolean;  // Optimistic UI : message pas encore confirmé par l'API
  _failed?: boolean;   // Échec d'envoi
};

type Conversation = {
  missionId: string;
  mission: { titre: string; budget: number; currency: string; status: string };
  interlocutor: ChatUser;
  lastMessage: { content: string; createdAt: string; sent: boolean } | null;
  messages: ChatMessage[];
  _loadingMessages?: boolean;
};

type Props = {
  currentUserId: string;
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const ROLE_LABEL: Record<string, string> = {
  client: "Client", expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP", artisan: "Artisan", manoeuvre: "Manœuvre",
};
const ROLE_GRADIENT: Record<string, string> = {
  client: "from-[#FF7A00] to-[#E8112D]",
  expert_digital: "from-[#008751] to-[#FCD116]",
  expert_btp_autres: "from-[#FCD116] to-[#E8112D]",
  artisan: "from-[#3B82F6] to-[#22C55E]",
  manoeuvre: "from-[#8B5CF6] to-[#3B82F6]",
};
const COUNTRY_FLAG: Record<string, string> = {
  BJ: "🇧🇯", SN: "🇸🇳", NG: "🇳🇬", CI: "🇨🇮",
  TG: "🇹🇬", GH: "🇬🇭", CM: "🇨🇲", BF: "🇧🇫", ML: "🇲🇱", NE: "🇳🇪", GN: "🇬🇳",
};
const STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon", publiee: "Ouverte", proposition_acceptee: "En cours",
  contrat_genere: "En cours", contrat_signe: "En cours", en_cours: "En cours",
  fonds_sous_sequestre: "En cours", livrable_soumis: "Révision",
  validee: "Livrée", cloturee: "Livrée", mediation_ouverte: "Litige",
};

const rl = (r: string) => ROLE_LABEL[r] ?? r;
const rg = (r: string) => ROLE_GRADIENT[r] ?? "from-[#FF7A00] to-[#E8112D]";
const cf = (c: string | null) => c ? (COUNTRY_FLAG[c.toUpperCase()] ?? "") : "";
const ini = (n: string) => n.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase() || "?";
const sl = (s: string) => STATUS_LABEL[s] ?? s;

// Format date for date separators
function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff < 7) return ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][d.getDay()];
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Détection de liens simples dans le texte
function renderMessageContent(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        className="underline underline-offset-2 hover:opacity-80">
        {part.length > 50 ? part.slice(0, 47) + "..." : part}
      </a>
    ) : part
  );
}

// Insert date separators between messages
type MessageOrSeparator = { type: "msg"; msg: ChatMessage } | { type: "date"; label: string; id: string };
function withDateSeparators(msgs: ChatMessage[]): MessageOrSeparator[] {
  const out: MessageOrSeparator[] = [];
  let lastDate = "";
  for (const m of msgs) {
    const d = formatDateSeparator(m.createdAt);
    if (d !== lastDate) {
      out.push({ type: "date", label: d, id: `date-${m.id}` });
      lastDate = d;
    }
    out.push({ type: "msg", msg: m });
  }
  return out;
}

// =============================================================================
// Component
// =============================================================================
export default function ChatView({ currentUserId, onBack }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [newMsg, setNewMsg] = useState("");
  const [showCall, setShowCall] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [bannerOpen, setBannerOpen] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { callState, remoteUser, error: callError,
    setRemoteVideoRef, setLocalVideoRef, setRemoteAudioRef,
    startCall, acceptCall, hangup,
    muted, videoOff, isVideo, toggleMute, toggleVideo,
  } = useWebRTC(currentUserId);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileView === "chat") setMobileView("list");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileView]);

  // ---- Load conversations ----
  const loadConversations = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await fetch("/api/messages");
      if (!res.ok) { setError("Erreur chargement"); return; }
      const data = await res.json();
      const convs: Conversation[] = (data.conversations ?? []).map((c: Record<string, unknown>) => ({
        missionId: c.missionId as string,
        mission: c.mission as Conversation["mission"],
        interlocutor: c.interlocutor as ChatUser,
        lastMessage: c.lastMessage as Conversation["lastMessage"],
        messages: [], _loadingMessages: false,
      }));
      setConversations(convs);
      if (convs.length > 0 && !activeConv) setActiveConv(convs[0]);
    } catch { setError("Impossible de charger les conversations"); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ---- Load messages ----
  const loadMessages = useCallback(async (conv: Conversation) => {
    if (conv.messages.length > 0 && !conv._loadingMessages) return;
    setConversations(prev => prev.map(c => c.missionId === conv.missionId ? { ...c, _loadingMessages: true } : c));
    try {
      const res = await fetch(`/api/messages?missionId=${conv.missionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: ChatMessage[] = (data.messages ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string, content: m.content as string,
        createdAt: m.createdAt as string, sent: m.sent as boolean,
      }));
      setConversations(prev => prev.map(c => c.missionId === conv.missionId ? { ...c, messages: msgs, _loadingMessages: false } : c));
      setActiveConv(prev => prev?.missionId === conv.missionId ? { ...prev, messages: msgs, _loadingMessages: false } : prev);
    } catch {
      setConversations(prev => prev.map(c => c.missionId === conv.missionId ? { ...c, _loadingMessages: false } : c));
    }
  }, []);

  const openConv = useCallback((conv: Conversation) => {
    setConversations(prev => prev.map(c => ({ ...c, active: c.missionId === conv.missionId })));
    setActiveConv(conv);
    setMobileView("chat"); setBannerOpen(true); setSendError(null);
    loadMessages(conv);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [loadMessages]);

  const backToList = useCallback(() => setMobileView("list"), []);

  useEffect(() => {
    if (activeConv && activeConv.messages.length === 0) loadMessages(activeConv);
  }, [activeConv?.missionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Optimistic send ----
  const sendMessage = useCallback(async () => {
    if (!newMsg.trim() || !activeConv) return;
    const content = newMsg.trim();
    setNewMsg(""); setSendError(null);

    // Optimistic message (pending)
    const tempId = `temp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId, content, createdAt: new Date().toISOString(), sent: true, _pending: true,
    };

    const updateWith = (msgs: ChatMessage[]) => {
      const upd = { ...activeConv, messages: msgs,
        lastMessage: msgs.length > 0
          ? { content: msgs[msgs.length-1].content, createdAt: msgs[msgs.length-1].createdAt, sent: true }
          : activeConv.lastMessage };
      setActiveConv(upd);
      setConversations(prev => prev.map(c => c.missionId === activeConv.missionId ? upd : c));
    };

    updateWith([...activeConv.messages, optimistic]);

    try {
      const res = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: activeConv.missionId, content }),
      });
      if (!res.ok) throw new Error("send_failed");
      const data = await res.json();
      const confirmed: ChatMessage = data.message;

      // Replace optimistic with confirmed
      setActiveConv(prev => {
        if (!prev) return prev;
        const msgs = prev.messages.map(m => m.id === tempId ? confirmed : m);
        return { ...prev, messages: msgs,
          lastMessage: { content: confirmed.content, createdAt: confirmed.createdAt, sent: true } };
      });
      setConversations(prev => prev.map(c => {
        if (c.missionId !== activeConv.missionId) return c;
        const msgs = c.messages.map(m => m.id === tempId ? confirmed : m);
        return { ...c, messages: msgs,
          lastMessage: { content: confirmed.content, createdAt: confirmed.createdAt, sent: true } };
      }));
      inputRef.current?.focus();
    } catch {
      // Mark as failed
      setActiveConv(prev => {
        if (!prev) return prev;
        return { ...prev, messages: prev.messages.map(m => m.id === tempId ? { ...m, _pending: false, _failed: true } : m) };
      });
      setSendError("Échec de l'envoi — réessayez");
    }
  }, [newMsg, activeConv]);

  // Retry failed message
  const retrySend = useCallback(async (failedMsg: ChatMessage) => {
    if (!activeConv) return;
    setSendError(null);
    // Mark as pending again
    setActiveConv(prev => {
      if (!prev) return prev;
      return { ...prev, messages: prev.messages.map(m => m.id === failedMsg.id ? { ...m, _pending: true, _failed: false } : m) };
    });
    try {
      const res = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: activeConv.missionId, content: failedMsg.content }),
      });
      if (!res.ok) throw new Error("retry_failed");
      const data = await res.json();
      const confirmed: ChatMessage = data.message;
      setActiveConv(prev => {
        if (!prev) return prev;
        const msgs = prev.messages.map(m => m.id === failedMsg.id ? confirmed : m);
        return { ...prev, messages: msgs, lastMessage: { content: confirmed.content, createdAt: confirmed.createdAt, sent: true } };
      });
      setConversations(prev => prev.map(c => {
        if (c.missionId !== activeConv.missionId) return c;
        const msgs = c.messages.map(m => m.id === failedMsg.id ? confirmed : m);
        return { ...c, messages: msgs, lastMessage: { content: confirmed.content, createdAt: confirmed.createdAt, sent: true } };
      }));
    } catch {
      setActiveConv(prev => {
        if (!prev) return prev;
        return { ...prev, messages: prev.messages.map(m => m.id === failedMsg.id ? { ...m, _pending: false, _failed: true } : m) };
      });
      setSendError("Échec — réessayez");
    }
  }, [activeConv]);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConv?.messages]);

  const handleCall = (video: boolean) => {
    if (!activeConv) return;
    setShowCall(true); startCall(activeConv.interlocutor.id, video, true);
  };

  // ---- Derived ----
  const unreadCount = conversations.filter(c => c.lastMessage && !c.lastMessage.sent).length;
  const showListOnMobile = mobileView === "list";

  const enrichedMessages = useMemo(
    () => activeConv ? withDateSeparators(activeConv.messages) : [],
    [activeConv?.messages]
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <div className="flex flex-col md:flex-row gap-0 h-full">
        <div className="w-full md:w-[320px] shrink-0 bg-white border border-gray-100 rounded-2xl md:rounded-l-2xl md:rounded-tr-none overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-50"><div className="h-5 w-24 bg-gray-100 rounded animate-pulse" /></div>
          {[1,2,3,4].map(i => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-11 h-11 rounded-full bg-gray-100 animate-pulse shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-28 bg-gray-100 rounded animate-pulse" />
                <div className="h-2.5 w-40 bg-gray-50 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:flex flex-1 bg-white border border-gray-100 md:rounded-r-2xl items-center justify-center">
          <div className="text-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin mx-auto mb-3" /><p className="text-[12px] text-zinc-400">Chargement...</p></div>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-[14px] font-semibold text-[#0A1931] mb-1">Erreur de chargement</p>
        <p className="text-[12px] text-zinc-500 mb-4">{error}</p>
        <button onClick={loadConversations} className="h-10 px-5 rounded-full bg-[#FF7A00] text-white text-[13px] font-semibold hover:brightness-110 active:scale-95 flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      </div>
    );
  }

  // ---- Empty state ----
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4 text-2xl">💬</div>
        <p className="text-[15px] font-semibold text-[#0A1931] mb-1">Aucune conversation</p>
        <p className="text-[13px] text-zinc-500 max-w-sm leading-relaxed">
          Vos conversations apparaîtront ici dès qu&apos;un prestataire candidatera à l&apos;une de vos missions, ou dès que vous candidaterez.
        </p>
        <button onClick={onBack} className="mt-5 h-10 px-5 rounded-full bg-[#FF7A00] text-white text-[13px] font-semibold hover:brightness-110 active:scale-95 transition-all">
          Retour au tableau de bord
        </button>
      </div>
    );
  }

  if (!activeConv) return null;

  const interlocutor = activeConv.interlocutor;
  const gradient = rg(interlocutor.role);
  const flag = cf(interlocutor.country);

  // ===========================================================================
  // MAIN LAYOUT
  // ===========================================================================
  return (
    <div className="flex flex-col md:flex-row gap-0 h-[calc(100dvh-120px)] md:h-[calc(100vh-180px)] min-h-[400px]">
      {/* ================================================================== */}
      {/* LEFT — Conversation list                                           */}
      {/* ================================================================== */}
      <div className={`${
        showListOnMobile ? "flex animate-[fadeIn_150ms_ease-out]" : "hidden"
      } md:flex w-full md:w-[320px] shrink-0 bg-white border border-gray-100 rounded-2xl md:rounded-l-2xl md:rounded-tr-none overflow-hidden flex-col`}>
        {/* Header */}
        <div className="px-4 md:px-5 py-3 md:py-4 border-b border-gray-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:scale-95 transition-all shrink-0">
              <ArrowLeft className="w-4 h-4 text-zinc-600"/>
            </button>
            <h3 className="font-semibold text-[15px] text-[#0A1931]">Messages</h3>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#E8112D] text-white text-[10px] font-bold min-w-[18px] text-center">{unreadCount}</span>
            )}
          </div>
          {error && <button onClick={loadConversations} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200" title="Rafraîchir"><RefreshCw className="w-3.5 h-3.5 text-zinc-500"/></button>}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50 overscroll-contain">
          {conversations.map(c => {
            const isActive = c.missionId === activeConv.missionId;
            const isUnread = c.lastMessage && !c.lastMessage.sent;
            return (
              <div
                key={c.missionId}
                onClick={() => openConv(c)}
                className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-150 active:bg-[#FFF0E0] ${
                  isActive ? "bg-[#FFF8F0] border-l-[3px] border-l-[#FF7A00]" : "hover:bg-gray-50"
                }`}
              >
                <div className="relative shrink-0">
                  <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${rg(c.interlocutor.role)} flex items-center justify-center text-white text-[13px] font-bold`}>
                    {ini(c.interlocutor.name)}
                  </div>
                  {isUnread && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#FF7A00] border-2 border-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] truncate ${isUnread ? "font-bold text-[#0A1931]" : "font-semibold text-[#0A1931]"}`}>
                      {c.interlocutor.name}{cf(c.interlocutor.country)}
                    </span>
                    <span className="text-[10px] text-zinc-400 shrink-0 ml-2">
                      {c.lastMessage ? formatMsgTime(c.lastMessage.createdAt) : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className={`text-[11px] truncate ${isUnread ? "font-medium text-zinc-700" : "text-zinc-500"}`}>
                      {c._loadingMessages ? "Chargement..." : (c.lastMessage?.content ?? c.mission.titre)}
                    </span>
                    {isUnread && <span className="ml-1 w-2 h-2 rounded-full bg-[#FF7A00] shrink-0" />}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                    {rl(c.interlocutor.role)} • {c.mission.titre}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="md:hidden px-4 py-2 border-t border-gray-50 bg-gray-50/50 text-center text-[10px] text-zinc-400 shrink-0">
          {conversations.length} conversation{conversations.length > 1 ? "s" : ""}
        </div>
      </div>

      {/* ================================================================== */}
      {/* RIGHT — Chat view                                                   */}
      {/* ================================================================== */}
      <div className={`${
        !showListOnMobile ? "flex animate-[fadeIn_150ms_ease-out]" : "hidden"
      } md:flex flex-1 bg-white border border-gray-100 border-t-0 md:border-t md:rounded-r-2xl md:rounded-bl-none rounded-b-2xl rounded-t-2xl md:rounded-tl-none overflow-hidden flex-col`}>
        {/* Chat header */}
        <div className="shrink-0 px-3 md:px-5 py-2.5 md:py-3 border-b border-gray-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button onClick={backToList} className="md:hidden w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 active:scale-95 shrink-0">
              <ArrowLeft className="w-4 h-4 text-zinc-600"/>
            </button>
            <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-[11px] md:text-[12px] font-bold shrink-0`}>
              {ini(interlocutor.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] md:text-[14px] font-semibold truncate">{interlocutor.name}</span>
                <span className="text-sm shrink-0">{flag}</span>
              </div>
              <div className="text-[10px] md:text-[11px] text-zinc-400 truncate">{rl(interlocutor.role)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => handleCall(false)} className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 active:scale-95" title="Appel audio">
              <Phone className="w-4 h-4 text-zinc-600"/>
            </button>
            <button onClick={() => handleCall(true)} className="h-9 px-3 rounded-full bg-[#008751] text-white text-[11px] font-semibold flex items-center gap-1 hover:brightness-110 active:scale-95">
              <Video className="w-3.5 h-3.5"/> <span className="hidden sm:inline">Visio</span>
            </button>
          </div>
        </div>

        {/* Error banner */}
        {sendError && (
          <div className="shrink-0 mx-3 md:mx-4 mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 flex items-center gap-2 text-[11px] text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{sendError}</span>
            <button onClick={() => setSendError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Mission banner */}
        <div className="shrink-0 mx-3 md:mx-4 mt-2 md:mt-3">
          <button
            onClick={() => setBannerOpen(!bannerOpen)}
            className="w-full px-3 md:px-4 py-2 md:py-2.5 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-2 text-[11px] md:text-[12px] hover:bg-amber-100/50 transition-colors"
          >
            <span className="text-base md:text-lg shrink-0">📋</span>
            <span className="font-medium text-amber-800 truncate">{activeConv.mission.titre}</span>
            <span className="text-amber-400 hidden sm:inline">•</span>
            <span className="text-amber-700 font-semibold hidden sm:inline shrink-0">
              {activeConv.mission.budget.toLocaleString("fr-FR")} {activeConv.mission.currency}
            </span>
            <span className="text-amber-400 hidden sm:inline">•</span>
            <span className="px-1.5 md:px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] md:text-[10px] font-semibold hidden sm:inline shrink-0">
              {sl(activeConv.mission.status)}
            </span>
            <span className="ml-auto text-amber-400 shrink-0">
              {bannerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>
          {bannerOpen && (
            <div className="sm:hidden px-3 pb-2 bg-amber-50 border-x border-b border-amber-100 rounded-b-xl flex items-center gap-2 text-[10px] text-amber-700">
              <span className="font-semibold">{activeConv.mission.budget.toLocaleString("fr-FR")} {activeConv.mission.currency}</span>
              <span>•</span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-[9px] font-semibold">{sl(activeConv.mission.status)}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-3 md:py-4 overscroll-contain">
          {activeConv.messages.length === 0 && !activeConv._loadingMessages ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-[18px] font-bold mb-3`}>
                {ini(interlocutor.name)}
              </div>
              <p className="text-[13px] font-medium text-[#0A1931] mb-1">{interlocutor.name}</p>
              <p className="text-[12px] text-zinc-400 mb-4">{rl(interlocutor.role)}</p>
              <p className="text-[12px] text-zinc-400">Envoyez le premier message !</p>
            </div>
          ) : activeConv._loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-6 h-6 border-[2px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {enrichedMessages.map(item => {
                if (item.type === "date") {
                  return (
                    <div key={item.id} className="flex items-center justify-center py-3 first:pt-0">
                      <span className="px-3 py-1 rounded-full bg-gray-100 text-[10px] text-zinc-500 font-medium">{item.label}</span>
                    </div>
                  );
                }
                const m = item.msg;
                return (
                  <div key={m.id} className={`flex ${m.sent ? "justify-end" : "justify-start"} py-1`}>
                    <div className={`max-w-[85%] md:max-w-[75%] ${m.sent ? "items-end" : "items-start"} flex flex-col`}>
                      <div className={`px-3 md:px-4 py-2 md:py-2.5 rounded-2xl text-[13px] leading-relaxed break-words ${
                        m.sent
                          ? m._failed ? "bg-red-100 text-red-700 rounded-br-md" : m._pending ? "bg-[#FF7A00]/70 text-white rounded-br-md" : "bg-[#FF7A00] text-white rounded-br-md"
                          : "bg-gray-100 text-[#0A1931] rounded-bl-md"
                      }`}>
                        {renderMessageContent(m.content)}
                      </div>
                      <div className={`flex items-center gap-1.5 mt-0.5 ${m.sent ? "flex-row-reverse" : ""}`}>
                        <span className="text-[10px] text-zinc-400">{formatMsgTime(m.createdAt)}</span>
                        {m.sent && !m._failed && (
                          <span className={`text-[10px] ${m._pending ? "text-zinc-300" : "text-zinc-300"}`}>✓✓</span>
                        )}
                        {m._failed && (
                          <button onClick={() => retrySend(m)} className="text-[10px] text-red-500 font-medium hover:underline flex items-center gap-0.5">
                            <RefreshCw className="w-3 h-3" /> Réessayer
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-3 md:px-4 py-2 md:py-3 border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom,8px)]">
          <div className="flex items-center gap-1.5 md:gap-2">
            <button className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 active:scale-95 shrink-0">
              <Paperclip className="w-4 h-4 text-zinc-400"/>
            </button>
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message à ${interlocutor.name.split(" ")[0]}...`}
                className="w-full h-10 pl-4 pr-10 rounded-full bg-gray-50 border border-gray-100 text-[14px] md:text-[13px] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/20 focus:border-[#FF7A00] focus:bg-white transition-all"
                autoComplete="off"
              />
              <button
                onClick={sendMessage}
                disabled={!newMsg.trim()}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 ${
                  newMsg.trim() ? "bg-[#FF7A00] hover:brightness-110 active:scale-95" : "bg-gray-200"
                }`}
              >
                <Send className={`w-3.5 h-3.5 ${newMsg.trim() ? "text-white" : "text-zinc-400"}`}/>
              </button>
            </div>
            <button className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 active:scale-95 shrink-0">
              <Smile className="w-4 h-4 text-zinc-400"/>
            </button>
          </div>
          <p className="text-center text-[10px] text-zinc-400 mt-1.5 md:mt-2 hidden sm:flex items-center justify-center gap-1">
            <span>⏎</span> Entrée pour envoyer • Shift+Entrée pour nouvelle ligne • Échap pour revenir
          </p>
        </div>
      </div>

      {/* Video Call Modal */}
      <VideoCallModal
        isOpen={showCall}
        callState={callState}
        remoteUser={interlocutor.name}
        error={callError}
        muted={muted}
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
    </div>
  );
}
