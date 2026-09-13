"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Handshake, Search, MessageCircle } from "lucide-react";
import { providerUrl } from "@/lib/provider-urls";
import { Avatar } from "@/components/avatar";
import GigsPanel from "./GigsPanel";
import GigOrdersPanel from "@/components/dashboard/gig/GigOrdersPanel";
import GigOrderDetail from "@/components/dashboard/gig/GigOrderDetail";

// ---------------------------------------------------------------------------
// Même architecture de vue que MissionsSection.tsx / CandidaturesSection.tsx (recherche,
// tuiles de stats, filtres + bascule grille/liste, cartes) — pour rester cohérent avec le
// reste du dashboard prestataire plutôt que d'inventer une 3e mise en page. Alimenté par
// GET /api/offers (model Offer, jusqu'ici sans aucune route ni vue).
// ---------------------------------------------------------------------------

type Offer = {
  id: string;
  titre: string;
  description: string;
  montant: number;
  currency: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  mission: { id: string; titre: string; domaine: string | null; status: string };
  // avatarPath est bien renvoye par l'API consommee ici (select cote route) : seul le type
  // local ne le declarait pas, ce qui faisait echouer next build sur son usage plus bas.
  client: { id: string; firstname: string | null; lastname: string | null; country: string | null; avatarPath: string | null } | null;
};

type CardStatus = "Reçue" | "Acceptée" | "Refusée" | "Expirée";

type Card = {
  id: string;
  titre: string;
  missionTitre: string;
  category: string;
  budget: string;
  status: CardStatus;
  client: string;
  clientId: string | null;
  clientAvatarPath: string | null;
  flag: string;
  time: string;
  href: string;
  missionId: string;
  canRespond: boolean;
};

type Stats = { total: number; recues: number; acceptees: number; refusees: number };

const DISPLAY_STATUS: Record<string, CardStatus> = {
  brouillon: "Reçue",
  envoyee: "Reçue",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee: "Refusée",
  expiree: "Expirée",
};

const STATUS_STYLE: Record<CardStatus, string> = {
  "Reçue": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "Acceptée": "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  "Refusée": "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  "Expirée": "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
};

function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffJ = Math.floor(diffH / 24);
  if (diffJ === 1) return "Hier";
  if (diffJ < 7) return `Il y a ${diffJ}j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

// Section "Offres" du dashboard prestataire (/dashboard/<role>/offres) : désormais un hub
// à onglets qui intègre TOUTES les fonctionnalités Gig sous la rubrique Offres du sidebar :
//   - Offres reçues : offres formelles envoyées par un client à partir d'une candidature
//     (model Offer), distinctes des simples candidatures — un client "choisit" explicitement
//     le prestataire plutôt que de se contenter d'accepter sa proposition.
//   - Mes Gigs (GigsPanel) : les Gigs du prestataire (brouillon/publié/clôturé) + création.
//   - Commandes (GigOrdersPanel) : les commandes achetées sur ses Gigs (cycle inversé 24h).
export default function OffresSection() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [tab, setTab] = useState<"offres" | "gigs" | "commandes">("offres");
  // Detail d'une commande Gig ouvert en place (la page /gigs/commandes/[orderId] a ete
  // supprimee) : c'est ici que le prestataire contre-signe 2/2.
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("Toutes");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  function load() {
    fetchDedupe("/api/offers")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setOffers(d.items ?? []))
      .catch(() => setOffers([]));
  }

  useEffect(load, []);

  async function respond(offerId: string, action: "accept" | "decline") {
    setRespondingId(offerId);
    setFeedback(null);
    const res = await fetch(`/api/offers/${offerId}/${action}`, { method: "POST" });
    setRespondingId(null);
    if (res.ok) {
      setFeedback(action === "accept" ? "Offre acceptée — le contrat peut être généré." : "Offre refusée.");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.error === "offer_not_pending" ? "Cette offre a déjà reçu une réponse." : "Échec de la réponse à l'offre.");
    }
  }

  const cards: Card[] = useMemo(
    () =>
      (offers ?? []).map((o) => ({
        id: o.id,
        titre: o.titre,
        missionTitre: o.mission.titre,
        category: o.mission.domaine ?? "Mission",
        budget: `${o.montant.toLocaleString("fr-FR")} ${o.currency}`,
        status: DISPLAY_STATUS[o.status] ?? "Reçue",
        client: o.client ? [o.client.firstname, o.client.lastname].filter(Boolean).join(" ") || "Client" : "Client",
        clientId: o.client?.id ?? null,
        clientAvatarPath: o.client?.avatarPath ?? null,
        flag: countryFlag(o.client?.country),
        time: timeAgo(o.sentAt ?? o.createdAt),
        href: `/missions/${o.mission.id}`,
        missionId: o.mission.id,
        canRespond: o.status === "envoyee",
      })),
    [offers]
  );

  const stats: Stats = useMemo(
    () => ({
      total: cards.length,
      recues: cards.filter((c) => c.status === "Reçue").length,
      acceptees: cards.filter((c) => c.status === "Acceptée").length,
      refusees: cards.filter((c) => c.status === "Refusée").length,
    }),
    [cards]
  );

  const FILTERS = [
    { id: "Toutes", count: cards.length },
    { id: "Reçue", count: stats.recues },
    { id: "Acceptée", count: stats.acceptees },
    { id: "Refusée", count: stats.refusees },
    { id: "Expirée", count: cards.filter((c) => c.status === "Expirée").length },
  ];

  const filtered = cards.filter((c) => {
    const q = search.toLowerCase();
    const okSearch = c.titre.toLowerCase().includes(q) || c.missionTitre.toLowerCase().includes(q) || c.client.toLowerCase().includes(q);
    const okFilter = activeFilter === "Toutes" || c.status === activeFilter;
    return okSearch && okFilter;
  });

  const statCards = [
    { label: "Total", value: stats.total, sub: "offres reçues", color: "border-gray-800", text: "" },
    { label: "En attente", value: stats.recues, sub: "réponse à donner", color: "border-[#FF6B35]", text: "text-[#FF6B35]" },
    { label: "Acceptées", value: stats.acceptees, sub: "→ contrat sécurisé", color: "border-[#1B9C6A]", text: "text-[#1B9C6A]" },
    { label: "Refusées", value: stats.refusees, sub: "", color: "border-[#EF4444]", text: "text-[#EF4444]" },
  ];

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Offres</h1>
          <p className="text-[13px] text-gray-500 mt-2">Offres formelles, Gigs à prix fixe et commandes reçues.</p>
        </div>
      </div>

      {/* Onglets — les fonctionnalités Gig vivent sous la même rubrique "Offres" du sidebar. */}
      <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto border border-gray-100 shadow-sm w-fit max-w-full">
        {([
          { id: "offres", label: "Offres reçues" },
          { id: "gigs", label: "Mes Gigs" },
          { id: "commandes", label: "Commandes" },
        ] as const).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#0A1931] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "offres" && (
        <>
          {feedback && (
        <div className="px-4 py-3 rounded-xl bg-[#f0faf5] border border-[#008751]/30 text-[13px] font-medium text-[#065f46]">{feedback}</div>
      )}

      <div className="flex items-center bg-[#F9F5F0] rounded-full px-4 py-2.5 w-full text-[13px] border border-transparent focus-within:border-orange-200 focus-within:bg-white transition">
        <Search className="w-4 h-4 text-gray-400 mr-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une offre, une mission, un client..."
          className="bg-transparent outline-none w-full placeholder:text-gray-400 text-[#0A1931]"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#0A1931] font-fraunces">{s.value}</div>
            <div className={`text-[11px] mt-1 ${s.text || "text-gray-400"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

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

      {offers === null ? (
        <div className="bg-white rounded-[20px] p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : cards.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">🤝</div>
          <p className="text-[14px] text-zinc-500 font-medium">Aucune offre reçue pour l&apos;instant.</p>
          <p className="text-[12px] text-zinc-400 mt-1">Une offre t&apos;attend ici si un client choisit ta candidature.</p>
        </div>
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
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                      <span className="text-[10px] text-gray-400 font-mono">#{c.id.slice(-6).toUpperCase()}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">{c.time}</span>
                  </div>
                  <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#FF6B35] transition-colors line-clamp-2">{c.titre}</h3>
                  <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                    <span className="truncate">{c.missionTitre}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full shrink-0" />
                    <span className="font-bold text-[#0A1931] font-fraunces shrink-0">{c.budget}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <Avatar
                      src={c.clientAvatarPath ? `/api/users/${c.clientId}/avatar` : null}
                      initials={c.client.charAt(0)}
                      size={28}
                      gradient="from-[#FF7A00] to-[#E8112D]"
                    />
                    <div className="text-[12px]">
                      <span className="font-semibold text-[#0A1931]">{c.client}</span> <span>{c.flag}</span>
                    </div>
                  </div>
                </div>
                <div className={`flex flex-col gap-2 ${view === "list" ? "sm:w-[180px] shrink-0 mt-2 sm:mt-0" : "mt-4"}`}>
                  {c.canRespond ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => respond(c.id, "accept")}
                        disabled={respondingId === c.id}
                        className="flex-1 bg-[#008751] hover:brightness-110 text-white rounded-full py-2 text-[12px] font-bold transition disabled:opacity-50"
                      >
                        {respondingId === c.id ? "…" : "Accepter"}
                      </button>
                      <button
                        onClick={() => respond(c.id, "decline")}
                        disabled={respondingId === c.id}
                        className="flex-1 bg-[#F8F6F3] hover:bg-gray-100 text-zinc-600 rounded-full py-2 text-[12px] font-bold transition disabled:opacity-50"
                      >
                        Refuser
                      </button>
                    </div>
                  ) : (
                    <Link href={c.href} className="flex-1 bg-[#0A1931] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                      Voir
                    </Link>
                  )}
                  {/* Messagerie unifiée (Messagerie, deep-link ?missionId=) — plus vers
                      /missions/[id]/chat, page dédiée retirée (doublon). */}
                  <Link href={`${providerUrl(role ?? "", "messages")}?missionId=${c.missionId}`} className="bg-[#F8F6F3] hover:bg-gray-100 rounded-full px-3 py-2 flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 font-medium" style={{ textDecoration: "none" }}>
                    <MessageCircle className="w-3.5 h-3.5" /> Message
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
              <div className="text-[24px] mb-2">🔍</div>
              <div className="font-bold text-[14px] text-[#0A1931]">Aucune offre trouvée</div>
              <div className="text-[12px] text-gray-500 mt-1">Essaie un autre filtre ou mot-clé.</div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-[12px] text-gray-400">
        <Handshake className="w-4 h-4" /> Accepter une offre lance automatiquement le contrat sécurisé, comme une candidature acceptée.
      </div>
        </>
      )}

      {tab === "gigs" && <GigsPanel />}

      {tab === "commandes" &&
        (openOrderId ? (
          <GigOrderDetail orderId={openOrderId} onBack={() => setOpenOrderId(null)} />
        ) : (
          <GigOrdersPanel as="provider" onOpenOrder={setOpenOrderId} />
        ))}
    </div>
  );
}
