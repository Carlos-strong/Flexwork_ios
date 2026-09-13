import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CONSTAT_CATEGORIES } from "@/lib/constat";

// Appréciation des preuves par le CLIENT, preuve par preuve (2026-09-05, maquette
// "Appréciation des preuves"). Partage entre la route qui enregistre une appréciation et les
// routes qui VALIDENT/rejettent le lot : le lot courant (preuves "ouvertes") doit être
// entièrement validé avant qu'un geste global de validation (point d'étape / libération)
// puisse aboutir — garde côté serveur, jamais seulement côté UI.

export type ProofScope = { missionId: string; jalonId: string | null };

// Une preuve "ouverte" = soumise après la DERNIÈRE décision de LOT (point d'étape confirmé ou
// rejet global — append-only). Un rejet PAR PREUVE ne clôt PAS le lot : tant qu'une preuve est
// rejetée ou en attente, le lot reste ouvert (le prestataire doit resoumettre / le client doit
// apprécier) — c'est exactement ce que `proofValidationState` doit refléter.
export async function openProofs(scope: ProofScope) {
  const boundary = await latestLotDecisionAt(scope);
  return prisma.missionAttachment.findMany({
    where: {
      missionId: scope.missionId,
      jalonId: scope.jalonId,
      // Preuves de CONSTAT du client (catégories `constat_*`) exclues : elles n'appartiennent
      // pas au lot du prestataire et ne sont jamais appréciées — les compter ici bloquerait
      // toute validation globale (elles resteraient éternellement « en attente ».)
      NOT: { category: { in: [...CONSTAT_CATEGORIES] } },
      ...(boundary ? { createdAt: { gt: boundary } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

async function latestLotDecisionAt({ missionId, jalonId }: ProofScope): Promise<Date | null> {
  const [checkpoint, rejection] = await Promise.all([
    prisma.progressCheckpoint.findFirst({
      where: { missionId, jalonId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.progressRejection.findFirst({
      where: { missionId, jalonId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const times = [checkpoint?.createdAt, rejection?.createdAt].filter((d): d is Date => Boolean(d));
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}

export type ProofValidationState = {
  /** true si TOUTES les preuves ouvertes sont validées (ou aucune ouverte) — la condition à
   *  respecter avant tout geste global de validation. */
  ready: boolean;
  open: number;
  pending: number;
  rejected: number;
};

export async function proofValidationState(scope: ProofScope): Promise<ProofValidationState> {
  const proofs = await openProofs(scope);
  const pending = proofs.filter((p) => !p.appreciation).length;
  const rejected = proofs.filter((p) => p.appreciation === "rejetee").length;
  return { ready: pending === 0 && rejected === 0, open: proofs.length, pending, rejected };
}

/** Renvoie null si le lot peut être validé, sinon l'erreur à servir (409). */
export async function assertProofsValidated(
  scope: ProofScope
): Promise<{ error: string; status: 409; state: ProofValidationState } | null> {
  const state = await proofValidationState(scope);
  if (state.open === 0) return null; // aucune preuve ouverte : rien à pré-valider
  if (!state.ready) {
    return { error: state.rejected > 0 ? "proof_rejected" : "proofs_not_validated", status: 409, state };
  }
  return null;
}

// ── Rejet AUTOMATIQUE de la soumission sur rejet d'une preuve (spec §10/14) ─────────────
// La spec "financement par jalons à validation progressive" veut que le statut bascule
// SUBMITTED → REJECTED dès qu'une preuve est rejetée — sans attendre le « Rejeter » de lot
// explicite (escrow/reject ou jalons/[jalonId]/reject). Ces opérations reproduisent À
// L'IDENTIQUE les effets de ce rejet de lot (jalon ou mission entière) : bascule de statut,
// `declaredProgress` repart à 0 (nouveau cycle de resoumission) mais `observedProgress` reste
// acquis (un rejet ne défait jamais une validation antérieure, voir POST .../reject), et un
// ProgressRejection append-only est créé pour que le lot rejeté apparaisse comme sa propre
// version ("…-rej") dans le dropdown Historique. À inclure dans le MÊME $transaction que
// l'update d'appréciation de la preuve (atomicité : preuve rejetée ⇔ soumission rejetée).
export type AutoRejectScope = { missionId: string; jalonId: string | null };

export function autoRejectSubmissionOperations(
  scope: AutoRejectScope,
  opts: { reason: string; rejectedById: string }
): Prisma.PrismaPromise<any>[] {
  const { missionId, jalonId } = scope;
  if (jalonId) {
    return [
      prisma.jalon.update({
        where: { id: jalonId },
        data: {
          status: "rejete",
          rejectionReason: opts.reason,
          revisionCount: { increment: 1 },
          declaredProgress: 0,
        },
      }),
      prisma.progressRejection.create({
        data: { missionId, jalonId, reason: opts.reason, rejectedById: opts.rejectedById },
      }),
    ];
  }
  return [
    prisma.mission.update({
      where: { id: missionId },
      data: { status: "fonds_sous_sequestre", declaredProgress: 0 },
    }),
    prisma.progressRejection.create({
      data: { missionId, reason: opts.reason, rejectedById: opts.rejectedById },
    }),
  ];
}
