import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { proposalSchema } from "@/lib/validation";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";
import { notifyMissionParties } from "@/lib/mission-notify";
import { assertNoSelfDealing } from "@/lib/invariants";
import { requireMissionParty } from "@/lib/resource-guard";
import { CLOSED_PROPOSAL_STATUSES, canProviderReviseDevis, computeDevisData } from "@/lib/devis";

// Phase 4 : un prestataire propose un prix sur une mission à prix fixe/taux (budgetType !==
// "QUOTE" — le mode devis a sa propre route, POST /api/missions/[id]/devis).
// US-203 : bloqué tant que le KYC du prestataire n'est pas vérifié — l'autre des deux
// SEULES actions gatées par le KYC (l'autre étant la publication d'une mission).
// Règles de candidature (flowchart) :
//   - Mode distance → KYC vérifié uniquement (US-203, déjà en place)
//   - Mode présentiel/hybride → KYC + assurance si risque HIGH ; garant obligatoire
//     supplémentaire UNIQUEMENT si l'Admin KYC a activé « garant requis » pour ce
//     prestataire (User.garantRequired, défaut OFF — voir checkCandidatureEligibility)
//
// Négociation par rounds (2026-08-29) — même modèle que le mode devis, réutilisé tel quel
// (CLOSED_PROPOSAL_STATUSES, canProviderReviseDevis, computeDevisData, DevisRevision) plutôt
// que dupliqué : la 1ʳᵉ soumission reste "envoyee" (acceptation immédiate toujours possible,
// comme avant), une resoumission n'est permise que si le client a explicitement demandé une
// révision (POST .../request-revision, désormais utilisable dès "envoyee" — voir
// canClientRequestRevision/canClientRejectDevis, src/lib/devis.ts) et passe alors la
// candidature à "en_negociation", round+1 — jusqu'à acceptation mutuelle (POST .../accept),
// rejet explicite (POST .../devis/reject) ou épuisement de mission.maxRevisionRounds.
// `devisData` est renseigné avec UNE seule ligne synthétique (montant = totalTTC) : ça
// réutilise tel quel DevisDetails/Revisions (src/components/devis/devis-panel.tsx) pour
// l'affichage et l'historique, sans dupliquer ces composants pour ce mode.
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
  if (mission.budgetType === "QUOTE") {
    return NextResponse.json({ error: "quote_mission" }, { status: 409 });
  }

  // Famille 4 — invariant : un commanditaire ne peut pas candidater à sa propre mission
  // (auto-attribution). Faille ouverte avant ce correctif — l'API l'acceptait, seule
  // l'interface la masquait. À fermer AVANT toute ouverture du dual-role.
  if (!assertNoSelfDealing(mission.clientId, providerId)) {
    return NextResponse.json({ error: "self_dealing_forbidden" }, { status: 403 });
  }

  // Gardes de candidature partagés (mission ouverte, garant, assurance) — même source que
  // POST /api/missions/[id]/devis (src/lib/candidature-guard.ts).
  const eligibility = await checkCandidatureEligibility(mission, providerId);
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error, message: eligibility.message },
      { status: eligibility.status }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId } },
  });
  if (existing && CLOSED_PROPOSAL_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "already_applied" }, { status: 409 });
  }
  if (existing && existing.roundActuel >= mission.maxRevisionRounds) {
    return NextResponse.json({ error: "max_revisions_reached" }, { status: 409 });
  }
  // La toute première soumission est toujours permise ; une resoumission (round 2+) exige
  // que le client ait explicitement demandé une révision — sinon le prestataire pourrait
  // renégocier son propre prix à volonté sans qu'aucune demande ne l'ait motivé.
  if (!canProviderReviseDevis({ hasDevis: !!existing?.devisData, revisionRequested: !!existing?.revisionRequestedAt })) {
    return NextResponse.json({ error: "revision_not_requested" }, { status: 409 });
  }

  // Ligne synthétique unique — un prix fixe/taux n'a pas de jalons, seulement un montant.
  // tvaRate/laborCost à 0 : totalTTC === parsed.data.montant exactement, aucun calcul caché.
  const devis = computeDevisData(
    [{ description: parsed.data.message?.trim() || "Prix proposé", quantity: 1, unit: "forfait", unitPrice: parsed.data.montant }],
    "",
    "",
    0,
    0
  );
  const newRound = (existing?.roundActuel ?? 0) + 1;

  const proposal = await prisma.$transaction(async (tx) => {
    const p = await tx.missionProposal.upsert({
      where: { missionId_providerId: { missionId, providerId } },
      create: {
        missionId,
        providerId,
        montant: parsed.data.montant,
        // Contre-proposition : le délai proposé par le prestataire, figé dans la candidature
        // et repris tel quel dans le contrat (voir POST /api/missions/[id]/contract).
        delaiPropose: parsed.data.delaiPropose ?? null,
        message: parsed.data.message,
        status: "envoyee",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
      },
      update: {
        montant: parsed.data.montant,
        delaiPropose: parsed.data.delaiPropose ?? null,
        message: parsed.data.message,
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
        comment: newRound === 1 ? "Candidature initiale" : `Révision ${newRound}`,
      },
    });
    return p;
  });

  // Cloche + e-mail pour les DEUX parties : le client reçoit la candidature, le candidat en
  // reçoit l'accusé (2026-09-09 — auparavant une candidature ne notifiait personne).
  await notifyMissionParties({
    missionId,
    type: "candidature_recue",
    counterpart: {
      userId: mission.clientId,
      message: `Nouvelle candidature reçue pour « ${mission.titre} » — ${Math.round(parsed.data.montant).toLocaleString("fr-FR")} ${mission.currency}${parsed.data.delaiPropose ? `, ${parsed.data.delaiPropose} jour(s)` : ""}.`,
      email: {
        subject: `Nouvelle candidature — ${mission.titre}`,
        text: `Un prestataire vient de candidater à votre mission « ${mission.titre} » pour ${Math.round(parsed.data.montant).toLocaleString("fr-FR")} ${mission.currency}. Connectez-vous pour consulter sa proposition.`,
      },
    },
    actor: {
      userId: providerId,
      message: `Votre candidature à « ${mission.titre} » a bien été envoyée${newRound > 1 ? ` (révision ${newRound})` : ""}.`,
      email: {
        subject: `Candidature envoyée — ${mission.titre}`,
        text: `Votre candidature à la mission « ${mission.titre} » a bien été enregistrée. Vous serez notifié dès que le client y aura répondu.`,
      },
    },
  });

  return NextResponse.json(proposal);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: missionId } = await params;

  // F-01 : seuls les participants de la mission peuvent lire ses candidatures — le client
  // propriétaire voit TOUTES les propositions reçues, le PRESTATAIRE voit uniquement SA
  // candidature (même page /missions/[id]/proposals, rôle-aware depuis 2026-09-03). Un
  // tiers → 404, indistinguable d'une mission inexistante (règle R02 du standard de sécurité).
  const guard = await requireMissionParty(missionId, userId);
  if (!guard.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const clientView = guard.isClient;

  const [proposals, mission] = await Promise.all([
    prisma.missionProposal.findMany({
      where: { missionId, ...(clientView ? {} : { providerId: userId }) },
      include: {
        provider: { select: { id: true, email: true, firstname: true, lastname: true, avatarPath: true, country: true } },
        revisions: {
          include: { author: { select: { firstname: true, lastname: true } } },
          orderBy: { roundNumber: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mission.findUnique({
      where: { id: missionId },
      select: { budgetType: true, maxRevisionRounds: true, status: true, currency: true, titre: true },
    }),
  ]);

  // Note moyenne réelle par candidat (même agrégat que GET /api/users/[id]/public-profile) et
  // nombre d'offres déjà envoyées à ce candidat pour CETTE mission (model Offer) — alimente
  // les tuiles de pipeline réelles de la vue candidature côté client (pas de "Entretien"
  // fabriqué, cette notion n'existe pas dans le produit).
  const providerIds = [...new Set(proposals.map((p) => p.providerId))];
  const [reviews, offers] = await Promise.all([
    prisma.review.findMany({ where: { targetId: { in: providerIds }, suspendu: false }, select: { targetId: true, note: true } }),
    prisma.offer.findMany({ where: { missionId, providerId: { in: providerIds } }, select: { providerId: true } }),
  ]);
  const ratingsByProvider = new Map<string, number[]>();
  for (const r of reviews) {
    (ratingsByProvider.get(r.targetId) ?? ratingsByProvider.set(r.targetId, []).get(r.targetId)!).push(r.note);
  }
  const offersByProvider = new Map<string, number>();
  for (const o of offers) {
    offersByProvider.set(o.providerId, (offersByProvider.get(o.providerId) ?? 0) + 1);
  }

  const items = proposals.map((p) => {
    const ratings = ratingsByProvider.get(p.providerId);
    return {
      ...p,
      averageRating: ratings?.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : null,
      offersSent: offersByProvider.get(p.providerId) ?? 0,
    };
  });

  return NextResponse.json({ items, mission });
}
