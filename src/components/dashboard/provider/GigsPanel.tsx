"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { Plus } from "lucide-react";
import GigCreateForm from "@/components/dashboard/gig/GigCreateForm";

// ---------------------------------------------------------------------------
// "Mes Gigs" — onglet de la rubrique Offres du dashboard prestataire. Liste les Gigs du
// prestataire connecté (tous statuts : brouillon / publié / clôturé) avec leur nombre de
// commandes, alimenté par GET /api/gigs?mine=true. La création se fait EN PLACE
// (GigCreateForm) : la page /gigs/nouveau a été supprimée, tout le Gig vit désormais dans
// la rubrique Offres du sidebar.
// ---------------------------------------------------------------------------

type GigItem = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  prix: number;
  currency: string;
  delaiJours: number;
  tags: string[];
  status: string;
  ordersCount: number;
  createdAt: string;
  provider: { id: string; name: string; avatarUrl: string | null };
};

const GIG_STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  publie: "Publié",
  cloture: "Clôturé",
};

const GIG_STATUS_STYLE: Record<string, string> = {
  brouillon: "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
  publie: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  cloture: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
};

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

export default function GigsPanel() {
  const [gigs, setGigs] = useState<GigItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  // Nommee (et non inline dans l'effet) pour etre rejouee apres une creation en place.
  function load() {
    fetchDedupe("/api/gigs?mine=true")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGigs(d.items ?? []))
      .catch(() => setGigs([]));
  }

  useEffect(load, []);

  const stats = useMemo(
    () => ({
      total: gigs?.length ?? 0,
      publies: gigs?.filter((g) => g.status === "publie").length ?? 0,
      brouillons: gigs?.filter((g) => g.status === "brouillon").length ?? 0,
      commandes: gigs?.reduce((s, g) => s + g.ordersCount, 0) ?? 0,
    }),
    [gigs]
  );

  const statCards = [
    { label: "Gigs", value: stats.total, sub: "au total", color: "border-gray-800", text: "" },
    { label: "Publiés", value: stats.publies, sub: "en vente", color: "border-[#1B9C6A]", text: "text-[#1B9C6A]" },
    { label: "Brouillons", value: stats.brouillons, sub: "non publiés", color: "border-[#FF6B35]", text: "text-[#FF6B35]" },
    { label: "Commandes", value: stats.commandes, sub: "reçues", color: "border-[#0A1931]", text: "" },
  ];

  // Création en place : on remplace tout le panneau par le formulaire plutôt que d'ouvrir
  // une page — la rubrique Offres reste le seul point d'entrée du modèle Gig.
  if (creating) {
    return (
      <GigCreateForm
        onCreated={() => {
          setCreating(false);
          load();
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-extrabold text-[#0A1931]">Mes Gigs</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Tes prestations à prix fixe. Le client achète, signe en premier, tu contre-signes sous 24h.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex h-10 px-5 rounded-full bg-[#FF7A00] text-white text-[13px] font-bold items-center gap-2 shadow-[0_4px_14px_rgba(255,122,0,0.3)] hover:brightness-110 transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Publier un Gig
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#0A1931]">{s.value}</div>
            <div className={`text-[11px] mt-1 ${s.text || "text-gray-400"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {gigs === null ? (
        <div className="bg-white rounded-[20px] p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : gigs.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">🛍️</div>
          <p className="text-[14px] text-zinc-500 font-medium">Aucun Gig pour l&apos;instant.</p>
          <p className="text-[12px] text-zinc-400 mt-1">Publie ta première prestation à prix fixe.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center"
          >
            + Publier le premier Gig
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gigs.map((g) => (
            <div
              key={g.id}
              className="bg-white rounded-[20px] border border-gray-100 p-5 transition-all"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="px-2.5 py-1 rounded-full bg-[#0A1931] text-white text-[10px] font-bold uppercase tracking-widest truncate">{g.domaine}</span>
                <span className={`rounded-full px-3 py-1 text-[11px] font-bold border whitespace-nowrap ${GIG_STATUS_STYLE[g.status] ?? "bg-gray-100"}`}>
                  {GIG_STATUS_LABEL[g.status] ?? g.status}
                </span>
              </div>
              <h3 className="text-[15px] font-semibold text-[#0A1931] mb-1 line-clamp-2">{g.titre}</h3>
              <p className="text-[12.5px] text-zinc-500 line-clamp-2 mb-3">{g.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {g.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#008751] text-[10.5px] font-medium">{t}</span>
                ))}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                <div className="text-[16px] font-bold text-[#FF7A00]">{g.prix.toLocaleString("fr-FR")} {g.currency}</div>
                <div className="text-[11.5px] text-zinc-500">
                  ⏱ {g.delaiJours} j · {g.ordersCount} commande{g.ordersCount > 1 ? "s" : ""}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 mt-2">Créé {timeAgo(g.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
