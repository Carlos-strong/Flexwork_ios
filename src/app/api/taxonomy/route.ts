import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Taxonomie servie pour la CASCADE de saisie (Catégorie → Métier → Compétences), 2026-09-23.
//
// Pourquoi une route de plus alors que /api/categories existe : celle-là sert le Back Office,
// qui a besoin des compteurs et des descriptions pour administrer le catalogue. Un formulaire
// de mission n'a besoin que d'identifiants et de libellés, et la différence se mesure :
//
//   /api/categories (forme actuelle) ............ 35,9 Ko
//   arbre minimal servi ici ..................... 16,2 Ko   (−55 %)
//   arbre complet, services inclus .............. 98,5 Ko   ← jamais servi d'un bloc
//   services d'un métier via /api/services ....... 2,3 Ko
//   services d'un métier servis ici .............. 0,5 Ko   (−78 %)
//
// D'où le découpage : l'arbre catégories+métiers part en une fois (16 Ko, il tient dans la
// première interaction), et les compétences d'un métier ne sont demandées qu'à la sélection
// de ce métier — 0,5 Ko. Charger les 1 306 compétences d'avance coûterait 98 Ko pour n'en
// afficher que six.

export const dynamic = "force-dynamic";

// La taxonomie est éditable depuis le Back Office : on ne la fige pas, mais elle change
// quelques fois par an, pas par minute. Une minute de fraîcheur avec revalidation en
// arrière-plan évite de rejouer la requête à chaque ouverture du formulaire, sans jamais
// servir un catalogue d'hier.
const CACHE = "public, max-age=60, stale-while-revalidate=600";

/**
 * GET /api/taxonomy               → arbre { categories: [{ id, libelle, icon, secteur, metiers[] }] }
 * GET /api/taxonomy?metierId=xxx  → compétences { services: [{ id, libelle, description }] }
 *
 * Chaque métier porte son `riskLevel` (2026-09-24) : le formulaire prestataire affiche
 * l'obligation d'assurance DÈS la sélection du métier, à partir de la même donnée que celle qui
 * décidera, à la publication, si une assurance est exigée. Aucune requête de plus, et aucun
 * risque que l'écran annonce autre chose que la règle appliquée.
 *
 * Lecture publique, comme /api/categories et /api/services : le catalogue est ce que le
 * visiteur voit sur la page d'accueil.
 */
export async function GET(req: NextRequest) {
  const metierId = req.nextUrl.searchParams.get("metierId");

  try {
    if (metierId) {
      const services = await prisma.service.findMany({
        where: { metierId },
        // `description` porte la prestation dont relève la compétence pour les domaines
        // importés à quatre niveaux — c'est ce qui permet de grouper l'affichage.
        select: { id: true, libelle: true, description: true },
        orderBy: { libelle: "asc" },
      });
      return NextResponse.json({ services }, { headers: { "Cache-Control": CACHE } });
    }

    const categories = await prisma.categorie.findMany({
      orderBy: { ordre: "asc" },
      select: {
        id: true,
        libelle: true,
        icon: true,
        // Pôle de la marketplace (DIGITAL / BTP / SERVICES, 2026-09-28) — `null` tant que
        // l'administrateur ne l'a pas classée ; aux écrans de la ranger sous « Autres ».
        secteur: true,
        // Vérification tierce autorisée (2026-10-01) : le formulaire de publication ne propose le
        // mode « OPR / responsable chantier » que pour ces catégories.
        allowsOprVerification: true,
        metiers: {
          select: { id: true, libelle: true, riskLevel: true },
          orderBy: { libelle: "asc" },
        },
      },
    });
    return NextResponse.json({ categories }, { headers: { "Cache-Control": CACHE } });
  } catch {
    return NextResponse.json({ error: "Erreur lors de la lecture de la taxonomie" }, { status: 500 });
  }
}
