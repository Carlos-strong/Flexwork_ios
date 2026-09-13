"use client";

// Catalogue des Gigs + détail + achat — extrait des anciennes pages /gigs et /gigs/[id]
// (supprimées) pour vivre dans la rubrique « Offres » du sidebar CLIENT (onglet
// « Catalogue »). Liste et détail sont réunis dans un seul composant : la sélection est un
// état local, il n'y a plus de navigation de page — on ne quitte jamais la rubrique.
//
// À l'achat, POST /api/gigs/[id]/purchase crée la commande (statut `created`) ; le parent
// bascule alors sur l'onglet « Mes commandes » où le client signe 1/2.
import { useEffect, useState } from "react";
import { Shield, Clock, ArrowLeft } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";

type GigItem = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  prix: number;
  currency: string;
  delaiJours: number;
  tags: string[];
  createdAt: string;
  provider: { id: string; name: string; avatarUrl: string | null };
};

type GigDetail = GigItem & { status: string; isOwn: boolean };

export default function GigCatalog({ onPurchased }: { onPurchased: (orderId: string) => void }) {
  const [gigs, setGigs] = useState<GigItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GigDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    fetchDedupe("/api/gigs")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGigs(d.items ?? []))
      .catch(() => setGigs([]));
  }, []);

  useEffect(() => {
    if (!selectedId) return setDetail(null);
    setDetail(null);
    setError(null);
    fetchDedupe(`/api/gigs/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  async function handleBuy(id: string, prix: number, currency: string) {
    setError(null);
    setBuying(true);
    const res = await fetch(`/api/gigs/${id}/purchase`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBuying(false);
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Impossible d'acheter ce Gig.");
      return;
    }
    void prix;
    void currency;
    onPurchased(data.orderId);
  }

  // ---- Détail d'un Gig ----
  if (selectedId) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 hover:text-[#0A1931]">
          <ArrowLeft className="w-3.5 h-3.5" /> Retour au catalogue
        </button>

        {!detail ? (
          <div className="py-16 text-center text-[13px] text-zinc-400">Chargement…</div>
        ) : (
          <div className="bg-white rounded-[20px] border border-gray-100 p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <span className="px-2.5 py-1 rounded-full bg-[#0A1931] text-white text-[10px] font-bold uppercase tracking-widest">{detail.domaine}</span>
                <h2 className="text-[22px] font-bold text-[#0A1931] mt-3">{detail.titre}</h2>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[26px] font-bold text-[#0A1931]">{detail.prix.toLocaleString("fr-FR")}</div>
                <div className="text-[12px] text-zinc-400">{detail.currency}</div>
              </div>
            </div>

            <p className="text-[14px] text-zinc-600 leading-relaxed whitespace-pre-line mb-5">{detail.description}</p>

            <div className="flex flex-wrap gap-1.5 mb-6">
              {detail.tags.map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#008751] text-[11px] font-medium">{t}</span>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              <div className="flex items-center gap-3 rounded-xl bg-[#f8faf9] border border-gray-100 p-3.5">
                <Clock className="w-4 h-4 text-[#008751]" />
                <div>
                  <div className="text-[11px] text-zinc-400">Livraison</div>
                  <div className="text-[13px] font-semibold text-[#0A1931]">Sous {detail.delaiJours} jour{detail.delaiJours > 1 ? "s" : ""}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#f8faf9] border border-gray-100 p-3.5">
                <Shield className="w-4 h-4 text-[#008751]" />
                <div>
                  <div className="text-[11px] text-zinc-400">Paiement sécurisé</div>
                  <div className="text-[13px] font-semibold text-[#0A1931]">Fonds sous séquestre · remboursement 24h</div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 mb-5 text-[13px] text-zinc-600">
              Proposé par <span className="font-semibold text-[#0A1931]">{detail.provider.name}</span>
            </div>

            {error && <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C] mb-4">{error}</div>}

            {detail.isOwn ? (
              // Un prestataire qui consulte son propre Gig : l'achat est refusé côté serveur
              // (self_dealing_forbidden), on ne propose donc pas le bouton.
              <div className="text-center py-3 text-[13px] text-zinc-500">
                C&apos;est votre Gig.{" "}
                <span className={detail.status === "publie" ? "text-[#008751]" : "text-amber-600"}>
                  {detail.status === "publie" ? "Publié — visible dans le catalogue" : "Brouillon — non visible"}
                </span>
              </div>
            ) : (
              <button
                onClick={() => handleBuy(detail.id, detail.prix, detail.currency)}
                disabled={buying}
                className="w-full h-12 rounded-full bg-[#008751] text-white text-[14px] font-semibold hover:bg-[#007a49] disabled:opacity-50"
              >
                {buying ? "Création de la commande…" : `Acheter — ${detail.prix.toLocaleString("fr-FR")} ${detail.currency}`}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Liste ----
  if (!gigs) return <div className="py-16 text-center text-[13px] text-zinc-400">Chargement…</div>;

  if (gigs.length === 0) {
    return (
      <div className="bg-white rounded-[20px] border border-gray-100 p-16 text-center">
        <div className="text-4xl mb-3">🛍️</div>
        <p className="text-[14px] text-zinc-500 font-medium">Aucun Gig publié pour le moment</p>
        <p className="text-[12px] text-zinc-400 mt-1">Revenez bientôt.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {gigs.map((g) => (
        <button
          key={g.id}
          onClick={() => setSelectedId(g.id)}
          className="bg-white rounded-[20px] border border-gray-100 p-5 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="px-2.5 py-1 rounded-full bg-[#0A1931] text-white text-[10px] font-bold uppercase tracking-widest">{g.domaine}</span>
            <span className="text-[18px] font-bold text-[#0A1931]">{g.prix.toLocaleString("fr-FR")} {g.currency}</span>
          </div>
          <h3 className="text-[15px] font-semibold text-[#0A1931] mb-1">{g.titre}</h3>
          <p className="text-[12.5px] text-zinc-500 line-clamp-2 mb-3">{g.description}</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {g.tags.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#008751] text-[10.5px] font-medium">{t}</span>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-gray-50">
            <div className="text-[12px] text-zinc-500">{g.provider.name}</div>
            <span className="ml-auto text-[12px] text-[#008751] font-medium">Livraison {g.delaiJours} j →</span>
          </div>
        </button>
      ))}
    </div>
  );
}
