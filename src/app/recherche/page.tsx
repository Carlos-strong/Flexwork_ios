"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PersonCard } from "@/components/person-card";
import {
  PROVIDER_ROLE_LABEL,
  providerDisplayName,
  providerInitials,
  providerPriceLabel,
} from "@/lib/provider-display";

type Provider = {
  id: string;
  role: string;
  firstname: string | null;
  lastname: string | null;
  avatarPath: string | null;
  country: string | null;
  mainDomain: string | null;
  declaredLevel: string | null;
  tarifUnite: string | null;
  indicativeRate: number | null;
  zoneVille: string | null;
  averageRating: number | null;
  reviewCount: number;
};


// Recherche de prestataires — aligné sur formulaires-flexwork-tous-profils.html.
// Filtre par domaine + rôle, résultats : identité vérifiée uniquement. Cartes de résultat
// au format exact de profil.png (PersonCard, src/components/person-card.tsx).
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751).
//
// 2026-09-09 : l'état de la recherche vit désormais dans l'URL (?domaine=&role=), ce qui
// rend la page adressable depuis l'extérieur — c'est ce qui permet à la barre de recherche
// de la navbar d'envoyer ici, et à un résultat d'être partagé par lien. Le domaine n'est
// plus obligatoire : sans lui, la page liste tous les prestataires vérifiés (mode annuaire).
function SearchProvidersInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDomaine = searchParams.get("domaine") ?? "";
  const urlRole = searchParams.get("role") ?? "";

  const [domaine, setDomaine] = useState(urlDomaine);
  const [role, setRole] = useState(urlRole);
  const [results, setResults] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // La recherche est déclenchée par l'URL, pas par la soumission du formulaire : le
  // formulaire se contente de pousser les paramètres (router.push), et cet effet exécute la
  // requête. Un seul chemin de code sert donc l'arrivée depuis la navbar, le rechargement
  // de la page et la navigation arrière.
  const runSearch = useCallback(async (d: string, r: string) => {
    setError(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (d.trim()) params.set("domaine", d.trim());
    if (r) params.set("role", r);
    try {
      const res = await fetch(`/api/search/prestataires?${params.toString()}`);
      if (!res.ok) {
        setError("Échec de la recherche.");
        setResults(null);
        return;
      }
      const data = await res.json();
      setResults(data.items);
    } catch {
      setError("Échec de la recherche.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDomaine(urlDomaine);
    setRole(urlRole);
    void runSearch(urlDomaine, urlRole);
  }, [urlDomaine, urlRole, runSearch]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (domaine.trim()) params.set("domaine", domaine.trim());
    if (role) params.set("role", role);
    const qs = params.toString();
    router.push(qs ? `/recherche?${qs}` : "/recherche");
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[1000px] mx-auto px-4 py-5 space-y-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h1 className="text-[13px] font-semibold mb-3">Rechercher un prestataire</h1>
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C] mb-3">{error}</div>}
          <form onSubmit={handleSearch} className="flex flex-wrap gap-2.5">
            <input
              type="text"
              placeholder="Domaine (ex: plomberie, design, dev_web...) — vide pour tout voir"
              value={domaine}
              onChange={(e) => setDomaine(e.target.value)}
              className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-[200px] h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
            >
              <option value="">Tous les profils</option>
              <option value="expert_digital">Expert Digital</option>
              <option value="expert_btp_autres">Expert BTP / Autres</option>
              <option value="artisan">Artisan</option>
              <option value="manoeuvre">Manœuvre</option>
            </select>
            <button type="submit" disabled={loading} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
              {loading ? "Recherche..." : "Rechercher"}
            </button>
          </form>
        </div>

        {loading && !results && <p className="text-[13px] text-[#64748B]">Recherche en cours…</p>}

        {results && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {results.length === 0 && (
              <p className="text-[13px] text-[#64748B]">
                {urlDomaine
                  ? `Aucun prestataire vérifié pour « ${urlDomaine} ».`
                  : "Aucun prestataire vérifié pour l'instant."}
              </p>
            )}
            {results.map((p) => (
              <PersonCard
                key={p.id}
                name={providerDisplayName(p)}
                countryCode={p.country}
                avatarSrc={p.avatarPath ? `/api/users/${p.id}/avatar` : null}
                initials={providerInitials(p)}
                subtitle={`${PROVIDER_ROLE_LABEL[p.role] ?? p.role} — ${p.mainDomain ?? "Domaine non renseigné"}${p.zoneVille ? ` • ${p.zoneVille}` : ""}`}
                rating={p.averageRating}
                reviewCount={p.reviewCount}
                priceLabel={providerPriceLabel(p.indicativeRate, p.tarifUnite)}
                href={`/profil/${p.id}`}
              />
            ))}
          </div>
        )}

        <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF] leading-relaxed">
          <strong>Algorithme de classement :</strong> les résultats affichés proviennent uniquement de prestataires à
          l&apos;identité vérifiée. Aucun critère commercial caché n&apos;est appliqué.
        </div>
      </div>
    </div>
  );
}

// useSearchParams() impose une frontière Suspense en Next 14 App Router (sinon la page
// entière bascule en rendu dynamique et le build échoue sur /recherche) — même motif que
// DocumentsNav dans DashboardSidebar.tsx.
export default function SearchProvidersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAF9]" />}>
      <SearchProvidersInner />
    </Suspense>
  );
}
