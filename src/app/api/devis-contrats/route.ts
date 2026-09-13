import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { devisBucket, contratBucket, type DevisBucket, type ContratBucket } from "@/lib/devis-contrats";
import { isRevisionPending } from "@/lib/proposal-status";

// Alimente le bloc sidebar "Documents Contractuels" (compteurs) et la rubrique dédiée
// "Devis & Contrats" (/client/devis-contrats, /dashboard/<role>/devis-contrats) — voir
// Sidecar-Devis-Contrats-Signes-Vjr. Un "devis" est une MissionProposal sur une mission en
// mode QUOTE dont le contrat n'est pas encore généré (dès qu'un PrestationContract existe,
// l'engagement ne vit plus que côté "Contrats Signés" — jamais affiché deux fois). Le rôle
// (client/prestataire) est déduit de session.user.role, jamais d'un paramètre — chacun ne
// voit que ses propres devis/contrats.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const isClient = session.user.role === "client";

  const proposals = await prisma.missionProposal.findMany({
    where: {
      mission: { budgetType: "QUOTE", ...(isClient ? { clientId: userId } : {}) },
      ...(isClient ? {} : { providerId: userId }),
    },
    select: {
      id: true,
      montant: true,
      status: true,
      devisData: true,
      // Une révision demandée ne change pas `status` : sans ce champ, la rubrique affichait
      // « En négociation » alors qu'une nouvelle version était attendue (2026-09-09).
      revisionRequestedAt: true,
      createdAt: true,
      provider: { select: { firstname: true, lastname: true } },
      mission: {
        select: {
          id: true,
          titre: true,
          currency: true,
          contract: { select: { id: true } },
          client: { select: { firstname: true, lastname: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const devisCounts: Record<DevisBucket, number> = { brouillon: 0, negociation: 0, valide: 0, rejete: 0 };
  const devis = proposals
    .filter((p) => !p.mission.contract) // une fois le contrat généré, l'engagement quitte "Devis"
    .map((p) => {
      const devisData = p.devisData as { totalTTC?: number } | null;
      const bucket = devisBucket(p.status, devisData != null);
      devisCounts[bucket]++;
      const counterpart = isClient ? p.provider : p.mission.client;
      return {
        id: p.id,
        missionId: p.mission.id,
        missionTitre: p.mission.titre,
        counterpartName: [counterpart.firstname, counterpart.lastname].filter(Boolean).join(" ") || (isClient ? "Prestataire" : "Client"),
        montant: devisData?.totalTTC ?? p.montant,
        currency: p.mission.currency,
        status: p.status,
        bucket,
        // Règle partagée avec les autres vues de candidature (src/lib/proposal-status.ts) :
        // le statut terminal prime sur le drapeau.
        revisionPending: isRevisionPending({ status: p.status, revisionRequestedAt: p.revisionRequestedAt }),
        createdAt: p.createdAt,
      };
    });

  const rawContracts = await prisma.prestationContract.findMany({
    where: isClient ? { clientId: userId } : { providerId: userId },
    select: {
      id: true,
      currentHash: true,
      clientSignedAt: true,
      providerSignedAt: true,
      createdAt: true,
      client: { select: { firstname: true, lastname: true } },
      provider: { select: { firstname: true, lastname: true } },
      mission: { select: { id: true, titre: true, budget: true, currency: true, status: true } },
      jalons: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const contratsCounts: Record<ContratBucket, number> = { en_cours: 0, cloture: 0 };
  const contrats = rawContracts.map((c) => {
    const bucket = contratBucket(c.mission.status);
    contratsCounts[bucket]++;
    const counterpart = isClient ? c.provider : c.client;
    return {
      id: c.id,
      missionId: c.mission.id,
      missionTitre: c.mission.titre,
      counterpartName: [counterpart.firstname, counterpart.lastname].filter(Boolean).join(" ") || (isClient ? "Prestataire" : "Client"),
      montant: c.mission.budget,
      currency: c.mission.currency,
      hash: c.currentHash,
      signedAt: c.clientSignedAt && c.providerSignedAt ? (c.clientSignedAt > c.providerSignedAt ? c.clientSignedAt : c.providerSignedAt) : null,
      missionStatus: c.mission.status,
      bucket,
      jalonsCount: c.jalons.length,
      createdAt: c.createdAt,
    };
  });

  return NextResponse.json({
    devis,
    contrats,
    counts: {
      brouillon: devisCounts.brouillon,
      negociation: devisCounts.negociation,
      valide: devisCounts.valide,
      rejete: devisCounts.rejete,
      enCours: contratsCounts.en_cours,
      cloture: contratsCounts.cloture,
    },
  });
}
