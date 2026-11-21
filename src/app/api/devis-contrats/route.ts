import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { devisBucket, contratBucket, devisVisibleInList, type DevisBucket, type ContratBucket } from "@/lib/devis-contrats";
import { isRevisionPending } from "@/lib/proposal-status";
import { personFullName } from "@/lib/person-name";
import { computeDevisData, type DevisLineItemInput } from "@/lib/devis";

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
          // Statut de la MISSION : il porte la décision « clôturé » des devis, exactement
          // comme pour les contrats (moins de s'appuyer sur un statut de proposition que
          // rien ne fait sortir de `en_negociation`).
          status: true,
          contract: { select: { id: true } },
          client: { select: { firstname: true, lastname: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const devisCounts: Record<DevisBucket, number> = { brouillon: 0, negociation: 0, valide: 0, rejete: 0, cloture: 0 };
  const devis = proposals
    // Une fois le contrat généré, l'engagement quitte « Devis »… SAUF si la mission est
    // clôturée : le devis retrouve alors sa rubrique terminale « Clôturés » (trace historique
    // de la négociation — le contrat, lui, reste dans « Contrats Signés »). Règle pure et
    // testée : devisVisibleInList (src/lib/devis-contrats.ts).
    .filter((p) => devisVisibleInList({ hasContract: !!p.mission.contract, missionStatus: p.mission.status }))
    .map((p) => {
      const devisData = p.devisData as { totalTTC?: number } | null;
      const bucket = devisBucket(p.status, devisData != null, p.mission.status);
      devisCounts[bucket]++;
      const counterpart = isClient ? p.provider : p.mission.client;
      return {
        id: p.id,
        missionId: p.mission.id,
        missionTitre: p.mission.titre,
        counterpartName: personFullName(counterpart) || (isClient ? "Prestataire" : "Client"),
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

  // Candidatures NON ENVOYÉES (2026-11-09) — retenues faute de KYC vérifié
  // (src/lib/proposal-drafts.ts). Elles sont les vrais brouillons du prestataire : rangées dans
  // « Brouillons », marquées `pending`, avec la raison d'un éventuel envoi automatique refusé.
  // Les deux types y figurent (devis et prix fixe) : la page des brouillons est le seul endroit
  // où le prestataire retrouve tout ce qui n'est pas encore parti chez le client.
  const drafts = isClient
    ? []
    : await prisma.proposalDraft.findMany({
        where: { providerId: userId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          kind: true,
          payload: true,
          lastError: true,
          updatedAt: true,
          mission: { select: { id: true, titre: true, currency: true, client: { select: { firstname: true, lastname: true } } } },
        },
      });
  const pendingDevis = drafts.map((d) => {
    const p = (d.payload ?? {}) as { montant?: number; lineItems?: DevisLineItemInput[]; delay?: string; tvaRate?: number; laborCost?: number };
    const montant =
      d.kind === "devis" && Array.isArray(p.lineItems)
        ? computeDevisData(p.lineItems, p.delay ?? "", "", p.tvaRate ?? 0, p.laborCost ?? 0).totalTTC
        : (p.montant ?? 0);
    devisCounts.brouillon++;
    return {
      id: d.id,
      missionId: d.mission.id,
      missionTitre: d.mission.titre,
      counterpartName: personFullName(d.mission.client) || "Client",
      montant,
      currency: d.mission.currency,
      status: "non_envoyee",
      bucket: "brouillon" as DevisBucket,
      revisionPending: false,
      pending: true,
      kind: d.kind,
      lastError: d.lastError,
      createdAt: d.updatedAt,
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
      counterpartName: personFullName(counterpart) || (isClient ? "Prestataire" : "Client"),
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
    devis: [...pendingDevis, ...devis],
    contrats,
    counts: {
      brouillon: devisCounts.brouillon,
      negociation: devisCounts.negociation,
      valide: devisCounts.valide,
      rejete: devisCounts.rejete,
      // Compteur « Clôturés » des DEVIS — nom distinct de `cloture` (contrats) pour que les
      // deux rubriques homonymes du sidebar restent indépendantes.
      devisCloture: devisCounts.cloture,
      enCours: contratsCounts.en_cours,
      cloture: contratsCounts.cloture,
    },
  });
}
