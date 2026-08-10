"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase, Wallet, User, Search, Plus, BadgeCheck, Check,
  ChevronRight, X, Clock, LoaderCircle, ArrowLeft,
  Send, Menu, LogOut, FileText, Shield,
} from "lucide-react";
import { BeninFlag } from "@/components/benin-flag";

// ---------------------------------------------------------------------------
// Types (alignés sur l'API réelle /api/missions et le modèle Prisma)
// ---------------------------------------------------------------------------
type ApiMission = {
  id: string; titre: string; description: string; domaine: string;
  budget: number; currency: string; delaiJours: number;
  status: string; riskLevel: string; insuranceRequired: boolean;
  createdAt: string;
};

// Statuts mission → affichage
const STATUS_LABEL: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  brouillon:            { label: "Brouillon",            bg: "bg-gray-100", text: "text-gray-500",  dot: "bg-gray-300" },
  publiee:              { label: "Ouverte",              bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  proposition_acceptee: { label: "Proposition acceptée", bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  contrat_genere:       { label: "Contrat généré",       bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  contrat_signe:        { label: "Contrat signé",        bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500" },
  en_cours:             { label: "En cours",             bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  livrable_soumis:      { label: "Livrable soumis",      bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  validee:              { label: "Validée",              bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  cloturee:             { label: "Clôturée",             bg: "bg-gray-900",  text: "text-white",     dot: "bg-white" },
  mediation_ouverte:    { label: "Médiation",            bg: "bg-red-50",    text: "text-[#E8112D]", dot: "bg-[#E8112D]" },
};

const STATUS_TABS = [
  { id: "Tous", label: "Tous" },
  { id: "publiee", label: "Ouvertes" },
  { id: "proposition_acceptee", label: "Acceptées" },
  { id: "en_cours", label: "En cours" },
  { id: "cloturee", label: "Clôturées" },
];

type Toast = { id: string; msg: string; icon: string };

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------
export default function ExpertDigitalDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  // Auth
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);

  // Tabs
  const [tab, setTab] = useState<"missions" | "wallet" | "profil">("missions");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Missions (API)
  const [missions, setMissions] = useState<ApiMission[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Recherche & filtre
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Tous");

  // Proposition
  const [selected, setSelected] = useState<ApiMission | null>(null);
  const [modal, setModal] = useState(false);
  const [pressingId, setPressingId] = useState<string | null>(null);
  const [montant, setMontant] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Anti-doublon : ids des missions où l'utilisateur a déjà candidaté
  const [myProposalIds, setMyProposalIds] = useState<Set<string>>(new Set());

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (msg: string, icon: string) => {
    const id = Date.now().toString();
    setToasts((p) => [...p, { id, msg, icon }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000);
  };

  // Body scroll lock
  useEffect(() => { document.body.style.overflow = modal ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [modal]);

  // Chargement API
  useEffect(() => {
    if (status !== "authenticated") return;
    setLoading(true);
    fetch("/api/missions")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setMissions(d.items))
      .finally(() => setLoading(false));
  }, [status]);

  // Loading / unauthenticated
  if (status === "loading" || loading) return <div className="min-h-screen bg-zinc-50 flex items-center justify-center"><LoaderCircle className="w-5 h-5 animate-spin text-[#008751]" /></div>;
  if (status === "unauthenticated") return null;

  // Filtrage
  const filtered = (missions ?? []).filter((m) => {
    const match = m.titre.toLowerCase().includes(search.toLowerCase()) || m.domaine.toLowerCase().includes(search.toLowerCase());
    return match && (filter === "Tous" || m.status === filter);
  });
  const counts: Record<string, number> = {};
  for (const t of STATUS_TABS) counts[t.id] = t.id === "Tous" ? (missions ?? []).length : (missions ?? []).filter((m) => m.status === t.id).length;

  // Actions
  const openMission = async (m: ApiMission) => {
    // Anti-doublon strict : si déjà candidaté, on bloque.
    if (myProposalIds.has(m.id)) {
      notify("Vous avez déjà candidaté à cette mission.", "ℹ️");
      return;
    }
    setPressingId(m.id);
    setFeedback(null);
    setMontant("");
    setMessage("");
    // Vérification côté serveur (rattrapage si cache local stale)
    try {
      const res = await fetch(`/api/missions/${m.id}/proposals`);
      if (res.ok) {
        const data = await res.json();
        const mine = (data.items ?? []).find(
          (p: { provider?: { id?: string } }) => p.provider?.id === userId
        );
        if (mine) {
          setMyProposalIds((prev) => new Set(prev).add(m.id));
          notify("Vous avez déjà candidaté à cette mission.", "ℹ️");
          setPressingId(null);
          return;
        }
      }
    } catch { /* silencieux */ }
    setTimeout(() => { setSelected(m); setModal(true); setPressingId(null); }, 160);
  };
  const closeMission = () => { setModal(false); setTimeout(() => setSelected(null), 320); };

  const submitProposal = async () => {
    if (!selected) return;
    setSubmitting(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${selected.id}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ montant: Number(montant), message: message || undefined }),
    });
    setSubmitting(false);
    if (res.ok) {
      setMyProposalIds((prev) => new Set(prev).add(selected.id));
      notify("Candidature envoyée !", "✅");
      closeMission();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.error === "kyc_not_verified" ? "KYC requis pour candidater." : d.error === "mission_not_open" ? "Mission plus ouverte." : "Erreur lors de l'envoi.");
    }
  };

  const statusStyle = (s: string) => STATUS_LABEL[s] ?? { label: s, bg: "bg-gray-100", text: "text-gray-500", dot: "bg-gray-300" };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-zinc-900 antialiased selection:bg-[#008751]/20 selection:text-[#008751] flex">

      {/* ============ SIDEBAR ============ */}
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" />
      )}

      <aside className={`fixed md:sticky top-0 left-0 z-50 md:z-30 h-full w-64 bg-white border-r border-gray-100 flex flex-col transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        {/* Logo */}
        <div className="h-[68px] flex items-center gap-3 px-5 border-b border-gray-100 shrink-0">
          <Link href="/" className="flex items-center gap-3" style={{ textDecoration: "none" }}>
            <BeninFlag />
            <span className="font-bold text-[20px] tracking-tight text-zinc-900">Flex<span style={{ color: "#008751" }}>Work</span></span>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {[
            { id: "missions" as const, label: "Missions", Icon: Briefcase },
            { id: "wallet" as const, label: "Wallet", Icon: Wallet },
            { id: "profil" as const, label: "Profil", Icon: User },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => { setTab(id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 h-10 rounded-xl text-[14px] font-medium transition-all ${tab === id ? "bg-[#008751] text-white shadow-sm" : "text-zinc-600 hover:bg-gray-100"}`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}

          <div className="pt-4 mt-4 border-t border-gray-100">
            <p className="px-3 text-[10px] uppercase tracking-widest text-zinc-400 font-semibold mb-2">Raccourcis</p>
            {[
              { href: "/declarations", label: "Qualifications", Icon: FileText },
              { href: "/kyc", label: "Vérification KYC", Icon: Shield },
              { href: "/profile", label: "Mon profil", Icon: User },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} onClick={() => setSidebarOpen(false)}
                className="w-full flex items-center gap-3 px-3 h-10 rounded-xl text-[14px] font-medium text-zinc-600 hover:bg-gray-100 transition-all"
                style={{ textDecoration: "none" }}>
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="shrink-0 px-3 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-white text-[11px] font-bold">ED</span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">Expert Digital</div>
              <div className="text-[11px] text-zinc-400 flex items-center gap-1"><BadgeCheck className="w-3 h-3 text-[#008751]" /> Vérifié</div>
            </div>
          </div>
          <button onClick={() => router.push("/signin")}
            className="w-full flex items-center gap-2 px-3 h-9 rounded-xl text-[13px] text-zinc-500 hover:bg-gray-100 transition-all">
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
        </div>
      </aside>

      {/* ============ MAIN CONTENT ============ */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* ---- Topbar ---- */}
        <header className="sticky top-0 z-30 h-[68px] bg-[#f8fafc]/80 backdrop-blur-xl border-b border-gray-100/60 flex items-center justify-between px-4 md:px-6 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="md:hidden w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors">
            <Menu className="w-4 h-4" />
          </button>
          <span className="hidden md:block text-[15px] font-semibold text-zinc-700">
            {tab === "missions" ? "Missions disponibles" : tab === "wallet" ? "Wallet" : "Profil"}
          </span>
          <div className="flex items-center gap-2">
            <Link href="/missions/new" className="hidden md:flex h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold items-center gap-1.5 hover:brightness-110 transition-all" style={{ textDecoration: "none" }}>
              <Plus className="w-4 h-4" /> Nouvelle mission
            </Link>
            <span className="md:hidden w-8 h-8 rounded-full bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-white text-[11px] font-bold">ED</span>
          </div>
        </header>

        {/* ---- Page content ---- */}
        <div className="flex-1 px-4 md:px-6 py-6">
          <div className="animate-[fadeIn_300ms_cubic-bezier(0.2,0.8,0.2,1)]">

            {/* ============ MISSIONS ============ */}
            {tab === "missions" && <>
              {/* Barre de recherche */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher une mission..."
                    className="w-full h-12 pl-11 pr-11 rounded-full bg-white border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.04)] text-[14px] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#008751] focus:border-transparent transition-all" />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filtres statut */}
              <div className="mt-5 -mx-4 px-4 md:mx-0 md:px-0 overflow-x-auto scrollbar-none">
                <div className="flex gap-2.5 w-max pb-2">
                  {STATUS_TABS.map((s) => {
                    const active = filter === s.id;
                    return (
                      <button key={s.id} onClick={() => setFilter(s.id)}
                        className={`h-9 px-4 rounded-full text-[13px] font-medium inline-flex items-center gap-2 border transition-all duration-200 whitespace-nowrap ${active ? "bg-[#008751] text-white border-[#008751] shadow-[0_4px_14px_rgba(0,135,81,0.25)]" : "bg-white text-zinc-600 border-gray-100 hover:border-gray-200 hover:shadow-sm"}`}>
                        {s.label}
                        <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${active ? "bg-white/20 text-white" : "bg-gray-100 text-zinc-600"}`}>{counts[s.id] ?? 0}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Grille missions */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {filtered.map((m) => {
                  const st = statusStyle(m.status);
                  const alreadyApplied = myProposalIds.has(m.id);
                  return (
                    <button key={m.id} onClick={() => openMission(m)} disabled={alreadyApplied}
                      className={`text-left group relative bg-white rounded-[20px] border shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-4 transition-all duration-300 ${alreadyApplied ? "opacity-50 cursor-not-allowed border-gray-100" : "border-gray-100 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] active:scale-[0.98]"} ${!alreadyApplied && pressingId === m.id ? "scale-[0.98] opacity-80" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-[16px] leading-[1.25] line-clamp-2 pr-2 tracking-tight text-zinc-900">{m.titre}</h3>
                        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.bg} ${st.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-white text-[11px] font-bold">
                          {m.domaine.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="text-[13px]">
                          <span className="font-medium text-zinc-800">{m.domaine}</span>
                          <span className="text-zinc-300 mx-1.5">•</span>
                          <span className="text-zinc-500">{m.delaiJours} jours</span>
                        </div>
                      </div>
                      {m.description && (
                        <p className="text-[13px] text-zinc-500 line-clamp-2 leading-snug">{m.description}</p>
                      )}
                      <div className="flex items-center justify-between pt-1 border-t border-gray-50 mt-1">
                        <span className="font-semibold text-[15px] tracking-tight text-zinc-800">
                          {m.budget.toLocaleString("fr-FR")} {m.currency}
                        </span>
                        {alreadyApplied ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-zinc-400 text-[11px] font-semibold">
                            <Check className="w-3 h-3" /> Déjà candidaté
                          </span>
                        ) : (
                          <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                            <ChevronRight className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="mt-16 text-center col-span-full">
                    <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                      <Search className="w-5 h-5 text-zinc-400" />
                    </div>
                    <p className="text-[14px] text-zinc-500">Aucune mission trouvée</p>
                    <Link href="/recherche" className="mt-3 inline-flex h-9 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold items-center hover:brightness-110 transition-all" style={{ textDecoration: "none" }}>
                      Explorer les talents
                    </Link>
                  </div>
                )}
              </div>
            </>}

            {/* ============ WALLET ============ */}
            {tab === "wallet" && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-zinc-900 rounded-[24px] p-6 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#008751]/30 to-[#FCD116]/20 rounded-full blur-3xl" />
                  <div className="relative">
                    <div className="text-[12px] uppercase tracking-widest opacity-60 font-semibold">Solde disponible</div>
                    <div className="text-[36px] font-bold tracking-tight mt-2">1 842 500 FCFA</div>
                    <div className="mt-4 flex gap-2">
                      <button className="h-10 px-5 rounded-full bg-white text-zinc-900 text-[13px] font-semibold hover:bg-gray-100 transition-colors">Retirer</button>
                      <button className="h-10 px-5 rounded-full bg-white/15 text-white text-[13px] font-medium hover:bg-white/20 transition-colors backdrop-blur">Historique</button>
                    </div>
                    <div className="mt-8 grid grid-cols-3 gap-3">
                      {[{ k: "En séquestre", v: "620k" }, { k: "En attente", v: "340k" }, { k: "Ce mois", v: "+1.2M" }].map((s) => (
                        <div key={s.k} className="bg-white/10 rounded-[16px] p-3 backdrop-blur">
                          <div className="text-[11px] opacity-60">{s.k}</div><div className="font-semibold mt-1">{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-[20px] border border-gray-100 shadow-sm p-5">
                  <div className="font-semibold">Transactions récentes</div>
                  <div className="mt-4 space-y-3">
                    {[
                      { title: "Paiement — Refonte UX/UI", amount: "+420k", time: "Il y a 2h" },
                      { title: "Retrait Mobile Money", amount: "-500k", time: "Hier" },
                      { title: "Frais FlexWork", amount: "-12k", time: "Hier" },
                    ].map((t, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm"><Wallet className="w-4 h-4" /></div>
                        <div className="flex-1 min-w-0"><div className="text-[13px] font-medium truncate">{t.title}</div><div className="text-[11px] text-zinc-500">{t.time}</div></div>
                        <div className={`text-[13px] font-semibold ${t.amount.startsWith("+") ? "text-[#008751]" : "text-zinc-700"}`}>{t.amount}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ============ PROFIL ============ */}
            {tab === "profil" && (
              <div className="max-w-[560px] mx-auto">
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-sm p-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-white font-bold text-[18px]">ED</div>
                    <div>
                      <div className="font-semibold flex items-center gap-2">Expert Digital <BadgeCheck className="w-4 h-4 text-[#008751]" /></div>
                      <div className="text-[13px] text-zinc-500">Développement, Design, Marketing • Cotonou • 4.9 ★</div>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-3 gap-3">
                    {[{ label: "Missions", val: String(missions?.length ?? 0) }, { label: "Taux succès", val: "98%" }, { label: "Réponse", val: "<2h" }].map((s) => (
                      <div key={s.label} className="rounded-2xl bg-gray-50 p-3 text-center">
                        <div className="font-bold text-[18px]">{s.val}</div>
                        <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold mt-1">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 space-y-2">
                    <Link href="/profile" className="block w-full h-11 rounded-full bg-gray-100 text-zinc-700 text-[13px] font-semibold flex items-center justify-center hover:bg-gray-200 transition-colors" style={{ textDecoration: "none" }}>Modifier le profil</Link>
                    <Link href="/declarations" className="block w-full h-11 rounded-full bg-gray-100 text-zinc-700 text-[13px] font-semibold flex items-center justify-center hover:bg-gray-200 transition-colors" style={{ textDecoration: "none" }}>Qualifications</Link>
                    <Link href="/kyc" className="block w-full h-11 rounded-full bg-gray-100 text-zinc-700 text-[13px] font-semibold flex items-center justify-center hover:bg-gray-200 transition-colors" style={{ textDecoration: "none" }}>Vérification KYC</Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============ MODAL Détail mission + Candidature ============ */}
      <div className={`fixed inset-0 z-40 flex items-center justify-center p-4 md:p-6 transition-all duration-300 ${modal ? "pointer-events-auto" : "pointer-events-none"}`}>
        <div onClick={closeMission} className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-300 ${modal ? "opacity-100" : "opacity-0"}`} />
        <div className={`relative w-full max-w-xl max-h-[85vh] bg-white rounded-[24px] shadow-2xl flex flex-col overflow-hidden transition-all duration-[300ms] ${modal ? "opacity-100 scale-100" : "opacity-0 scale-[0.95]"}`}>
          {selected && (() => { const st = statusStyle(selected.status); return (<>
            {/* Header */}
            <div className="shrink-0 px-6 pt-5 pb-5 border-b border-gray-100">
              <div className="flex items-center justify-between gap-3">
                <button onClick={closeMission} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-[12px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                  <button onClick={closeMission} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <h2 className="mt-5 text-[22px] font-bold leading-tight tracking-tight text-zinc-900">{selected.titre}</h2>

              {/* Infos mission */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-gray-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Domaine</div>
                  <div className="text-[14px] font-semibold mt-1">{selected.domaine}</div>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Budget</div>
                  <div className="text-[14px] font-semibold mt-1">{selected.budget.toLocaleString("fr-FR")} {selected.currency}</div>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Délai</div>
                  <div className="text-[14px] font-semibold mt-1">{selected.delaiJours} jours</div>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Risque</div>
                  <div className="text-[14px] font-semibold mt-1 capitalize">{selected.riskLevel}</div>
                </div>
              </div>
            </div>

            {/* Corps */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 overscroll-contain">
              {selected.description && (
                <div>
                  <h3 className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500 mb-2">Description</h3>
                  <p className="text-[13px] text-zinc-600 leading-relaxed">{selected.description}</p>
                </div>
              )}

              {/* Formulaire de candidature */}
              {selected.status === "publiee" && (
                <div className="rounded-[18px] border border-[#008751]/20 bg-[#f0faf5] p-4">
                  <h3 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#008751]" /> Candidater
                  </h3>
                  <p className="text-[12px] text-zinc-500 mb-3">Proposez votre prix et un message au client.</p>

                  {feedback && (
                    <div className={`mb-3 px-3 py-2 rounded-xl text-[12px] font-medium ${feedback.includes("envoyée") ? "bg-[#f0faf5] text-[#008751] border border-[#008751]/20" : "bg-red-50 text-[#E8112D] border border-red-100"}`}>
                      {feedback}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500">Montant proposé ({selected.currency})</label>
                      <input type="number" value={montant} onChange={(e) => setMontant(e.target.value)}
                        placeholder={String(selected.budget)}
                        className="mt-1 w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500">Message (optionnel)</label>
                      <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                        placeholder="Décrivez votre approche, expérience pertinente..."
                        className="mt-1 w-full min-h-[80px] rounded-xl bg-white border border-gray-200 p-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition resize-none" />
                    </div>
                    <button onClick={submitProposal} disabled={submitting || !montant}
                      className="w-full h-11 rounded-full bg-[#008751] text-white text-[14px] font-semibold shadow-[0_4px_14px_rgba(0,135,81,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                      {submitting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {submitting ? "Envoi..." : "Envoyer ma candidature"}
                    </button>
                  </div>
                </div>
              )}

              {selected.status !== "publiee" && (
                <div className="rounded-[18px] bg-gray-50 border border-gray-100 p-4 flex items-center gap-3">
                  <Clock className="w-4 h-4 text-zinc-400 shrink-0" />
                  <p className="text-[13px] text-zinc-500">Cette mission n'est plus ouverte aux candidatures.</p>
                </div>
              )}
            </div>
          </>); })()}
        </div>
      </div>

      {/* ============ TOASTS ============ */}
      <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto bg-zinc-900 text-white rounded-full px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)] flex items-center gap-2.5 text-[13px] font-medium animate-[toastIn_300ms_cubic-bezier(0.2,0.8,0.2,1)]">
            <span className="text-[14px]">{t.icon}</span>{t.msg}
          </div>
        ))}
      </div>

      <style>{`.scrollbar-none::-webkit-scrollbar{display:none}.scrollbar-none{-ms-overflow-style:none;scrollbar-width:none}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes toastIn{from{opacity:0;transform:translate(-50%,12px) scale(0.96)}to{opacity:1;transform:translate(-50%,0) scale(1)}}`}</style>
    </div>
  );
}
