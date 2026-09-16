import { prisma } from "@/lib/db";
import { contractPrice, emitScopedRelease, releasedAmounts } from "@/lib/escrow";
import {
  MONTANT_EPSILON,
  releasableBeforeRetention,
  remainingReleasableAmount,
} from "@/lib/jalons";
import { closeJalonFullyReleased } from "@/lib/psp-webhook";
import { notifyMissionParties } from "@/lib/mission-notify";
import { escrowScope, type DeliverableScope } from "@/lib/deliverable-scope";

// Acceptation tacite du livrable (2026-09-14) — application de la clause que le contrat fait
// signer aux deux parties :
//
//   « 3. À défaut de contestation dans ce délai, le jalon est réputé accepté et son paiement
//      est déclenché automatiquement (acceptation tacite) »   (src/lib/contract-clauses.ts)
//
// ── Pourquoi ce fichier existe ─────────────────────────────────────────────────────────────
// `PrestationContract.acceptanceDeadlineDays` (7 par défaut) était stocké, affiché dans le
// contrat, repris dans les CGU et sur la page « Comment ça marche », et appliqué NULLE PART.
// `src/lib/checkin-tool.ts` alignait même son délai de contestation « sur le délai
// d'acceptation tacite » — sur une règle qui n'existait pas. Un contrat qui promet un
// automatisme que le code n'exécute pas n'est pas un détail d'implémentation : c'est une clause
// opposable que la plateforme ne tient pas, au détriment du prestataire, qui reste suspendu au
// bon vouloir d'un client silencieux.
//
// ── Ce que cette règle contourne, délibérément ─────────────────────────────────────────────
// La validation ordinaire (handleValidate, src/lib/deliverable-actions.ts) exige deux choses du
// CLIENT : qu'il ait constaté 100 % (`observedProgress`) et qu'il ait apprécié chaque preuve
// (`assertProofsValidated`). L'acceptation tacite contourne exactement ces deux gardes — et
// c'est tout son objet. Elles matérialisent l'action du client ; ici, c'est son SILENCE qui
// vaut acceptation. Les maintenir reviendrait à ne jamais déclencher la clause, puisqu'un
// client qui n'a rien fait n'a par définition ni constaté ni apprécié.
//
// Ce qui n'est PAS contourné, en revanche : le plafond libérable, la retenue de garantie, le
// cumul de ce qui est déjà parti, et le verrou d'émission. Le calcul monétaire est le même que
// celui d'une validation manuelle, à l'octet près — seul le FAIT GÉNÉRATEUR change.

/** Échéance au-delà de laquelle le silence du client vaut acceptation. */
export function tacitAcceptanceDeadline(submittedAt: Date, acceptanceDeadlineDays: number): Date {
  return new Date(submittedAt.getTime() + acceptanceDeadlineDays * 24 * 60 * 60 * 1000);
}

/**
 * Le délai est-il écoulé ?
 *
 * Un `acceptanceDeadlineDays` nul ou négatif DÉSACTIVE la règle au lieu de la déclencher
 * immédiatement. C'est le sens le moins dangereux de la seule valeur ambiguë : un contrat mal
 * renseigné doit laisser la main au client, jamais payer sans délai. La borne est stricte
 * (`>`), pour qu'une acceptation ne survienne pas dans la milliseconde même de l'échéance.
 */
export function isTacitlyAccepted(
  submittedAt: Date | null,
  acceptanceDeadlineDays: number,
  now: Date = new Date()
): boolean {
  if (!submittedAt) return false;
  if (!Number.isFinite(acceptanceDeadlineDays) || acceptanceDeadlineDays <= 0) return false;
  return now.getTime() > tacitAcceptanceDeadline(submittedAt, acceptanceDeadlineDays).getTime();
}

export type TacitOutcome =
  | { applied: true; missionId: string; jalonId: string | null; amount: number }
  | { applied: false; missionId: string; jalonId: string | null; reason: string };

// Un livrable en attente de décision, avec tout ce qu'il faut pour trancher et libérer.
type Candidate = {
  scope: DeliverableScope;
  submittedAt: Date | null;
  acceptanceDeadlineDays: number;
  missionStatus: string;
};

/**
 * Livrables actuellement soumis, toutes portées confondues.
 *
 * Une SEULE requête pour les deux portées : les contrats sont chargés avec leurs jalons, et
 * c'est la présence de jalons qui décide de la portée — exactement la règle de
 * `resolveClientDeliverableScope`. Les balayer séparément aurait recréé la paire de chemins
 * jumeaux que src/lib/deliverable-scope.ts a supprimée.
 *
 * `mediation_ouverte` est exclu ici, à la source : une médiation EST une contestation. Laisser
 * le délai courir pendant un litige ferait payer automatiquement ce qui est précisément en
 * train d'être contesté — le pire mode de défaillance imaginable pour cette règle.
 */
async function findCandidates(): Promise<Candidate[]> {
  const contracts = await prisma.prestationContract.findMany({
    where: {
      mission: { status: { not: "mediation_ouverte" } },
      OR: [
        { jalons: { some: { status: "livrable_soumis" } } },
        { mission: { status: "livrable_soumis" } },
      ],
    },
    include: {
      mission: true,
      jalons: {
        select: {
          id: true,
          titre: true,
          montant: true,
          status: true,
          observedProgress: true,
          submittedAt: true,
        },
      },
    },
  });

  const candidates: Candidate[] = [];
  for (const contract of contracts) {
    const base = {
      missionId: contract.missionId,
      contractId: contract.id,
      clientId: contract.clientId,
      providerId: contract.providerId,
      currency: contract.mission.currency,
      missionTitre: contract.mission.titre,
      financingMode: contract.financingMode,
      retentionRate: contract.retentionRate,
    };

    if (contract.jalons.length > 0) {
      for (const jalon of contract.jalons) {
        if (jalon.status !== "livrable_soumis") continue;
        candidates.push({
          scope: {
            ...base,
            kind: "jalon",
            jalonId: jalon.id,
            jalonTitre: jalon.titre,
            status: jalon.status,
            observedProgress: jalon.observedProgress,
            montant: jalon.montant,
          },
          submittedAt: jalon.submittedAt,
          acceptanceDeadlineDays: contract.acceptanceDeadlineDays,
          missionStatus: contract.mission.status,
        });
      }
      continue;
    }

    if (contract.mission.status !== "livrable_soumis") continue;
    candidates.push({
      scope: {
        ...base,
        kind: "mission",
        jalonId: null,
        jalonTitre: null,
        status: contract.mission.status,
        observedProgress: contract.mission.observedProgress,
        montant: contractPrice(contract),
      },
      submittedAt: contract.mission.submittedAt,
      acceptanceDeadlineDays: contract.acceptanceDeadlineDays,
      missionStatus: contract.mission.status,
    });
  }
  return candidates;
}

/**
 * Applique l'acceptation tacite à UNE portée : libère le solde dû et clôt le livrable.
 *
 * Le calcul monétaire est celui de `handleValidate` — même plafond, même cumul, même émission
 * verrouillée. Il n'est pas factorisé avec lui parce que `handleValidate` est un handler HTTP
 * (il lit `auth()`, parse une requête et renvoie une `NextResponse`) : l'appeler depuis un cron
 * aurait demandé de lui fabriquer une fausse session et une fausse requête, c'est-à-dire de
 * faire passer un automatisme pour un geste humain dans les journaux d'audit comme dans les
 * notifications. Ce qui méritait d'être partagé l'est déjà : `escrowScope`,
 * `releasableBeforeRetention`, `remainingReleasableAmount`, `emitScopedRelease`.
 */
export async function applyTacitAcceptance(scope: DeliverableScope): Promise<TacitOutcome> {
  const identity = { missionId: scope.missionId, jalonId: scope.jalonId };

  // Les fonds doivent être séquestrés : sans HOLD confirmé, il n'y a rien à libérer et accepter
  // tacitement n'aurait aucun effet monétaire.
  const holds = await prisma.pspEscrowOperation.count({
    where: { contractId: scope.contractId, instructionType: "hold", status: "confirmed" },
  });
  if (holds === 0) return { applied: false, ...identity, reason: "funds_not_held" };

  const plafond = releasableBeforeRetention(scope.montant, scope.retentionRate);
  const { inFlight, confirmed } = await releasedAmounts(escrowScope(scope));
  const releaseAmount = remainingReleasableAmount(plafond, inFlight);

  // Progression constatée portée à 100 % : `weightedJalonsProgress` (src/lib/jalons.ts) lit
  // `observedProgress` comme SEULE source d'avancement, et documente qu'un jalon `libere` vaut
  // nécessairement 100. Libérer sans l'écrire laisserait un jalon payé affiché à 0 % d'avancement
  // et fausserait la progression globale de la mission — l'invariant est explicite, il doit être
  // tenu par ce chemin comme par l'autre.
  const markObserved = async () => {
    if (scope.jalonId) {
      await prisma.jalon.updateMany({
        where: { id: scope.jalonId, status: "livrable_soumis" },
        data: { observedProgress: 100 },
      });
    } else {
      await prisma.mission.updateMany({
        where: { id: scope.missionId, status: "livrable_soumis" },
        data: { observedProgress: 100 },
      });
    }
  };

  if (releaseAmount <= 0) {
    // Tout est déjà parti. Mais est-ce ARRIVÉ ? `inFlight` compte les `pending` (règle 18.3) :
    // clôturer sur du non-confirmé serait une clôture optimiste. Même prudence que
    // `handleValidate` — la prochaine passe du balayage repassera.
    if (confirmed < plafond - MONTANT_EPSILON) {
      return { applied: false, ...identity, reason: "release_pending" };
    }
    await markObserved();
    if (scope.jalonId) {
      await closeJalonFullyReleased(scope.jalonId, scope.contractId, scope.missionId);
    } else {
      await prisma.mission.update({
        where: { id: scope.missionId },
        data: { status: "cloturee" },
      });
    }
    await notifyTacitlyAccepted(scope, 0);
    return { applied: true, ...identity, amount: 0 };
  }

  await markObserved();

  const released = await emitScopedRelease({
    contractId: scope.contractId,
    jalonId: scope.jalonId,
    missionId: scope.missionId,
    currency: scope.currency,
    plafond,
    retentionRate: scope.retentionRate,
    targetCumulative: plafond,
  });
  if (!released.ok) {
    // Séquestre insuffisant : le payable est enregistré et reste dû, mais rien n'est versé.
    // Le balayage repassera — c'est le sens même d'un cron idempotent.
    if (released.reason === "escrow_insufficient") {
      return { applied: false, ...identity, reason: "escrow_insufficient" };
    }
    // Course perdue : une validation manuelle du client est passée entre-temps et a tout libéré.
    // C'est le bon dénouement — le client a fini par se prononcer — et il n'y a rien à ajouter.
    return { applied: false, ...identity, reason: "already_released" };
  }
  const operation = released.operation;

  // Même garde que `handleValidate` : la PSP virtuelle en autoconfirm peut avoir déjà fait
  // passer le jalon à `libere` dans le même appel. Écrire `valide` par-dessus le rendrait inerte.
  if (scope.jalonId) {
    await prisma.jalon.updateMany({
      where: { id: scope.jalonId, status: "livrable_soumis" },
      data: { status: "valide" },
    });
  }

  await notifyTacitlyAccepted(scope, operation.amount);
  return { applied: true, ...identity, amount: operation.amount };
}

// Notification explicite des DEUX parties. Le client doit apprendre qu'un paiement est parti
// sans son geste — c'est la contrepartie de son silence, et la seule chose qui rende la clause
// loyale en pratique : elle ne doit jamais être découverte après coup sur un relevé.
async function notifyTacitlyAccepted(scope: DeliverableScope, amount: number) {
  const cible = scope.jalonTitre ? `le jalon « ${scope.jalonTitre} »` : "la mission";
  const montant = amount > 0 ? `${amount.toLocaleString("fr-FR")} ${scope.currency}` : null;
  await notifyMissionParties({
    missionId: scope.missionId,
    type: "deliverable_tacitly_accepted",
    counterpart: {
      userId: scope.providerId,
      message: `Acceptation tacite — ${cible} a été réputé accepté faute de contestation du client dans le délai contractuel.${montant ? ` ${montant} libérés.` : ""}`,
      email: {
        subject: `Acceptation tacite — ${scope.jalonTitre ?? scope.missionTitre}`,
        text: `Le client ne s'est pas prononcé dans le délai contractuel : ${cible} est réputé accepté et son paiement a été déclenché automatiquement.${montant ? ` Montant libéré : ${montant}.` : ""}`,
      },
    },
    actor: {
      userId: scope.clientId,
      message: `Acceptation tacite — ${cible} a été réputé accepté faute de contestation de votre part dans le délai contractuel.${montant ? ` ${montant} libérés au prestataire.` : ""}`,
      email: {
        subject: `Acceptation tacite — ${scope.missionTitre}`,
        text: `Le délai contractuel de contestation est écoulé sans réponse de votre part. Conformément au contrat, ${cible} est réputé accepté et son paiement a été libéré au prestataire.${montant ? ` Montant : ${montant}.` : ""}`,
      },
    },
  });
}

export type SweepReport = {
  examined: number;
  applied: number;
  amount: number;
  skipped: { reason: string; missionId: string; jalonId: string | null }[];
};

/**
 * Balayage complet : accepte tacitement tout livrable dont le délai est écoulé.
 *
 * Séquentiel et non parallèle : chaque acceptation écrit au séquestre et prend le verrou de la
 * ligne de contrat (`emitScopedRelease`). Deux jalons d'un MÊME contrat traités en parallèle se
 * disputeraient ce verrou pour rien — la boucle est plus lente et strictement plus sûre, et le
 * volume attendu (les livrables oubliés depuis plus d'une semaine) ne justifie pas l'inverse.
 *
 * Une portée qui échoue n'interrompt pas les autres : l'erreur est consignée et le balayage
 * continue. Un cron qui s'arrête au premier incident laisserait tous les livrables suivants en
 * attente sans que rien ne le signale.
 */
export async function runTacitAcceptanceSweep(now: Date = new Date()): Promise<SweepReport> {
  const candidates = await findCandidates();
  const report: SweepReport = { examined: candidates.length, applied: 0, amount: 0, skipped: [] };

  for (const candidate of candidates) {
    const identity = { missionId: candidate.scope.missionId, jalonId: candidate.scope.jalonId };
    if (!isTacitlyAccepted(candidate.submittedAt, candidate.acceptanceDeadlineDays, now)) {
      report.skipped.push({ ...identity, reason: "within_deadline" });
      continue;
    }
    try {
      const outcome = await applyTacitAcceptance(candidate.scope);
      if (outcome.applied) {
        report.applied++;
        report.amount += outcome.amount;
      } else {
        report.skipped.push({ ...identity, reason: outcome.reason });
      }
    } catch (error) {
      console.error("[tacit-acceptance] échec", identity, error);
      report.skipped.push({ ...identity, reason: "error" });
    }
  }

  return report;
}
