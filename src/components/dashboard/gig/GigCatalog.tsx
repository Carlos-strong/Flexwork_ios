"use client";

// Catalogue des Gigs + détail + achat — rubrique « Offres » du sidebar CLIENT (onglet
// « Catalogue »). Liste et détail sont réunis dans un seul composant : la sélection est un
// état local, il n'y a plus de navigation de page — on ne quitte jamais la rubrique.
//
// À l'achat, POST /api/gigs/[id]/purchase crée la commande (statut `created`) ; le parent
// bascule alors sur l'onglet « Mes commandes » où le client signe 1/2.
//
// Formules (2026-11-08) : la fiche présente les trois offres Basique / Standard / Premium ; le
// client commande CELLE qu'il a choisie (prix, délai et révisions relus côté serveur). Les
// cartes montrent la couverture et le prix « à partir de ». Recherche par mot-clé (`?q=`).

import { useEffect, useState } from "react";
import { Shield, ArrowLeft, Search } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { GigPackages } from "@/components/gig/GigPackages";
import { GigServiceCard } from "@/components/gig/GigServiceCard";
import { GigImageCarousel } from "@/components/gig/GigImageCarousel";
import type { GigView } from "@/lib/gig-serialize";
import type { GigTier } from "@/lib/gig-rules";

type GigItem = GigView & { provider: { id: string; name: string; avatarUrl: string | null } };
type GigDetail = GigItem & { isOwn: boolean };

export default function GigCatalog({ onPurchased }: { onPurchased: (orderId: string) => void }) {
  const [gigs, setGigs] = useState<GigItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GigDetail | null>(null);
  // Service introuvable / non publié / erreur réseau : on le dit au lieu d'un « Chargement… »
  // sans fin.
  const [detailFailed, setDetailFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  // Formule choisie sur la page publique du service (/services/[id]) : ouverte à l'arrivée.
  const [initialTier, setInitialTier] = useState<GigTier | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const gig = sp.get("gig");
    if (gig) setSelectedId(gig);
    const tier = sp.get("tier");
    if (tier === "basique" || tier === "standard" || tier === "premium") setInitialTier(tier);
  }, []);

  useEffect(() => {
    setGigs(null);
    const url = submittedQuery ? `/api/gigs?q=${encodeURIComponent(submittedQuery)}` : "/api/gigs";
    fetchDedupe(url)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGigs(d.items ?? []))
      .catch(() => setGigs([]));
  }, [submittedQuery]);

  useEffect(() => {
    if (!selectedId) return setDetail(null);
    setDetail(null);
    setDetailFailed(false);
    setError(null);
    let cancelled = false;
    fetchDedupe(`/api/gigs/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GigDetail | null) => {
        if (cancelled) return;
        setDetail(d);
        if (!d) setDetailFailed(true);
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleBuy(id: string, tier: GigTier | null) {
    setError(null);
    setBuying(true);
    const res = await fetch(`/api/gigs/${id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tier ? { tier } : {}),
    });
    const data = await res.json().catch(() => ({}));
    setBuying(false);
    if (!res.ok) {
      setError(data.message ?? data.error ?? "Impossible de commander ce service.");
      return;
    }
    onPurchased(data.orderId);
  }

  if (selectedId) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 hover:text-[#0A1931]">
          <ArrowLeft className="w-3.5 h-3.5" /> Retour au catalogue
        </button>

        {detailFailed ? (
          <div role="alert" className="py-16 text-center text-[13px] text-zinc-500">
            Ce service n&apos;est plus disponible ou n&apos;a pas pu être chargé.
          </div>
        ) : !detail ? (
          <div className="py-16 text-center text-[13px] text-zinc-400">Chargement…</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <div className="bg-white rounded-[20px] border border-gray-100 p-6 lg:p-8 min-w-0">
              <span className="px-2.5 py-1 rounded-full bg-[#F7F7F5] text-[#0A1931] text-[11px] font-semibold">{detail.domaine}</span>
              <h2 className="text-[22px] font-bold text-[#0A1931] mt-3">{detail.titre}</h2>
              <div className="mt-2 flex items-center gap-2 text-[13px] text-zinc-600">
                {detail.provider.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- route d'avatar de l'application
                  <img src={detail.provider.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : null}
                Proposé par
                <a href={`/profil/${detail.provider.id}`} className="font-semibold text-[#0A1931] hover:underline">
                  {detail.provider.name}
                </a>
              </div>

              {(detail.images.length > 0 || detail.videoEmbedUrl) && (
                <div className="mt-5 grid gap-3">
                  {detail.images.length > 0 && <GigImageCarousel images={detail.images} alt={detail.titre} aspect="aspect-[16/9]" rounded="rounded-xl" />}
                  {detail.videoEmbedUrl && (
                    <div className="aspect-video overflow-hidden rounded-xl bg-black">
                      <iframe
                        src={detail.videoEmbedUrl}
                        title={`Vidéo — ${detail.titre}`}
                        className="h-full w-full"
                        allow="encrypted-media; picture-in-picture"
                        allowFullScreen
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                      />
                    </div>
                  )}
                </div>
              )}

              <h3 className="mt-6 text-[15px] font-bold text-[#0A1931]">À propos de ce service</h3>
              <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed whitespace-pre-line">{detail.description}</p>

              {detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-5">
                  {detail.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#008751] text-[11px] font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 lg:sticky lg:top-4 h-fit">
              {error && <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}
              {detail.isOwn ? (
                // Son propre service (2026-11-09) — typiquement après « Commander » sur sa page
                // publique, déconnecté, puis connexion : on le dit clairement, sans formules ni
                // bouton (l'API refuse de toute façon : 409 self_dealing_forbidden).
                <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[13px] text-amber-900">
                  <p className="text-[14px] font-semibold">Vous ne pouvez pas commander votre propre service.</p>
                  <p className="mt-1.5 leading-relaxed">
                    Ce service est le vôtre — {detail.status === "publie" ? "en ligne pour les clients" : "non visible (brouillon)"}. Gérez-le
                    depuis votre espace prestataire.
                  </p>
                  <a
                    href="/profile?tab=services"
                    className="mt-4 inline-flex h-10 items-center rounded-lg bg-[#0A1931] px-4 text-[13px] font-semibold text-white hover:bg-[#1e293b]"
                    style={{ textDecoration: "none" }}
                  >
                    Gérer mes services
                  </a>
                </div>
              ) : (
                <GigPackages
                  key={initialTier ?? "defaut"}
                  initialTier={initialTier}
                  packages={detail.packages}
                  currency={detail.currency}
                  fallback={{ prix: detail.prixDepart, delaiJours: detail.delaiJours }}
                  busy={buying}
                  orderLabel={buying ? "Création de la commande…" : "Commander"}
                  onOrder={(tier) => void handleBuy(detail.id, tier)}
                />
              )}
              <div className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                <Shield className="w-4 h-4 mt-0.5 text-[#008751] shrink-0" />
                <p className="text-[12.5px] text-zinc-600 leading-relaxed">
                  <span className="font-semibold text-[#0A1931]">Paiement sous séquestre.</span> Les fonds ne sont versés qu&apos;après
                  validation de la livraison ; remboursés si le prestataire ne signe pas sous 24 h.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQuery(query.trim());
        }}
        className="flex gap-2"
        role="search"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un service : logo, site web, plomberie…"
            aria-label="Rechercher un service"
            className="w-full h-11 pl-9 pr-3 rounded-full border border-gray-200 bg-white text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
          />
        </div>
        <button type="submit" className="h-11 px-5 rounded-full bg-[#0A1931] text-white text-[13px] font-semibold">
          Rechercher
        </button>
      </form>

      {!gigs ? (
        <div className="py-16 text-center text-[13px] text-zinc-400">Chargement…</div>
      ) : gigs.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-16 text-center">
          <div className="text-4xl mb-3">🛍️</div>
          <p className="text-[14px] text-zinc-500 font-medium">
            {submittedQuery ? `Aucun service pour « ${submittedQuery} ».` : "Aucun service publié pour le moment"}
          </p>
          <p className="text-[12px] text-zinc-400 mt-1">{submittedQuery ? "Essayez un autre mot-clé." : "Revenez bientôt."}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {gigs.map((g) => (
            <li key={g.id}>
              <button type="button" onClick={() => setSelectedId(g.id)} className="block h-full w-full text-left" aria-label={`${g.titre} — voir les formules`}>
                <GigServiceCard
                  titre={g.titre}
                  domaine={g.domaine}
                  coverUrl={g.coverUrl}
                  images={g.images}
                  prixDepart={g.prixDepart}
                  currency={g.currency}
                  footer={<span className="text-[12px] font-medium text-[#E85A24]">{g.provider.name}</span>}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
