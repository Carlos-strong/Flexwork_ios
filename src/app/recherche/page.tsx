import type { Metadata } from "next";
import { cache } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import Header from "@/components/afrilance/Header";
import CategoriesBar from "@/components/afrilance/CategoriesBar";
import Footer from "@/components/afrilance/Footer";
import { prisma } from "@/lib/db";
import { getPublishedFrontendConfig, resolveMenu } from "@/lib/frontend-config";
import { searchProviders } from "@/lib/provider-search";
import { resolveLandingTarget, type LandingCategorie, type LandingTarget } from "@/lib/taxonomy-landing";
import { CategoryLanding, type LandingService } from "./category-landing";
import { SearchResults } from "./search-results";

// Recherche de prestataires — et, depuis le 2026-10-06, page Catégorie / Métier.
//
// Quand l'URL désigne une rubrique de la taxonomie (?categorie=<id>, ?metier=<id>, ou un
// ?domaine= libre qui se rapproche d'un libellé du catalogue, voir taxonomy-landing.ts), la page
// s'ouvre sur l'en-tête de cette rubrique (CategoryLanding) au-dessus des résultats. Sinon elle
// reste la recherche libre / l'annuaire qu'elle était.
//
// Composant SERVEUR : la taxonomie ET les résultats sont lus ici et partent dans le premier HTML
// (aucun aller-retour client, aucun « Recherche en cours… »). Le formulaire vit dans
// SearchResults (client). L'état reste entièrement dans l'URL.

const display = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-landing-display",
  display: "swap",
});

type SearchParams = Record<string, string | string[] | undefined>;
const param = (sp: SearchParams, key: string) => {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
};

// Arbre catégories + métiers, lu UNE fois par requête : generateMetadata et la page en ont
// besoin tous les deux, et `cache` partage le résultat entre eux.
const loadTree = cache(
  (): Promise<LandingCategorie[]> =>
    prisma.categorie.findMany({
      orderBy: { ordre: "asc" },
      select: {
        id: true,
        libelle: true,
        description: true,
        icon: true,
        metiers: { select: { id: true, libelle: true, description: true }, orderBy: { libelle: "asc" } },
      },
    }),
);

async function loadTarget(sp: SearchParams): Promise<LandingTarget | null> {
  const query = { domaine: param(sp, "domaine"), categorie: param(sp, "categorie"), metier: param(sp, "metier") };
  if (!query.domaine && !query.categorie && !query.metier) return null;
  return resolveLandingTarget(await loadTree(), query);
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const [config, target] = await Promise.all([getPublishedFrontendConfig(), loadTarget(searchParams)]);
  if (!target) return { title: "Rechercher un prestataire — FlexWork" };
  const label = target.kind === "metier" ? target.metier.libelle : target.categorie.libelle;
  return { title: `${label} — prestataires vérifiés | FlexWork` };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const [config, target] = await Promise.all([getPublishedFrontendConfig(), loadTarget(searchParams)]);

  const urlParams = {
    domaine: param(searchParams, "domaine"),
    role: param(searchParams, "role"),
    categorie: param(searchParams, "categorie"),
    metier: param(searchParams, "metier"),
    tags: param(searchParams, "tags"),
  };

  // Requête de résultats : la rubrique résolue remplace le libellé libre, qui ne correspond
  // pas forcément au `mainDomain` des profils (« Design » ≠ « Design et UX/UI »).
  const api = new URLSearchParams();
  if (target?.kind === "metier") api.set("metier", target.metier.id);
  else if (target?.kind === "categorie") api.set("categorie", target.categorie.id);
  else if (urlParams.domaine) api.set("domaine", urlParams.domaine);
  if (urlParams.role) api.set("role", urlParams.role);
  if (urlParams.tags) api.set("tags", urlParams.tags);

  const [results, services] = await Promise.all([
    searchProviders(api),
    target
      ? prisma.service.findMany({
          where: { metier: { categorieId: target.categorie.id } },
          select: { metierId: true, libelle: true },
          orderBy: { libelle: "asc" },
        })
      : Promise.resolve([] as LandingService[]),
  ]);

  const scopeLabel = target
    ? [target.kind === "metier" ? target.metier.libelle : target.categorie.libelle, urlParams.tags]
        .filter(Boolean)
        .join(" — ")
    : null;

  return (
    <main className={`landing min-h-screen bg-white ${display.variable}`}>
      <Header exploreLinks={resolveMenu(config, "header_explore")} />
      <CategoriesBar />
      {/* `key` : une nouvelle requête repart d'un formulaire aligné sur l'URL. La largeur est
          posée par section (CategoryLanding) : le héros est plein écran, le reste centré. */}
      <div className="py-6 lg:py-8">
        {target ? (
          <CategoryLanding target={target} services={services} activeTag={urlParams.tags || null}>
            <SearchResults key={api.toString()} results={results} urlParams={urlParams} scopeLabel={scopeLabel} />
          </CategoryLanding>
        ) : (
          <div className="page-shell">
            <SearchResults key={api.toString()} results={results} urlParams={urlParams} scopeLabel={scopeLabel} />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
