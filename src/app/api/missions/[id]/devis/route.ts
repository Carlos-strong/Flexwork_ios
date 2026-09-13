import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";
import { notifyMissionParties } from "@/lib/mission-notify";
import { assertNoSelfDealing } from "@/lib/invariants";
import { devisSchema } from "@/lib/validation";
import {
  ACTIVE_NEGOCIATION_STATUSES,
  EXCLUSIVITY_RELEASING_MISSION_STATUSES,
  CLOSED_PROPOSAL_STATUSES,
  canProviderReviseDevis,
  computeDevisData,
} from "@/lib/devis";

// Soumission / révision d'un devis BTP par le prestataire (mission budgetType = "QUOTE").
// 1ère soumission → round 1, statut "en_negociation" ; chaque re-soumission incrémente le
// round. La proposition est créée au besoin (upsert) : candidater et soumettre un devis est
// une seule et même action pour une demande de devis. Les gardes KYC/garant/assurance sont
// partagées avec POST /api/missions/[id]/proposals (src/lib/candidature-guard.ts).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireVerifiedKyc();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const providerId = guard.userId;
  const { id: missionId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Famille 4 — invariant : un commanditaire ne peut pas soumettre de devis à sa propre
  // mission (même blocage que POST /api/missions/[id]/proposals, mode QUOTE).
  if (!assertNoSelfDealing(mission.clientId, providerId)) {
    return NextResponse.json({ error: "self_dealing_forbidden" }, { status: 403 });
  }
  const eligibility = await checkCandidatureEligibility(mission, providerId);
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error, message: eligibility.message },
      { status: eligibility.status }
    );
  }
  if (mission.budgetType !== "QUOTE") {
    return NextResponse.json({ error: "not_quote_mission" }, { status: 409 });
  }
  if (mission.dateExpiration && new Date(mission.dateExpiration) < new Date()) {
    return NextResponse.json({ error: "mission_expired" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = devisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId } },
  });
  if (existing && CLOSED_PROPOSAL_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "proposal_closed" }, { status: 409 });
  }
  if (existing && existing.roundActuel >= mission.maxRevisionRounds) {
    return NextResponse.json({ error: "max_revisions_reached" }, { status: 409 });
  }
  // Un devis déjà soumis ne peut être resoumis (nouveau round) que si le client a
  // explicitement demandé une révision. La toute première soumission reste toujours permise.
  if (!canProviderReviseDevis({ hasDevis: !!existing?.devisData, revisionRequested: !!existing?.revisionRequestedAt })) {
    return NextResponse.json({ error: "revision_not_requested" }, { status: 409 });
  }

  // Exclusivité : une seule négociation active par prestataire (hors de cette mission).
  // La mission doit être ELLE AUSSI encore en cours — une candidature retenue sur une mission
  // déjà clôturée garde son statut `acceptee`/`devis_valide` à vie et bloquait sinon toute
  // candidature ultérieure (voir EXCLUSIVITY_RELEASING_MISSION_STATUSES, src/lib/devis.ts).
  const activeCount = await prisma.missionProposal.count({
    where: {
      providerId,
      status: { in: [...ACTIVE_NEGOCIATION_STATUSES] },
      missionId: { not: missionId },
      mission: { status: { notIn: [...EXCLUSIVITY_RELEASING_MISSION_STATUSES] } },
    },
  });
  if (activeCount > 0) {
    return NextResponse.json({ error: "active_negotiation_exists" }, { status: 409 });
  }

  const devis = computeDevisData(
    parsed.data.lineItems,
    parsed.data.delay,
    parsed.data.notes ?? "",
    parsed.data.tvaRate,
    parsed.data.laborCost
  );
  // Contre-proposition en jours : `delay` est un texte libre (« 30 jours », « 2 semaines »…).
  // On ne le reflète dans delaiPropose que s'il est un entier simple — sinon le contrat
  // retombe sur mission.delaiJours (le texte reste consultable dans devisData.delay,
  // purement informatif).
  const delaiPropose = /^\d+$/.test(parsed.data.delay.trim()) ? parseInt(parsed.data.delay.trim(), 10) : null;
  const newRound = (existing?.roundActuel ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.missionProposal.upsert({
      where: { missionId_providerId: { missionId, providerId } },
      create: {
        missionId,
        providerId,
        montant: devis.totalTTC,
        delaiPropose,
        message: "Candidature en mode devis",
        status: "en_negociation",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
      },
      update: {
        montant: devis.totalTTC,
        delaiPropose,
        status: "en_negociation",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
        // Consommée : la demande de révision qui vient de motiver cette resoumission ne
        // doit pas rester active pour la suivante — le client devra en redemander une.
        revisionRequestedAt: null,
        revisionRequestMessage: null,
      },
    });
    await tx.devisRevision.create({
      data: {
        proposalId: p.id,
        roundNumber: newRound,
        authorId: providerId,
        devisData: devis as Prisma.InputJsonValue,
        comment: newRound === 1 ? "Première soumission du devis" : `Révision ${newRound}`,
      },
    });
    return p;
  });

  // Cloche + e-mail pour les deux parties — un devis soumis est une candidature en mode
  // QUOTE, il notifie donc comme une candidature (2026-09-09).
  await notifyMissionParties({
    missionId,
    type: "devis_soumis",
    counterpart: {
      userId: mission.clientId,
      message: `Devis reçu pour « ${mission.titre} » — ${Math.round(devis.totalTTC).toLocaleString("fr-FR")} ${mission.currency} TTC${newRound > 1 ? ` (révision ${newRound})` : ""}.`,
      email: {
        subject: `Devis reçu — ${mission.titre}`,
        text: `Un prestataire vient de soumettre un devis de ${Math.round(devis.totalTTC).toLocaleString("fr-FR")} ${mission.currency} TTC pour votre mission « ${mission.titre} ». Connectez-vous pour le consulter, l'accepter ou demander une révision.`,
      },
    },
    actor: {
      userId: providerId,
      message: `Votre devis pour « ${mission.titre} » a bien été envoyé${newRound > 1 ? ` (révision ${newRound})` : ""}.`,
      email: {
        subject: `Devis envoyé — ${mission.titre}`,
        text: `Votre devis pour la mission « ${mission.titre} » a bien été transmis au client. Vous serez notifié dès qu'il y aura répondu.`,
      },
    },
  });

  return NextResponse.json({ proposalId: updated.id, round: newRound, devis });
}
