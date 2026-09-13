import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getFinancingMode, resolveFinancing, DEFAULT_FINANCING_MODE_KEY } from "@/lib/financing-modes";
import type { DevisData } from "@/lib/devis";

// Mode de financement d'UNE mission (2026-09-10) — le client le choisit à la publication
// (POST /api/missions) et peut le corriger ici tant qu'aucun contrat n'est généré.
//
// Pourquoi une route dédiée plutôt qu'un PATCH générique de mission : changer de mode change
// ce que le prestataire doit chiffrer. Ce n'est pas un champ d'affichage — c'est une clause
// économique, qui mérite son propre point d'entrée, son propre contrôle de fenêtre (avant
// contrat) et sa propre trace. Une fois le contrat généré, le mode est FIGÉ dans
// `termsSnapshot.financingModeKey` : aucune route ne le change plus, au même titre que les
// jalons et les montants (options-gestion-jalons.md, « figées à la génération du contrat »).

async function loadOwnedMission(missionId: string, userId: string) {
  return prisma.mission.findFirst({
    where: { id: missionId, clientId: userId },
    include: {
      contract: { select: { id: true } },
      proposals: {
        where: { status: { in: ["acceptee", "devis_valide"] } },
        select: { montant: true, devisData: true },
      },
    },
  });
}

// GET — mode courant + aperçu des jalons qu'il produirait sur le devis accepté (le cas
// échéant). L'aperçu est ce qui rend le choix lisible : le client voit les montants réels
// avant de générer le contrat, pas après.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await loadOwnedMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const mode = mission.financingModeKey ? getFinancingMode(mission.financingModeKey) : null;
  const proposal = mission.proposals[0];
  const devis = (proposal?.devisData as DevisData | null) ?? null;

  // Aperçu seulement si un prix est déjà arrêté (proposition acceptée) — avant cela il n'y a
  // rien à répartir.
  let preview: { titre: string; montant: number }[] | null = null;
  let previewError: string | null = null;
  if (mode && proposal && proposal.montant > 0) {
    const resolved = resolveFinancing(mode, devis, proposal.montant);
    if (resolved.ok) preview = resolved.resolved.jalons;
    else previewError = resolved.error;
  }

  return NextResponse.json({
    financingModeKey: mission.financingModeKey,
    // `locked` dit à l'UI d'afficher le mode sans le rendre modifiable, plutôt que de la
    // laisser tenter un PATCH qui échouerait.
    locked: !!mission.contract,
    mode: mode
      ? {
          key: mode.key,
          label: mode.label,
          definition: mode.definition,
          usesJalons: mode.primitives.useJalons,
          progressive: mode.primitives.financingMode === "progressive",
          sequential: mode.primitives.jalonsSequential,
          // Quatrième levier : l'écran de génération décrivait sinon un mode à retenue de
          // garantie comme un mode sans, en promettant un paiement intégral par jalon.
          retentionRate: mode.primitives.retentionRate,
        }
      : null,
    preview,
    previewError,
    defaultKey: DEFAULT_FINANCING_MODE_KEY,
  });
}

// PATCH — change le mode. Refusé dès qu'un contrat existe.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await loadOwnedMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (mission.contract) {
    return NextResponse.json({ error: "financing_mode_locked" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const mode = getFinancingMode(body?.financingModeKey);
  if (!mode) {
    return NextResponse.json({ error: "financing_mode_unknown" }, { status: 400 });
  }
  if (!mode.available) {
    return NextResponse.json(
      { error: "financing_mode_unavailable", reason: mode.unavailableReason ?? null },
      { status: 400 }
    );
  }

  await prisma.mission.update({
    where: { id: missionId },
    data: { financingModeKey: mode.key },
  });

  return NextResponse.json({ financingModeKey: mode.key });
}
