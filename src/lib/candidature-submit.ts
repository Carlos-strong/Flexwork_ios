// Envoi d'une candidature AU NOM d'un prestataire désigné (2026-11-09).
//
// Le cœur des routes POST /api/missions/[id]/proposals (prix fixe / au temps) et .../devis
// (mission sur devis), extrait pour être appelé aussi hors d'une requête du prestataire : à la
// validation de son KYC, ses candidatures en attente partent d'elles-mêmes (sendPendingApplications,
// src/lib/proposal-drafts.ts) — il ne valide sa candidature qu'une fois. Les routes gardent
// l'authentification et la mise en attente faute de KYC ; tout le reste — gardes, négociation,
// notifications — vit ici, une seule fois.
import { NextResponse } from "next/server";
import { Prisma, type Mission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { devisSchema, proposalSchema } from "@/lib/validation";
import { deleteProposalDraft, type ProposalDraftKind } from "@/lib/proposal-drafts";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";
import { notifyMissionParties, notifyMissionUser } from "@/lib/mission-notify";
import { assertNoSelfDealing } from "@/lib/invariants";
import {
  ACTIVE_NEGOCIATION_STATUSES,
  EXCLUSIVITY_RELEASING_MISSION_STATUSES,
  checkReapplication,
  computeDevisData,
} from "@/lib/devis";
import { getFinancingMode, checkDevisPaymentMode, isDevisPaymentModeKey, DEVIS_FIXED_MODE_KEY } from "@/lib/financing-modes";
import { RATE_UNIT_LABEL, expectedMaxAmount } from "@/lib/spot-time";

/** Prix fixe / au temps — corps de POST /api/missions/[id]/proposals, KYC déjà vérifié. */
export async function submitProposalAs({
  missionId,
  providerId,
  mission,
  body,
}: {
  missionId: string;
  providerId: string;
  mission: Mission | null;
  body: unknown;
}): Promise<NextResponse> {
  const parsed = proposalSchema.safeParse(body);

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

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId } },
  });
  // Une seule candidature par mission : un second envoi n'est permis que comme RÉVISION
  // demandée par le client (src/lib/devis.ts, checkReapplication) — sinon le prestataire
  // repostulerait, ou renégocierait son propre prix à volonté.
  const check = checkReapplication(existing, mission.maxRevisionRounds);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 409 });
  }

  // Mission au TEMPS (S2, 2026-09-15) : le prestataire chiffre un TARIF, et le prix du contrat —
  // le plafond séquestré — en découle (tarif × quantité maximale publiée). `montant` reste la
  // seule valeur que la suite de la chaîne lit (acceptation, contrat, séquestre) ; `unitRate` est
  // conservé pour que le contrat fige le tarif réellement proposé, sans le redériver.
  //
  // Un prix resoumis sans tarif (panneau de renégociation générique) reste accepté : le tarif se
  // déduit alors du plafond, et le dernier relevé en soldera l'arrondi (voir checkCaps).
  const timeMode = mission.financingModeKey ? getFinancingMode(mission.financingModeKey) : null;
  let montant = parsed.data.montant;
  let unitRate: number | null = null;
  if (timeMode?.family === "temps" && timeMode.rateUnit) {
    const maxQuantity = mission.timeMaxQuantity ?? 0;
    if (!(maxQuantity > 0)) {
      return NextResponse.json({ error: "time_terms_missing" }, { status: 409 });
    }
    if (parsed.data.unitRate) {
      unitRate = parsed.data.unitRate;
      montant = expectedMaxAmount({ rate: unitRate, maxQuantity });
    } else if (montant > 0) {
      unitRate = montant / maxQuantity;
    } else {
      return NextResponse.json({ error: "unit_rate_required" }, { status: 400 });
    }
  }

  // Modèle de paiement (fixe ou par jalons, 2026-10-01) — proposé par le prestataire avec son
  // prix, accepté par le client avec lui. Hors mission au temps uniquement : là, c'est l'unité
  // tarifaire publiée qui fixe le régime. Même chaîne de repli que POST .../devis : une
  // révision sans mode garde celui du round précédent, puis celui d'une mission publiée avant
  // cette règle. En dernier recours, un montant unique proposé sans autre précision EST un prix
  // fixe — contrairement au devis détaillé, où l'absence de choix est refusée.
  let paymentModeKey: string | undefined;
  if (timeMode?.family !== "temps") {
    const previousModeKey = (existing?.devisData as { financingModeKey?: string } | null)?.financingModeKey;
    const legacyMissionKey = isDevisPaymentModeKey(mission.financingModeKey) ? mission.financingModeKey : null;
    const paymentMode = checkDevisPaymentMode(
      parsed.data.financingModeKey ?? previousModeKey ?? legacyMissionKey ?? DEVIS_FIXED_MODE_KEY,
      { lineCount: 1, quoteMode: false }
    );
    if (!paymentMode.ok) {
      return NextResponse.json({ error: "payment_mode_invalid" }, { status: 400 });
    }
    paymentModeKey = paymentMode.mode.key;
  }

  // Ligne synthétique unique — un prix fixe/taux n'a pas de jalons, seulement un montant.
  // tvaRate/laborCost à 0 : totalTTC === montant exactement, aucun calcul caché. Au temps, la ligne
  // énonce le tarif et la quantité, pour que la négociation se lise dans les termes du contrat.
  const devis = computeDevisData(
    [
      unitRate !== null && timeMode?.rateUnit
        ? {
            description: parsed.data.message?.trim() || "Prestation au temps",
            quantity: mission.timeMaxQuantity ?? 1,
            unit: RATE_UNIT_LABEL[timeMode.rateUnit].one,
            unitPrice: unitRate,
          }
        : { description: parsed.data.message?.trim() || "Prix proposé", quantity: 1, unit: "forfait", unitPrice: montant },
    ],
    "",
    "",
    0,
    0,
    paymentModeKey
  );
  const newRound = check.round;

  const written = await writeCandidature(existing?.id ?? null, existing?.roundActuel ?? 0, newRound, {
      create: {
        missionId,
        providerId,
        montant,
        unitRate,
        // Contre-proposition : le délai proposé par le prestataire, figé dans la candidature
        // et repris tel quel dans le contrat (voir POST /api/missions/[id]/contract).
        delaiPropose: parsed.data.delaiPropose ?? null,
        message: parsed.data.message,
        status: "envoyee",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
      },
      update: {
        montant,
        unitRate,
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
      revision: {
        roundNumber: newRound,
        authorId: providerId,
        devisData: devis as Prisma.InputJsonValue,
        comment: newRound === 1 ? "Candidature initiale" : `Révision ${newRound}`,
      },
    });
  if (!written) return NextResponse.json({ error: "already_applied" }, { status: 409 });
  const proposal = written;

  // Cloche + e-mail pour les DEUX parties : le client reçoit la candidature, le candidat en
  // reçoit l'accusé (2026-09-09 — auparavant une candidature ne notifiait personne).
  await notifyMissionParties({
    missionId,
    type: "candidature_recue",
    counterpart: {
      userId: mission.clientId,
      message: `Nouvelle candidature reçue pour « ${mission.titre} » — ${Math.round(montant).toLocaleString("fr-FR")} ${mission.currency}${parsed.data.delaiPropose ? `, ${parsed.data.delaiPropose} jour(s)` : ""}.`,
      email: {
        subject: `Nouvelle candidature — ${mission.titre}`,
        text: `Un prestataire vient de candidater à votre mission « ${mission.titre} » pour ${Math.round(montant).toLocaleString("fr-FR")} ${mission.currency}. Connectez-vous pour consulter sa proposition.`,
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

  await deleteProposalDraft(missionId, providerId);
  return NextResponse.json(proposal);
}

/** Devis — corps de POST /api/missions/[id]/devis, KYC déjà vérifié. */
export async function submitDevisAs({
  missionId,
  providerId,
  mission,
  body,
}: {
  missionId: string;
  providerId: string;
  mission: Mission | null;
  body: unknown;
}): Promise<NextResponse> {
  const parsed = devisSchema.safeParse(body);

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

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId } },
  });
  // Une seule candidature par mission : un devis déjà soumis n'est resoumis (nouveau round)
  // que si le client a explicitement demandé une révision (checkReapplication).
  const check = checkReapplication(existing, mission.maxRevisionRounds, "proposal_closed");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 409 });
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

  // Modèle de paiement (fixe ou par jalons, 2026-10-01) : c'est CE devis qui le fixe. Une
  // révision qui ne le renvoie pas garde celui du round précédent ; à défaut, le mode publié
  // sur une mission antérieure à cette règle. Sans aucun des trois, le devis ne dit pas comment
  // il sera payé — le client accepterait un prix sans savoir quand il le décaisse.
  const previousModeKey = (existing?.devisData as { financingModeKey?: string } | null)?.financingModeKey;
  const paymentMode = checkDevisPaymentMode(
    parsed.data.financingModeKey ?? previousModeKey ?? (isDevisPaymentModeKey(mission.financingModeKey) ? mission.financingModeKey : null),
    { lineCount: parsed.data.lineItems.length, quoteMode: true }
  );
  if (!paymentMode.ok) {
    return NextResponse.json(
      { error: paymentMode.error === "payment_mode_invalid" ? "payment_mode_required" : paymentMode.error },
      { status: 400 }
    );
  }

  const devis = computeDevisData(
    parsed.data.lineItems,
    parsed.data.delay,
    parsed.data.notes ?? "",
    parsed.data.tvaRate,
    parsed.data.laborCost,
    paymentMode.mode.key
  );
  // Contre-proposition en jours : `delay` est un texte libre (« 30 jours », « 2 semaines »…).
  // On ne le reflète dans delaiPropose que s'il est un entier simple — sinon le contrat
  // retombe sur mission.delaiJours (le texte reste consultable dans devisData.delay,
  // purement informatif).
  const delaiPropose = /^\d+$/.test(parsed.data.delay.trim()) ? parseInt(parsed.data.delay.trim(), 10) : null;
  const newRound = check.round;

  const updated = await writeCandidature(existing?.id ?? null, existing?.roundActuel ?? 0, newRound, {
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
      revision: {
        roundNumber: newRound,
        authorId: providerId,
        devisData: devis as Prisma.InputJsonValue,
        comment: newRound === 1 ? "Première soumission du devis" : `Révision ${newRound}`,
      },
    });
  if (!updated) return NextResponse.json({ error: "already_applied" }, { status: 409 });

  // Cloche + e-mail pour les deux parties — un devis soumis est une candidature en mode
  // QUOTE, il notifie donc comme une candidature (2026-09-09). Le modèle de paiement y figure
  // (2026-10-01) : le client l'accepte avec le prix, il doit le lire dès la notification.
  const modele =
    paymentMode.mode.family === "fixe" ? "prix fixe" : `par jalons (${paymentMode.mode.label})`;
  await notifyMissionParties({
    missionId,
    type: "devis_soumis",
    counterpart: {
      userId: mission.clientId,
      message: `Devis reçu pour « ${mission.titre} » — ${Math.round(devis.totalTTC).toLocaleString("fr-FR")} ${mission.currency} TTC, paiement ${modele}${newRound > 1 ? ` (révision ${newRound})` : ""}.`,
      email: {
        subject: `Devis reçu — ${mission.titre}`,
        text: `Un prestataire vient de soumettre un devis de ${Math.round(devis.totalTTC).toLocaleString("fr-FR")} ${mission.currency} TTC (paiement ${modele}) pour votre mission « ${mission.titre} ». Connectez-vous pour le consulter, l'accepter ou demander une révision.`,
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

  await deleteProposalDraft(missionId, providerId);
  return NextResponse.json({ proposalId: updated.id, round: newRound, devis });
}

/**
 * Écrit la candidature et sa révision, sans jamais créer une seconde candidature ni écraser la
 * première (2026-11-10). Première soumission : `create` strict — un envoi simultané qui a gagné
 * la course fait échouer celui-ci sur @@unique([missionId, providerId]) (P2002). Révision :
 * mise à jour CONDITIONNÉE au round lu et à la demande de révision encore active — deux
 * révisions simultanées n'en consomment qu'une. Retourne null si l'écriture a perdu la course :
 * l'appelant répond 409 already_applied, sans notifier personne.
 */
async function writeCandidature(
  existingId: string | null,
  readRound: number,
  newRound: number,
  { create, update, revision }: {
    create: Prisma.MissionProposalUncheckedCreateInput;
    update: Prisma.MissionProposalUncheckedUpdateManyInput;
    revision: Omit<Prisma.DevisRevisionUncheckedCreateInput, "proposalId">;
  },
) {
  try {
    return await prisma.$transaction(async (tx) => {
      let id: string;
      if (existingId === null) {
        id = (await tx.missionProposal.create({ data: create, select: { id: true } })).id;
      } else {
        const res = await tx.missionProposal.updateMany({
          where: { id: existingId, roundActuel: readRound, revisionRequestedAt: { not: null } },
          data: update,
        });
        if (res.count === 0) throw new LostRace();
        id = existingId;
      }
      await tx.devisRevision.create({ data: { ...revision, proposalId: id, roundNumber: newRound } });
      return tx.missionProposal.findUniqueOrThrow({ where: { id } });
    });
  } catch (e) {
    if (e instanceof LostRace) return null;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

class LostRace extends Error {}

// Raison lisible d'un envoi automatique refusé (les routes renvoient parfois déjà un message).
const SEND_FAILURES: Record<string, string> = {
  mission_not_open: "la mission n'est plus ouverte aux candidatures",
  mission_expired: "la mission a expiré",
  already_applied: "vous avez déjà candidaté à cette mission",
  proposal_closed: "vous avez déjà candidaté à cette mission",
  self_dealing_forbidden: "il s'agit de votre propre mission",
  payment_mode_invalid: "le modèle de paiement choisi n'est plus proposé",
  candidatures_closed: "la mission a atteint son nombre maximal de candidatures",
};

// Refus DÉFINITIFS (2026-11-10) : rien à corriger côté prestataire, la candidature ne partira
// jamais. Le brouillon était pourtant gardé avec « Corrigez-la puis envoyez-la » — le
// prestataire cherchait quoi corriger sur une mission déjà complète ou attribuée. Il est
// désormais retiré, et la notification le dit. Les autres refus (garant, assurance, âge,
// modèle de paiement…) se corrigent : le brouillon reste, à reprendre.
const FINAL_SEND_FAILURES = new Set([
  "mission_not_open",
  "mission_expired",
  "candidatures_closed",
  "already_applied",
  "proposal_closed",
  "self_dealing_forbidden",
  "quote_mission",
  "not_quote_mission",
  "not_found",
]);

/**
 * KYC validé : les candidatures en attente partent d'elles-mêmes au client (2026-11-09) — le
 * prestataire les a déjà validées une fois. Chacune passe par le même chemin qu'un envoi
 * manuel (submitProposalAs / submitDevisAs : gardes, notifications des deux parties, suppression
 * du brouillon). Un envoi refusé laisse le brouillon, sa raison (`lastError`) et une
 * notification au prestataire, qui la corrige puis l'envoie depuis son tableau de bord.
 * Ne lève jamais : la décision KYC qui l'appelle ne doit pas échouer pour autant.
 */
export async function sendPendingApplications(providerId: string): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const drafts = await prisma.proposalDraft.findMany({ where: { providerId }, include: { mission: true } });
    for (const draft of drafts) {
      const submit = (draft.kind as ProposalDraftKind) === "devis" ? submitDevisAs : submitProposalAs;
      const res = await submit({ missionId: draft.missionId, providerId, mission: draft.mission, body: draft.payload });
      if (res.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      // Sans point final : la raison est insérée au milieu d'une phrase (« …envoyée : <raison>. »).
      const reason = (data.message ?? SEND_FAILURES[data.error ?? ""] ?? "elle a été refusée").replace(/[.\s]+$/, "");
      if (FINAL_SEND_FAILURES.has(data.error ?? "")) {
        await prisma.proposalDraft.delete({ where: { id: draft.id } }).catch(() => {});
        await notifyMissionUser({
          missionId: draft.missionId,
          userId: providerId,
          type: "candidature_envoi_echoue",
          message: `Votre identité est vérifiée, mais votre candidature à « ${draft.mission.titre} » n'a pas pu être envoyée : ${reason}. Elle a été retirée de vos candidatures en attente.`,
          email: {
            subject: `Candidature non envoyée — ${draft.mission.titre}`,
            text: `Votre identité a été vérifiée. Votre candidature à la mission « ${draft.mission.titre} » n'a cependant pas pu être envoyée : ${reason}. Elle a été retirée de vos candidatures en attente. D'autres missions de votre domaine vous attendent sur FlexWork.`,
          },
        });
        continue;
      }
      await prisma.proposalDraft.update({ where: { id: draft.id }, data: { lastError: reason } });
      await notifyMissionUser({
        missionId: draft.missionId,
        userId: providerId,
        type: "candidature_envoi_echoue",
        message: `Votre identité est vérifiée, mais votre candidature à « ${draft.mission.titre} » n'a pas pu être envoyée : ${reason}. Corrigez-la puis envoyez-la depuis votre tableau de bord.`,
        email: {
          subject: `Votre candidature n'a pas pu être envoyée — ${draft.mission.titre}`,
          text: `Votre identité a été vérifiée. Votre candidature à la mission « ${draft.mission.titre} » n'a pas pu être envoyée automatiquement : ${reason}. Corrigez-la puis envoyez-la depuis votre tableau de bord FlexWork.`,
        },
      });
    }
  } catch (e) {
    console.error("[candidature-submit] envoi des candidatures en attente échoué (non bloquant) :", e);
  }
  return { sent, failed };
}
