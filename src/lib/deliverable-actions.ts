import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { emitScopedRelease, releasedAmounts } from "@/lib/escrow";
import {
  MONTANT_EPSILON,
  progressiveReleaseTarget,
  releasableBeforeRetention,
  remainingReleasableAmount,
  retentionAmount,
} from "@/lib/jalons";
import { canDecideDeliverable, isValidProgress } from "@/lib/progress-rules";
import { assertProofsValidated } from "@/lib/proof-appreciation";
import { notifyMissionParties } from "@/lib/mission-notify";
import { closeJalonFullyReleased } from "@/lib/psp-webhook";
import {
  deliverableLabel,
  escrowScope,
  observedProgressUpdate,
  proofScope,
  resolveClientDeliverableScope,
  type DeliverableScope,
} from "@/lib/deliverable-scope";
import {
  autoConfirmPending,
  isVirtualPspEnabled,
  shouldAutoConfirmStub,
  virtualPspName,
} from "@/lib/psp-virtual";

// Gestes de validation du client, écrits UNE fois pour les deux portées (un jalon, ou la
// mission entière sans jalon). Voir src/lib/deliverable-scope.ts pour le pourquoi : ces
// handlers vivaient en double, une copie par portée, et divergeaient.
//
// Les routes qui les appellent ne contiennent plus que l'aiguillage : quelle portée, et quel
// code d'erreur renvoyer si l'appelant s'est trompé de variante.

type ActionArgs = {
  missionId: string;
  jalonId: string | null;
  /** Erreur si l'appelant vise la mission alors que le contrat est fractionné. */
  wrongScopeError: string;
};

async function authenticate(): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await auth();
  if (!session?.user) {
    return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  return { userId: (session.user as typeof session.user & { id: string }).id };
}

/** Résolution commune : authentification, portée, et garde « un livrable est-il soumis ? ». */
async function prepare(
  args: ActionArgs,
  { requireDeliverable = true }: { requireDeliverable?: boolean } = {}
): Promise<{ userId: string; scope: DeliverableScope } | { response: NextResponse }> {
  const auth = await authenticate();
  if ("response" in auth) return auth;

  const resolved = await resolveClientDeliverableScope({ ...args, userId: auth.userId });
  if (!resolved.ok) {
    return { response: NextResponse.json({ error: resolved.error }, { status: resolved.status }) };
  }
  if (requireDeliverable && !canDecideDeliverable(resolved.scope.status)) {
    return { response: NextResponse.json({ error: "no_deliverable_submitted" }, { status: 409 }) };
  }
  return { userId: auth.userId, scope: resolved.scope };
}

/** Lecture et bornage du champ `progress` du corps de requête. */
function readProgress(body: unknown): number | null {
  const value = (body as { progress?: unknown } | null)?.progress;
  return isValidProgress(value) ? Math.round(value) : null;
}

/** « Constat sur le terrain » facultatif de la modale client, transmis dans les notifications. */
function readNote(body: unknown): string | null {
  const note = (body as { note?: unknown } | null)?.note;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

// ── POST .../observe-progress ──────────────────────────────────────────────────────────────
// Le client enregistre la progression qu'il CONSTATE (par opposition à declaredProgress, ce que
// le prestataire affirme) — seul observedProgress gate la libération des fonds.
export async function handleObserveProgress(req: Request, args: ActionArgs): Promise<NextResponse> {
  const prepared = await prepare(args);
  if ("response" in prepared) return prepared.response;
  const { scope } = prepared;

  const progress = readProgress(await req.json().catch(() => null));
  if (progress === null) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }

  // Garde anti-régression (2026-09-10) : `observedProgress` est le CUMUL constaté, et en
  // financement progressif il sert de référence au prochain incrément libéré
  // (`previousProgress` dans le point d'étape). Sans cette garde, un client pouvait redescendre
  // à 30 % après avoir constaté 70 %, puis reconfirmer 70 % par point d'étape et déclencher un
  // incrément de 40 % déjà payé. Le plafond `remainingReleasableAmount` empêchait le
  // sur-paiement, mais les fonds partaient en avance sur l'avancement réel. On ne peut que monter.
  if (progress < scope.observedProgress) {
    return NextResponse.json({ error: "progress_regression" }, { status: 409 });
  }

  await observedProgressUpdate(scope, progress);
  return NextResponse.json({ observedProgress: progress });
}

// ── POST .../checkpoint ────────────────────────────────────────────────────────────────────
// Point d'étape confirmé par le client : contrairement à la validation finale, ceci ne clôt
// rien — le client trace qu'il a vérifié et accepté les preuves fournies à ce stade (progress
// peut être < 100). Enregistre la progression constatée ET un ProgressCheckpoint append-only.
// En financement progressif, confirmer un palier EST le libérer.
export async function handleCheckpoint(req: Request, args: ActionArgs): Promise<NextResponse> {
  const prepared = await prepare(args);
  if ("response" in prepared) return prepared.response;
  const { scope, userId } = prepared;

  // Pré-validation par preuve (2026-09-05) : un point d'étape ne se confirme qu'une fois TOUTES
  // les preuves du lot courant appréciées et validées.
  const proofCheck = await assertProofsValidated(proofScope(scope));
  if (proofCheck) {
    return NextResponse.json({ error: proofCheck.error }, { status: proofCheck.status });
  }

  const body = await req.json().catch(() => null);
  const progress = readProgress(body);
  if (progress === null) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }

  // Garde anti-régression : confirmer un niveau inférieur au cumul déjà constaté ferait
  // « reculer » la progression validée. La comparaison porte sur `observedProgress`, le cumul
  // RÉEL, et non — comme avant le 2026-09-11 — sur le plus haut ProgressCheckpoint : les deux
  // divergent dès que `observe-progress` fait monter le constat sans créer de point d'étape, et
  // le contrôle laissait alors passer une confirmation qui faisait redescendre le cumul.
  if (progress < scope.observedProgress) {
    return NextResponse.json({ error: "progress_regression" }, { status: 409 });
  }

  const [, checkpoint] = await prisma.$transaction([
    observedProgressUpdate(scope, progress),
    prisma.progressCheckpoint.create({
      data: { missionId: scope.missionId, jalonId: scope.jalonId, progress, validatedById: userId },
    }),
  ]);

  const releasedAmount = await emitProgressiveRelease(scope, progress);

  const note = readNote(body);
  const cible = scope.jalonTitre ? ` sur ${deliverableLabel(scope)}` : "";
  const montantLibere =
    releasedAmount > 0
      ? ` — ${Math.round(releasedAmount).toLocaleString("fr-FR")} ${scope.currency} libérés`
      : "";
  // À 100 % il ne reste rien à poursuivre : inviter le prestataire à « atteindre les 100% »
  // alors qu'il y est, ou annoncer au client que l'autre « poursuit », décrivait l'inverse de
  // l'état réel. Le reste de l'étape (validation, libération du solde) est alors au client.
  const complet = progress >= 100;
  await notifyMissionParties({
    missionId: scope.missionId,
    type: "progress_checkpoint",
    counterpart: {
      userId: scope.providerId,
      message:
        `Point d'étape confirmé à ${progress}%${cible}${montantLibere}` +
        (complet
          ? " — le client peut désormais valider et libérer le solde."
          : " — poursuivez pour atteindre les 100%.") +
        (note ? ` Constat du client : ${note}` : ""),
    },
    actor: {
      userId,
      message:
        `Vous avez confirmé un point d'étape à ${progress}%${cible}${
          releasedAmount > 0 ? `${montantLibere} au prestataire.` : ""
        }${
          releasedAmount > 0
            ? ""
            : complet
              ? " — vous pouvez maintenant valider pour libérer le solde."
              : " — le prestataire poursuit jusqu'aux 100%."
        }` + (note ? ` Votre constat : ${note}` : ""),
    },
  });

  return NextResponse.json({ observedProgress: progress, checkpoint, releasedAmount });
}

/**
 * Financement progressif (règle 18.4) : libère le montant proportionnel à l'incrément que ce
 * point d'étape valide. En mode "lump_sum" (défaut), ne fait rien — seule la validation finale
 * libère. Retourne le montant réellement instruit.
 */
async function emitProgressiveRelease(scope: DeliverableScope, progress: number): Promise<number> {
  if (scope.financingMode !== "progressive") return 0;

  // Retenue de garantie (règle 18.10) : les paliers se calculent sur le plafond LIBÉRABLE, pas
  // sur le montant plein — 100 % de progression doit amener le cumul versé exactement au
  // plafond, la part retenue partant plus tard en une instruction unique. Sans retenue,
  // `releasableBeforeRetention` rend le montant plein : calcul inchangé.
  const plafond = releasableBeforeRetention(scope.montant, scope.retentionRate);

  // L'émetteur relit le cumul déjà parti et écrit dans la même transaction verrouillée : le
  // plafond 18.3 tient sous appels concurrents, et la CIBLE rend le versement indépendant du
  // chemin par lequel la progression est arrivée là (voir emitScopedRelease).
  const operation = await emitScopedRelease({
    contractId: scope.contractId,
    jalonId: scope.jalonId,
    currency: scope.currency,
    plafond,
    targetCumulative: progressiveReleaseTarget(plafond, progress),
  });
  return operation?.amount ?? 0;
}

// ── POST .../reject ────────────────────────────────────────────────────────────────────────
const rejectSchema = z.object({ rejectionReason: z.string().min(1) });

// « Révision(N) » : le client rejette le livrable avec un motif obligatoire. Les fonds RESTENT
// au séquestre — aucune instruction PSP n'est transmise ici — et le prestataire resoumet.
//
// `declaredProgress` repart à 0 (nouveau cycle : la déclaration du tour précédent ne doit pas
// laisser croire que le nouveau livrable est déjà avancé), mais `observedProgress` N'EST PAS
// remis à 0 : c'est le cumul des points d'étape déjà VALIDÉS par le client, et un rejet ne
// défait jamais une validation précédente — il renvoie seulement CETTE soumission en révision.
export async function handleRejectDeliverable(req: Request, args: ActionArgs): Promise<NextResponse> {
  const prepared = await prepare(args);
  if ("response" in prepared) return prepared.response;
  const { scope, userId } = prepared;

  const parsed = rejectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "rejection_reason_required" }, { status: 400 });
  }
  const { rejectionReason } = parsed.data;

  // La seule vraie divergence entre les deux portées, et elle est imposée par le schéma : le
  // Jalon porte `rejectionReason`/`revisionCount` et repasse `rejete` ; la Mission n'a ni l'un
  // ni l'autre et redescend à `fonds_sous_sequestre`. Tout le reste est commun.
  const rejection = prisma.progressRejection.create({
    data: { missionId: scope.missionId, jalonId: scope.jalonId, reason: rejectionReason, rejectedById: userId },
  });
  let revisionCount: number | undefined;
  let status: string;
  if (scope.jalonId) {
    const [updated] = await prisma.$transaction([
      prisma.jalon.update({
        where: { id: scope.jalonId },
        data: { status: "rejete", rejectionReason, revisionCount: { increment: 1 }, declaredProgress: 0 },
      }),
      rejection,
    ]);
    status = updated.status;
    revisionCount = updated.revisionCount;
  } else {
    const [updated] = await prisma.$transaction([
      prisma.mission.update({
        where: { id: scope.missionId },
        data: { status: "fonds_sous_sequestre", declaredProgress: 0 },
      }),
      rejection,
    ]);
    status = updated.status;
  }

  const cible = deliverableLabel(scope);
  await notifyMissionParties({
    missionId: scope.missionId,
    type: "deliverable_rejected",
    counterpart: {
      userId: scope.providerId,
      message: `Livrable refusé pour ${cible} — mission « ${scope.missionTitre} ». Motif : ${rejectionReason}`,
      email: {
        subject: `Livrable rejeté — ${scope.jalonTitre ?? scope.missionTitre}`,
        text: `Le client a rejeté ${cible}. Motif : ${rejectionReason}. Vous pouvez resoumettre des preuves corrigées.`,
      },
    },
    actor: {
      userId,
      message: `Vous avez refusé ${cible} — mission « ${scope.missionTitre} ». Motif transmis au prestataire : ${rejectionReason}`,
      email: {
        subject: `Rejet enregistré — ${scope.jalonTitre ?? scope.missionTitre}`,
        text: `Votre rejet de ${cible} a été enregistré et transmis au prestataire. Motif : ${rejectionReason}`,
      },
    },
  });

  return NextResponse.json(revisionCount === undefined ? { status } : { status, revisionCount });
}

// ── POST .../validate (jalon) et POST .../escrow/release (mission) ─────────────────────────
// Le client valide le livrable : une instruction RELEASE est transmise au PSP pour le montant
// de la portée. Le statut n'avance qu'à la confirmation du webhook, jamais de façon optimiste.
export async function handleValidateDeliverable(args: ActionArgs): Promise<NextResponse> {
  // `requireDeliverable: false` : la garde de statut vient plus bas, APRÈS la réponse
  // idempotente — sinon un geste déjà abouti se verrait répondre « aucun livrable soumis »,
  // ce qui est faux et déroutant.
  const prepared = await prepare(args, { requireDeliverable: false });
  if ("response" in prepared) return prepared.response;
  const { scope, userId } = prepared;

  // État « déjà soldé » de la portée : le jalon est `libere`, la mission `cloturee`.
  const settledStatus = scope.jalonId ? "libere" : "cloturee";

  // Financement progressif (règle 18.4) : un point d'étape à 100 % peut avoir déjà tout libéré
  // et soldé la portée sans attendre ce clic, que l'UI déclenche quand même. Réponse
  // idempotente plutôt qu'une erreur.
  if (scope.status === settledStatus) {
    return NextResponse.json({ id: null, status: settledStatus, alreadyFullyReleased: true });
  }

  // Portée MISSION seulement : vérifier que les fonds ont bien été séquestrés. Sur un jalon,
  // c'est acquis par construction — `livrable_soumis` n'est atteignable que depuis
  // `fonds_sous_sequestre`, statut posé par le webhook de confirmation du HOLD.
  if (!scope.jalonId) {
    const holds = await prisma.pspEscrowOperation.count({
      where: { contractId: scope.contractId, instructionType: "hold", status: "confirmed" },
    });
    if (holds === 0) {
      return NextResponse.json({ error: "funds_not_held" }, { status: 409 });
    }
  }

  if (!canDecideDeliverable(scope.status)) {
    return NextResponse.json({ error: "no_deliverable_submitted" }, { status: 409 });
  }
  // La libération n'est possible que si le client a lui-même constaté 100 % — jamais sur la
  // base de declaredProgress, purement déclaratif côté prestataire.
  if (scope.observedProgress < 100) {
    return NextResponse.json({ error: "progress_incomplete" }, { status: 409 });
  }
  const proofCheck = await assertProofsValidated(proofScope(scope));
  if (proofCheck) {
    return NextResponse.json({ error: proofCheck.error }, { status: proofCheck.status });
  }

  // Retenue de garantie (règle 18.10) : le plafond libérable est le montant moins la part
  // retenue, versée plus tard en une instruction unique. Sans retenue, c'est le montant plein.
  const plafond = releasableBeforeRetention(scope.montant, scope.retentionRate);
  const retenue = retentionAmount(scope.montant, scope.retentionRate);

  // UN seul agrégat pour les deux questions : ce qui est déjà parti (pour ne pas réémettre) et
  // ce qui est confirmé (pour ne pas clôturer sur du non-confirmé).
  const { inFlight, confirmed } = await releasedAmounts(escrowScope(scope));
  const releaseAmount = remainingReleasableAmount(plafond, inFlight);

  if (releaseAmount <= 0) {
    // Rien à transmettre — mais les instructions déjà parties sont-elles CONFIRMÉES ? Un solde
    // nul peut signifier « tout est en vol » et non « tout est arrivé » : `inFlight` compte les
    // `pending`, volontairement (règle 18.3, pour ne pas réémettre). Clôturer là-dessus serait
    // une clôture optimiste — et depuis la retenue de garantie, la clôture d'un dernier jalon
    // ÉMET une instruction de versement. La validation est reçue, la clôture attend le webhook.
    if (confirmed < plafond - MONTANT_EPSILON) {
      return NextResponse.json({
        id: null,
        status: scope.status,
        alreadyFullyReleased: false,
        releasePending: true,
      });
    }
    if (scope.jalonId) {
      await closeJalonFullyReleased(scope.jalonId, scope.contractId, scope.missionId);
    } else {
      await prisma.mission.update({ where: { id: scope.missionId }, data: { status: "cloturee" } });
    }
    await notifyValidated(scope, userId, { alreadyReleased: true, releaseAmount: 0, retenue });
    return NextResponse.json({ id: null, status: settledStatus, alreadyFullyReleased: true });
  }

  // Émission verrouillée (règle 18.3) : le solde est relu et l'instruction écrite dans la même
  // transaction, donc deux validations concurrentes ne peuvent pas transmettre deux fois.
  const operation = await emitScopedRelease({
    contractId: scope.contractId,
    jalonId: scope.jalonId,
    currency: scope.currency,
    plafond,
    // Clôture : la cible est le plafond entier — on transmet tout ce qui n'est pas déjà parti.
    targetCumulative: plafond,
  });
  // Course perdue : un autre appel a libéré le solde entre le calcul ci-dessus et le verrou.
  // Rien n'a été transmis — réponse identique à celle du cas « déjà parti, pas encore confirmé ».
  if (!operation) {
    return NextResponse.json({
      id: null,
      status: scope.status,
      alreadyFullyReleased: false,
      releasePending: true,
    });
  }

  // Portée jalon : `valide` marque l'attente de la confirmation PSP. Portée mission : aucun
  // statut intermédiaire, le webhook passe directement à `cloturee`.
  //
  // `updateMany` GARDÉ sur `livrable_soumis`, et non `update` inconditionnel : `emitScopedRelease`
  // ci-dessus peut avoir été confirmé DANS LE MÊME APPEL (PSP virtuelle en autoconfirm, le
  // défaut de .env en développement) — le webhook a alors déjà fait passer ce jalon à `libere`,
  // et potentiellement clôturé la mission. Écrire `valide` par-dessus rendait le jalon
  // définitivement inerte : `canDecideDeliverable` n'accepte que `livrable_soumis`, donc plus
  // aucun geste d'interface ne pouvait le reprendre, et la mission n'atteignait jamais
  // `cloturee`. Le garde vaut aussi en production, où un webhook très rapide crée la même course.
  if (scope.jalonId) {
    await prisma.jalon.updateMany({
      where: { id: scope.jalonId, status: "livrable_soumis" },
      data: { status: "valide" },
    });
  }

  // `emitScopedRelease` a pu confirmer dans la foulée (PSP virtuelle en autoconfirm) : relire
  // le statut réel plutôt que celui de l'objet créé.
  const refreshed = await prisma.pspEscrowOperation.findUnique({
    where: { id: operation.id },
    select: { status: true },
  });

  await notifyValidated(scope, userId, { alreadyReleased: false, releaseAmount: operation.amount, retenue });
  return NextResponse.json({ id: operation.id, status: refreshed?.status ?? operation.status });
}

/** Notification « livrable validé », commune aux deux portées et aux deux issues. */
async function notifyValidated(
  scope: DeliverableScope,
  userId: string,
  { alreadyReleased, releaseAmount, retenue }: { alreadyReleased: boolean; releaseAmount: number; retenue: number }
) {
  const cible = deliverableLabel(scope);
  const sujet = `Livrable validé — ${scope.jalonTitre ?? scope.missionTitre}`;
  const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} ${scope.currency}`;
  // Le prestataire reçoit moins que le montant de la portée : le dire, sinon l'écart ressemble
  // à une erreur de la plateforme. Chaîne vide sans retenue — message inchangé.
  const mentionRetenue =
    retenue > 0
      ? ` ${money(retenue)} restent en retenue de garantie, libérés à la validation du dernier jalon.`
      : "";
  const issue = alreadyReleased
    ? "déjà intégralement libéré via les points d'étape progressifs"
    : `libération de ${money(releaseAmount)} en cours`;

  await notifyMissionParties({
    missionId: scope.missionId,
    type: "deliverable_validated",
    counterpart: {
      userId: scope.providerId,
      message: `Validation de ${cible} — ${issue}.${mentionRetenue}`,
      email: { subject: sujet, text: `Le client a validé ${cible} — ${issue}.${mentionRetenue}` },
    },
    actor: {
      userId,
      message: `Vous avez validé ${cible} — ${issue}.${mentionRetenue}`,
      email: { subject: sujet, text: `Votre validation de ${cible} a été enregistrée — ${issue}.${mentionRetenue}` },
    },
  });
}
