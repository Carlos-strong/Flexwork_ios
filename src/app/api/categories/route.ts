import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireFrontendEditor } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { isRiskLevel, riskLevelLabel } from "@/lib/metier-risk";
import { parseSecteurInput, secteurLabel } from "@/lib/secteur";

export const dynamic = "force-dynamic";

// Taxonomie Catégorie → Métier → Service — contrat repris tel quel de `flexwork_job`
// (app/api/categories/route.ts). Deux ajouts seulement : les écritures exigent le rôle
// `frontend` (là-bas, cette route n'a aucune garde), et chacune est journalisée.

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/**
 * GET /api/categories
 */
export async function GET() {
  try {
    const categories = await prisma.categorie.findMany({
      orderBy: { ordre: "asc" },
      include: {
        metiers: {
          include: { _count: { select: { services: true } } },
        },
        _count: { select: { metiers: true } },
      },
    });
    return NextResponse.json({ data: categories });
  } catch {
    return NextResponse.json({ error: "Erreur lors de la récupération des catégories" }, { status: 500 });
  }
}

/**
 * POST /api/categories
 * - { categorieId, metierLibelle, description? } → crée un métier
 * - { libelle, description?, icon? } → crée une catégorie
 */
export async function POST(req: NextRequest) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await req.json();

    if (body.categorieId && body.metierLibelle) {
      // Le palier est saisi EN MÊME TEMPS que le métier (2026-09-24) : c'est au moment où l'on
      // décrit le métier qu'on sait si le travail est dangereux, et une colonne laissée à sa
      // valeur par défaut est une colonne qu'on oublie de remplir. Un palier invalide est un
      // refus, jamais un repli silencieux sur « faible ».
      if (body.riskLevel !== undefined && !isRiskLevel(body.riskLevel)) {
        return NextResponse.json({ error: "risk_level_invalid" }, { status: 400 });
      }
      const metier = await prisma.metier.create({
        data: {
          categorieId: body.categorieId,
          libelle: body.metierLibelle,
          description: body.description,
          riskLevel: body.riskLevel ?? "low",
        },
      });
      await logAdminAction({
        adminId: guard.user.id,
        action: "taxonomy_metier_create",
        targetType: "Metier",
        targetId: metier.id,
        justification: `Création du métier « ${metier.libelle} » — risque ${riskLevelLabel(metier.riskLevel)}`,
      });
      return NextResponse.json({ data: metier }, { status: 201 });
    }

    const { libelle, description, icon } = body;
    if (!libelle) return NextResponse.json({ error: "libelle requis" }, { status: 400 });

    // Le marqueur d'âge (A13) s'écrit sur la CATÉGORIE depuis le 2026-09-24 : c'est l'axe qui
    // dit de quel travail il s'agit, là où la filière ne dit que comment on l'exerce. Coché, il
    // impose une date de naissance établie à quiconque choisit un métier de cette catégorie.
    const requiresAgeCheck = body.requiresAgeCheck === true;
    // Vérification tierce (2026-10-01) : autorise le mode « OPR / responsable chantier » à la
    // publication des missions de cette catégorie. Décoché par défaut, comme la barrière d'âge.
    const allowsOprVerification = body.allowsOprVerification === true;
    // Secteur de la marketplace (2026-09-28) : facultatif à la création — une catégorie peut
    // naître « non classée » — mais une valeur inconnue est refusée, jamais ignorée.
    const secteur = parseSecteurInput(body.secteur);
    if (!secteur.ok) return NextResponse.json({ error: "secteur_invalid" }, { status: 400 });
    const cat = await prisma.categorie.create({
      data: { libelle, description, icon, requiresAgeCheck, allowsOprVerification, secteur: secteur.value ?? null },
    });
    await logAdminAction({
      adminId: guard.user.id,
      action: "taxonomy_categorie_create",
      targetType: "Categorie",
      targetId: cat.id,
      justification: `Création de la catégorie « ${cat.libelle} » — secteur ${secteurLabel(cat.secteur)}${requiresAgeCheck ? " — barrière d'âge activée" : ""}${allowsOprVerification ? " — vérification OPR autorisée" : ""}`,
    });
    return NextResponse.json({ data: cat }, { status: 201 });
  } catch (error) {
    if (errorCode(error) === "P2002") return NextResponse.json({ error: "Ce libellé existe déjà" }, { status: 409 });
    if (errorCode(error) === "P2003") return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 });
    console.error("Erreur création catégorie:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/**
 * PUT /api/categories
 * - { id, libelle?, icon?, type:"category" } → modifie une catégorie
 * - { id, libelle, type:"metier" } → modifie un métier
 */
export async function PUT(req: NextRequest) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await req.json();
    const { id, type } = body;

    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

    if (type === "metier") {
      if (!body.libelle?.trim()) return NextResponse.json({ error: "libelle requis" }, { status: 400 });
      if (body.riskLevel !== undefined && !isRiskLevel(body.riskLevel)) {
        return NextResponse.json({ error: "risk_level_invalid" }, { status: 400 });
      }
      // Le palier peut être changé sans renommer le métier : c'est une révision de la règle, pas
      // une correction de libellé. `undefined` (clé absente) le laisse intact — un écran qui ne
      // connaît pas le risque ne doit pas le remettre à « faible » par omission.
      const metier = await prisma.metier.update({
        where: { id },
        data: {
          libelle: body.libelle,
          ...(body.riskLevel !== undefined ? { riskLevel: body.riskLevel } : {}),
        },
      });
      await logAdminAction({
        adminId: guard.user.id,
        action: "taxonomy_metier_update",
        targetType: "Metier",
        targetId: metier.id,
        justification: `Modification du métier « ${metier.libelle} » — risque ${riskLevelLabel(metier.riskLevel)}`,
      });
      return NextResponse.json({ data: metier });
    }

    // Par défaut : mise à jour d'une catégorie
    const data: Prisma.CategorieUpdateInput = {};
    if (body.libelle?.trim()) data.libelle = body.libelle;
    if (body.icon !== undefined) data.icon = body.icon;
    if (body.description !== undefined) data.description = body.description;
    // `undefined` (clé absente) laisse le marqueur intact — un écran qui ne connaît pas la règle
    // ne doit pas la désactiver par omission. C'est la valeur qui parle, jamais l'absence.
    if (body.requiresAgeCheck !== undefined) data.requiresAgeCheck = body.requiresAgeCheck === true;
    // Même règle : clé absente = intact. Retirer l'autorisation ne touche pas les missions déjà
    // publiées en OPR — leur mode est fixé, il ne s'applique qu'aux prochaines publications.
    if (body.allowsOprVerification !== undefined) data.allowsOprVerification = body.allowsOprVerification === true;
    // Même règle pour le secteur : clé absente = intact, `null` = déclassement explicite.
    const secteur = parseSecteurInput(body.secteur);
    if (!secteur.ok) return NextResponse.json({ error: "secteur_invalid" }, { status: 400 });
    if (secteur.value !== undefined) data.secteur = secteur.value;

    const cat = await prisma.categorie.update({ where: { id }, data });
    await logAdminAction({
      adminId: guard.user.id,
      action: "taxonomy_categorie_update",
      targetType: "Categorie",
      targetId: cat.id,
      justification: `Modification de la catégorie « ${cat.libelle} » — secteur ${secteurLabel(cat.secteur)} — barrière d'âge ${cat.requiresAgeCheck ? "activée" : "désactivée"} — vérification OPR ${cat.allowsOprVerification ? "autorisée" : "non proposée"}`,
    });
    return NextResponse.json({ data: cat });
  } catch (error) {
    if (errorCode(error) === "P2025") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    if (errorCode(error) === "P2002") return NextResponse.json({ error: "Ce libellé existe déjà" }, { status: 409 });
    console.error("Erreur modification:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/**
 * DELETE /api/categories
 * - { id, type:"category" } → supprime une catégorie + ses métiers/services
 * - { id, type:"metier" } → supprime un métier + ses services
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const body = await req.json();
    const { id, type } = body;

    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

    if (type === "metier") {
      const metier = await prisma.$transaction(async (tx) => {
        await tx.service.deleteMany({ where: { metierId: id } });
        return tx.metier.delete({ where: { id } });
      });
      await logAdminAction({
        adminId: guard.user.id,
        action: "taxonomy_metier_delete",
        targetType: "Metier",
        targetId: id,
        justification: `Suppression du métier « ${metier.libelle} » et de ses services`,
      });
      return NextResponse.json({ message: "Métier supprimé" });
    }

    // Par défaut : suppression d'une catégorie
    const cat = await prisma.$transaction(async (tx) => {
      await tx.service.deleteMany({ where: { metier: { categorieId: id } } });
      await tx.metier.deleteMany({ where: { categorieId: id } });
      return tx.categorie.delete({ where: { id } });
    });
    await logAdminAction({
      adminId: guard.user.id,
      action: "taxonomy_categorie_delete",
      targetType: "Categorie",
      targetId: id,
      justification: `Suppression de la catégorie « ${cat.libelle} », de ses métiers et services`,
    });
    return NextResponse.json({ message: "Catégorie supprimée" });
  } catch (error) {
    if (errorCode(error) === "P2025") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    console.error("Erreur suppression:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
