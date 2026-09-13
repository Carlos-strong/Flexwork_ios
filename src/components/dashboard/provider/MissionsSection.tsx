"use client";
import { useEffect, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import Link from "next/link";
import { Briefcase, Search, MessageCircle, Rocket } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useUserIdentity } from "@/components/user-identity";

// ---------------------------------------------------------------------------
// UI/UX repris de Mes-Missions-Fixed.html (contenu uniquement — ni sidebar ni
// navbar du HTML, le dashboard Next.js a déjà les siens) : titre, stats, recherche,
// filtres, bascule grille/liste, cartes de missions, état vide. Alimenté par des
// données réelles : missions ouvertes (/api/missions) + missions du prestataire en
// cours (provider-summary).
// ---------------------------------------------------------------------------

type RawMission = {
  id: string;
  titre: string;
  domaine?: string | null;
  budget: number;
  currency: string;
  budgetType: string | null;
  delaiJours?: number | null;
  status: string;
  dateExpiration?: string | null;
  // avatarPath est bien renvoye par l'API consommee ici (select cote route) : seul le type
  // local ne le declarait pas, ce qui faisait echouer next build sur son usage plus bas.
  client?: { id: string; firstname: string | null; lastname: string | null; country: string | null; avatarPath: string | null } | null;
};

type RawInProgress = {
  id: string;
  titre: string;
  client?: string;
  budget: number;
  currency: string;
  progress: number;
  echeance: string;
  status?: string;
  hasPendingJalon?: boolean;
};

type Card = {
  id: string;
  titre: string;
  category: string;
  budget: string;
  status: "Ouverte" | "En cours" | "En révision";
  client: string;
  clientId: string | null;
  clientAvatarPath: string | null;
  flag: string;
  deadline: string;
  progress: number;
  href: string;
};

type Stats = { total: number; ouvertes: number; enCours: number; enRevision: number; livre: number };

const STATUS_STYLE: Record<string, string> = {
  "Ouverte": "bg-[#FFF1E6] text-[#C2410C] border-[#FFD6BA]",
  "En cours": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "En révision": "bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]",
  "Livrée": "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  "Propositions": "bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]",
  "Annulée": "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
};

function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function fmtBudget(budget: number, currency: string, budgetType: string | null): string {
  return budgetType === "QUOTE" ? "Sur devis" : `${budget.toLocaleString("fr-FR")} ${currency}`;
}

function deadlineFromEcheance(e?: string): string {
  if (!e) return "En cours";
  const days = Math.ceil((new Date(e).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  return `J-${days}`;
}

function deadlineOf(m: RawMission): string {
  if (m.dateExpiration) {
    const days = Math.ceil((new Date(m.dateExpiration).getTime() - Date.now()) / 86400000);
    if (days <= 0) return "Fermée";
    if (days === 1) return "Demain";
    return `J-${days}`;
  }
  if (m.delaiJours) return `J-${m.delaiJours}`;
  return "Ouverte";
}

// Métadonnées par rôle prestataire — la page s'adapte au profil (filière, garants,
// assurance effective). Clé = slug du dashboard (expert-digital, expert-btp, artisan,
// manoeuvre). Documenté dans etat-consolide-Flexwork.md §2 (A9/A13) : assurance bloquante
// sur risque élevé. L'exigence de garant, elle, n'est PLUS annoncée en dur pour la filière
// chantier : elle est désactivée par défaut et activée compte par compte par l'Admin KYC
// (User.garantRequired) — la phrase correspondante n'est ajoutée que si elle s'applique
// vraiment à CE compte (2026-09-09).
const PROVIDER_ROLE_META: Record<string, { label: string; subtitle: string }> = {
  "expert-digital": {
    label: "Expert Digital",
    subtitle: "Missions à distance — pas de garant ni d'assurance requis, sauf domaine exceptionnellement classé à risque.",
  },
  "expert-btp": {
    label: "Expert BTP / Autres",
    subtitle: "Filière chantier : assurance effective requise sur les missions à risque élevé.",
  },
  artisan: {
    label: "Artisan",
    subtitle: "Filière chantier : assurance effective requise sur les missions à risque élevé.",
  },
  manoeuvre: {
    label: "Manœuvre",
    subtitle: "Filière chantier : assurance effective requise sur les missions à risque élevé.",
  },
};

// Ajoutée au sous-titre uniquement quand l'exigence est active sur le compte.
const GARANT_NOTICE = " Garant obligatoire exigé pour vos candidatures en présentiel ou hybride.";

export default function MissionsSection({ role }: { role: string }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, ouvertes: 0, enCours: 0, enRevision: 0, livre: 0 });
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("Toutes");
  const [view, setView] = useState<"grid" | "list">("grid");
  // Identité partagée (chargée une fois au niveau racine) — porte aussi garantRequired.
  const identity = useUserIdentity();
  // La page tient compte du rôle du prestataire : titre/sous-titre adaptés à la filière.
  const baseMeta = PROVIDER_ROLE_META[role] ?? PROVIDER_ROLE_META["expert-digital"];
  // Exigence de garant propre au compte (défaut OFF) — voir user-identity.tsx / users/me.
  const meta = identity?.garantRequired
    ? { ...baseMeta, subtitle: baseMeta.subtitle + GARANT_NOTICE }
    : baseMeta;

  useEffect(() => {
    Promise.all([
      fetchDedupe("/api/missions").then((r) => (r.ok ? r.json() : { items: [] })),
      fetchDedupe("/api/dashboard/provider-summary").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([miss, sum]) => {
        const available: Card[] = (miss.items ?? [])
          .filter((m: RawMission) => m.status === "publiee")
          .map((m: RawMission) => ({
            id: m.id,
            titre: m.titre,
            category: m.domaine ?? "Mission",
            budget: fmtBudget(m.budget, m.currency, m.budgetType),
            status: "Ouverte" as const,
            client: m.client
              ? [m.client.firstname, m.client.lastname].filter(Boolean).join(" ") || "Client"
              : "Nouveau client",
            clientId: m.client?.id ?? null,
            clientAvatarPath: m.client?.avatarPath ?? null,
            flag: countryFlag(m.client?.country),
            deadline: deadlineOf(m),
            progress: 0,
            href: `/missions/${m.id}`,
          }));
        const inProgress: Card[] = (sum?.inProgress ?? []).map((m: RawInProgress) => ({
          id: m.id,
          titre: m.titre,
          category: "Mission",
          budget: fmtBudget(m.budget, m.currency, null),
          status: (m.status === "livrable_soumis" || m.hasPendingJalon ? "En révision" : "En cours") as "En révision" | "En cours",
          client: m.client ?? "Client",
          // provider-summary ne renvoie pas encore l'id du client sur les missions en
          // cours (juste son nom affiché) — pas de photo possible ici tant que ce n'est
          // pas ajouté à cet endpoint, repli sur les initiales.
          clientId: null,
          clientAvatarPath: null,
          flag: countryFlag(null),
          deadline: deadlineFromEcheance(m.echeance),
          progress: m.progress ?? 0,
          // "Voir" sur une mission EN COURS mène directement à la gestion des livrables
          // (/missions/[id]/deliverable — vue "Gestion des livrables — Mode Freelance",
          // reprise de la maquette VJR : preuves par catégorie, jalons, soumission) plutôt
          // qu'à la page mission générique. Ces cartes viennent de provider-summary,
          // IN_PROGRESS_STATUSES exige un contrat existant (proposition_acceptee → livrable_
          // soumis) : la page gère déjà tous ces statuts, y compris "rien à faire encore"
          // (jalon en_attente) — un lien "← Retour au détail de la mission" y ramène. Les
          // missions "Ouverte" (candidater, ci-dessous) restent sur /missions/{id} : rien à
          // livrer avant d'avoir été retenu.
          href: `/missions/${m.id}/deliverable`,
        }));
        const completed = sum?.stats?.missionsCompleted ?? 0;
        setCards([...inProgress, ...available]);
        setStats({
          total: available.length + inProgress.length + completed,
          ouvertes: available.length,
          enCours: inProgress.filter((c) => c.status === "En cours").length,
          enRevision: inProgress.filter((c) => c.status === "En révision").length,
          livre: completed,
        });
      })
      .catch(() => setCards([]));
  }, []);

  const FILTERS = [
    { id: "Toutes", count: stats.total },
    { id: "Ouvertes", count: stats.ouvertes },
    { id: "En cours", count: stats.enCours },
    { id: "En révision", count: stats.enRevision },
    { id: "Livrées", count: stats.livre },
  ];

  const filtered = (cards ?? []).filter((c) => {
    const q = search.toLowerCase();
    const okSearch =
      c.titre.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.client.toLowerCase().includes(q);
    const okFilter = activeFilter === "Toutes" || c.status === activeFilter;
    return okSearch && okFilter;
  });

  const statCards = [
    { label: "Total", value: stats.total, sub: "toutes missions", color: "border-gray-800", text: "" },
    { label: "En cours", value: stats.enCours, sub: "• actif maintenant", color: "border-[#FF6B35]", text: "text-[#FF6B35]" },
    { label: "En révision", value: stats.enRevision, sub: "en attente validation", color: "border-[#F7C948]", text: "" },
    { label: "Livrées", value: stats.livre, sub: "✓ terminées", color: "border-[#1B9C6A]", text: "text-[#1B9C6A]" },
  ];

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      {/* Titre + action */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Mes Missions</h1>
            <span className="rounded-full bg-[#0A1931] text-white text-[10px] font-bold tracking-wide px-3 py-1.5">{meta.label}</span>
          </div>
          <p className="text-[13px] text-gray-500 mt-2">{meta.subtitle}</p>
        </div>
        <button
          onClick={() => { setSearch(""); setActiveFilter("Ouvertes"); }}
          className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white rounded-full px-5 py-[10px] text-[13px] font-bold shadow-[0_4px_14px_rgba(255,107,53,0.3)] hover:shadow-[0_6px_20px_rgba(255,107,53,0.4)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2 shrink-0"
        >
          <Rocket className="w-4 h-4" /> Voir les missions ouvertes
          {stats.ouvertes > 0 && (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-white/25 text-[11px] font-bold leading-5 inline-flex items-center justify-center">{stats.ouvertes}</span>
          )}
        </button>
      </div>

      {/* Recherche */}
      <div className="flex items-center bg-[#F9F5F0] rounded-full px-4 py-2.5 w-full text-[13px] border border-transparent focus-within:border-orange-200 focus-within:bg-white transition">
        <Search className="w-4 h-4 text-gray-400 mr-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher mission, catégorie, client..."
          className="bg-transparent outline-none w-full placeholder:text-gray-400 text-[#0A1931]"
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#0A1931]">{s.value}</div>
            <div className={`text-[11px] mt-1 ${s.text || "text-gray-400"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtres + vue */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto border border-gray-100 shadow-sm">
          {FILTERS.map((f) => {
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#0A1931] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
              >
                {f.id} <span className={`ml-1 ${active ? "text-white/70" : "text-gray-400"}`}>{f.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white rounded-full p-1 flex border border-gray-100 shadow-sm">
            <button onClick={() => setView("grid")} title="Grille" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "grid" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}>⊞</button>
            <button onClick={() => setView("list")} title="Liste" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "list" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}>☰</button>
          </div>
        </div>
      </div>

      {/* Cartes */}
      {cards === null ? (
        <div className="bg-white rounded-[20px] p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : (
        <>
          <div className={view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-3"}>
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`group bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all ${view === "list" ? "flex flex-col sm:flex-row sm:items-center gap-4" : ""}`}
              >
                <div className={view === "list" ? "flex-1 min-w-0" : ""}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${STATUS_STYLE[c.status] || "bg-gray-100"}`}>{c.status}</span>
                      <span className="text-[10px] text-gray-400 font-mono">#{c.id.slice(-6).toUpperCase()}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                      {c.deadline.startsWith("J-") || c.deadline === "Aujourd'hui" || c.deadline === "Demain" ? `⏰ ${c.deadline}` : c.deadline}
                    </span>
                  </div>
                  <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#FF6B35] transition-colors line-clamp-2">{c.titre}</h3>
                  <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                    <span>{c.category}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full" />
                    <span className="font-bold text-[#0A1931]">{c.budget}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <Avatar
                      src={c.clientAvatarPath ? `/api/users/${c.clientId}/avatar` : null}
                      initials={c.client.charAt(0)}
                      size={28}
                      gradient="from-[#FF6B35] to-[#F7C948]"
                    />
                    <div className="text-[12px]">
                      <span className="font-semibold text-[#0A1931]">{c.client}</span> <span>{c.flag}</span>
                    </div>
                  </div>
                  {c.progress > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                        <span>Progression</span>
                        <span className="text-[#0A1931]">{c.progress}%</span>
                      </div>
                      <div className="h-[6px] bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full transition-all" style={{ width: `${c.progress}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className={`flex gap-2 ${view === "list" ? "sm:w-[150px] shrink-0 mt-2 sm:mt-0" : "mt-4"}`}>
                  {c.status === "Ouverte" ? (
                    <Link href={c.href} className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white rounded-full py-2 text-[12px] font-bold transition hover:brightness-110 text-center" style={{ textDecoration: "none" }}>
                      Candidater
                    </Link>
                  ) : (
                    <Link href={c.href} className="flex-1 bg-[#0A1931] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                      Voir
                    </Link>
                  )}
                  {/* `role` ici est déjà le slug d'URL (ex. "expert-digital", voir les
                      dashboards prestataire qui le passent tel quel) — pas la valeur de
                      rôle en base, donc pas besoin de providerUrl()/ROLE_TO_SLUG. Pointe
                      vers la messagerie unifiée (Messagerie, deep-link ?missionId=) — plus
                      vers /missions/[id]/chat, page dédiée retirée (doublon). */}
                  <Link href={`/dashboard/${role}/messages?missionId=${c.id}`} className="bg-[#F8F6F3] hover:bg-gray-100 rounded-full px-3 py-2 flex items-center justify-center" style={{ textDecoration: "none" }}>
                    <MessageCircle className="w-4 h-4 text-zinc-500" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
              <div className="text-[24px] mb-2">🔍</div>
              <div className="font-bold text-[14px] text-[#0A1931]">Aucune mission trouvée</div>
              <div className="text-[12px] text-gray-500 mt-1">Essaie un autre filtre ou mot-clé.</div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-[12px] text-gray-400">
        <Briefcase className="w-4 h-4" /> Ton profil est analysé automatiquement : les missions affichées correspondent à ton domaine.
      </div>
    </div>
  );
}
