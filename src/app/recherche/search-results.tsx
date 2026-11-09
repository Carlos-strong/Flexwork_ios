"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, ShieldCheck, UserSearch } from "lucide-react";
import { PersonCard } from "@/components/person-card";
import type { ProviderSearchItem } from "@/lib/provider-search";
import {
  PROVIDER_ROLE_LABEL,
  providerDisplayName,
  providerInitials,
  providerPriceLabel,
} from "@/lib/provider-display";

// Formulaire et résultats de /recherche. Les résultats sont calculés par la page SERVEUR
// (searchProviders) et arrivent en prop : ils sont dans le premier HTML, sans aller-retour vers
// /api/search/prestataires ni état « Recherche en cours… ». Cartes au format de profil.png.
//
// La recherche reste pilotée par l'URL : le formulaire pousse des paramètres, la page serveur
// se re-rend avec les nouveaux résultats. Un seul chemin sert donc la navbar, un lien de
// rubrique, le rechargement et le retour arrière.
export function SearchResults({
  results,
  urlParams,
  scopeLabel,
}: {
  results: ProviderSearchItem[];
  /** Paramètres courants de l'URL de la page. */
  urlParams: { domaine: string; role: string; categorie: string; metier: string; tags: string };
  /** Libellé de la rubrique ouverte, pour le titre et le message « aucun résultat ». */
  scopeLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Page de résultats courante, transmise au profil pour son bouton « Revenir ».
  const searchQuery = new URLSearchParams(
    Object.entries(urlParams).filter(([, v]) => v) as [string, string][],
  ).toString();
  const returnTo = encodeURIComponent(searchQuery ? `/recherche?${searchQuery}` : "/recherche");
  // Dans une rubrique, le champ libre part vide : la rubrique filtre déjà, et y recopier
  // « Plomberie » laisserait croire à un second filtre.
  const [domaine, setDomaine] = useState(scopeLabel ? "" : urlParams.domaine);
  const [role, setRole] = useState(urlParams.role);

  function navigate(next: { domaine: string; role: string }) {
    const params = new URLSearchParams();
    const text = next.domaine.trim();
    if (text) {
      // Un terme saisi lance une nouvelle recherche : on quitte la rubrique courante.
      params.set("domaine", text);
    } else {
      // Champ vide : on reste dans la rubrique, seul le profil change.
      if (urlParams.metier) params.set("metier", urlParams.metier);
      else if (urlParams.categorie) params.set("categorie", urlParams.categorie);
      else if (urlParams.domaine && scopeLabel) params.set("domaine", urlParams.domaine);
      if (urlParams.tags) params.set("tags", urlParams.tags);
    }
    if (next.role) params.set("role", next.role);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/recherche?${qs}` : "/recherche", { scroll: false }));
  }

  // Retrait du filtre de compétence (?tags=) sans quitter le métier.
  const withoutTag = (() => {
    const params = new URLSearchParams();
    if (urlParams.metier) params.set("metier", urlParams.metier);
    else if (urlParams.categorie) params.set("categorie", urlParams.categorie);
    else if (urlParams.domaine) params.set("domaine", urlParams.domaine);
    if (urlParams.role) params.set("role", urlParams.role);
    return `/recherche?${params.toString()}`;
  })();

  return (
    <section id="prestataires" className="scroll-mt-24 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl sm:text-[26px] font-semibold leading-tight tracking-tight text-[#0A1931]">
          {scopeLabel ? (
            <>
              <span className="text-gray-400">Prestataires : </span>
              {scopeLabel}
            </>
          ) : (
            "Rechercher un prestataire"
          )}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#008751]/[0.08] px-3 py-1.5 text-[13px] font-medium text-[#00663d]">
          <ShieldCheck className="w-4 h-4" aria-hidden />
          {results.length} prestataire{results.length > 1 ? "s" : ""} à l&apos;identité vérifiée
        </span>
      </div>

      {/* Barre de recherche unifiée : champ, profil et bouton dans une même capsule. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ domaine, role });
        }}
        className="flex flex-col gap-2 rounded-[22px] bg-white p-2 ring-1 ring-black/[0.07] shadow-[0_8px_30px_-12px_rgba(15,23,42,0.15)] transition focus-within:ring-[#008751]/40 sm:flex-row sm:items-center sm:rounded-full"
      >
        <label className="flex min-w-0 flex-1 items-center gap-2.5 pl-3">
          <Search className="w-[18px] h-[18px] shrink-0 text-gray-400" aria-hidden />
          <span className="sr-only">Domaine</span>
          <input
            type="text"
            placeholder={scopeLabel ? "Chercher un autre domaine…" : "Domaine (ex : plomberie, design…) — vide pour tout voir"}
            value={domaine}
            onChange={(e) => setDomaine(e.target.value)}
            className="h-11 w-full min-w-0 border-0 bg-transparent p-0 shadow-none focus:border-0 focus:shadow-none text-[14px] text-[#0A1931] placeholder:text-gray-400 focus:outline-none"
          />
        </label>
        <span aria-hidden className="hidden h-7 w-px bg-gray-200 sm:block" />
        <select
          value={role}
          aria-label="Profil"
          // Le profil filtre aussitôt choisi : pas besoin de valider le formulaire pour ça.
          onChange={(e) => {
            setRole(e.target.value);
            navigate({ domaine, role: e.target.value });
          }}
          className="h-11 rounded-full border-0 bg-gray-50 px-4 focus:border-0 text-[14px] text-[#0A1931] focus:outline-none focus:ring-2 focus:ring-[#008751]/25 sm:w-[210px] sm:bg-transparent"
        >
          <option value="">Tous les profils</option>
          <option value="expert_digital">Prestataire indépendant</option>
          <option value="expert_btp_autres">Entreprise</option>
          <option value="artisan">Artisan</option>
          <option value="manoeuvre">Manœuvre</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#008751] px-6 text-[14px] font-semibold text-white shadow-md shadow-[#008751]/25 transition hover:-translate-y-0.5 hover:bg-[#007a49] disabled:translate-y-0 disabled:opacity-60"
        >
          {pending ? "Recherche…" : "Rechercher"}
        </button>
      </form>

      {urlParams.tags && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-600">
          Compétence :
          <span className="inline-flex items-center gap-2 rounded-full bg-[#0A1931] py-1 pl-3 pr-1 font-medium text-white">
            {urlParams.tags}
            <Link
              href={withoutTag}
              scroll={false}
              aria-label="Retirer le filtre"
              title="Retirer le filtre"
              className="grid h-6 w-6 place-items-center rounded-full bg-white/15 transition hover:bg-white/30"
            >
              ×
            </Link>
          </span>
        </div>
      )}

      <div className={`transition-opacity duration-300 ${pending ? "opacity-50" : ""}`}>
        {results.length === 0 ? (
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#F2FAF6] via-white to-[#F6F7FB] px-6 py-14 text-center ring-1 ring-black/[0.05]">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#008751] shadow-md ring-1 ring-black/[0.05]">
              <UserSearch className="h-6 w-6" aria-hidden />
            </div>
            <p className="mt-5 text-[17px] font-semibold text-[#0A1931]">
              {scopeLabel
                ? `Aucun prestataire vérifié pour « ${scopeLabel} » pour l'instant.`
                : urlParams.domaine
                  ? `Aucun prestataire vérifié pour « ${urlParams.domaine} ».`
                  : "Aucun prestataire vérifié pour l'instant."}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
              Publiez votre besoin : les prestataires du domaine sont notifiés et vous envoient leurs propositions.
            </p>
            <Link
              href="/missions/new"
              className="group mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-[#008751] px-6 text-[14px] font-semibold text-white shadow-md shadow-[#008751]/25 transition hover:-translate-y-0.5 hover:bg-[#007a49]"
            >
              Publier une mission
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((p, i) => (
              <div
                key={p.id}
                className="h-full animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both motion-reduce:animate-none"
                style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
              >
                <PersonCard
                  name={providerDisplayName(p)}
                  countryCode={p.country}
                  avatarSrc={p.avatarPath ? `/api/users/${p.id}/avatar` : null}
                  initials={providerInitials(p)}
                  roleLabel={PROVIDER_ROLE_LABEL[p.role] ?? p.role}
                  domain={p.mainDomain}
                  city={p.zoneVille}
                  rating={p.averageRating}
                  reviewCount={p.reviewCount}
                  priceLabel={providerPriceLabel(p.indicativeRate, p.tarifUnite)}
                  href={`/profil/${p.id}?returnTo=${returnTo}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
        <span>
          <strong className="font-semibold text-gray-700">Classement :</strong> uniquement des prestataires à l&apos;identité vérifiée,
          sans aucun critère commercial caché.
        </span>
      </p>
    </section>
  );
}
