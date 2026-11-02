import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordVerificationHistory } from "@/lib/verification-history";
import { notifyUser } from "@/lib/notify";
import { mobileMoneyOperatorLabel } from "@/lib/mobile-money";
import { releaseAwaitingPayouts } from "@/lib/escrow";

// Instruction du compte de versement Mobile Money (2026-09-23).
//
// Seul écrivain de `PayoutAccount.status` après la soumission : sans ce geste, un dossier
// restait « en attente » pour toujours et le prestataire n'aurait jamais pu être payé — la
// plateforme savait exécuter une mission de bout en bout sans savoir où verser l'argent.
//
// Rôle `kyc` exigé (et non un admin quelconque) : c'est le pouvoir qui contrôle déjà les
// pièces d'identité, et un compte de versement se contrôle sur pièces.

const decisionSchema = z.object({
  decision: z.enum(["verifie", "rejete"]),
  refusalReason: z.string().min(3).max(500).optional(),
  justification: z.string().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.decision === "rejete" && !parsed.data.refusalReason) {
    return NextResponse.json(
      { error: "refusal_reason_required", message: "Un rejet doit porter un motif lisible par le prestataire." },
      { status: 400 },
    );
  }

  const account = await prisma.payoutAccount.findUnique({ where: { userId } });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (account.status !== "en_attente") {
    return NextResponse.json(
      { error: "no_pending_request", message: "Ce dossier n'est pas en attente d'instruction." },
      { status: 409 },
    );
  }

  const verified = parsed.data.decision === "verifie";
  const updated = await prisma.payoutAccount.update({
    where: { userId },
    data: {
      status: parsed.data.decision,
      reviewedById: guard.user.id,
      reviewedAt: new Date(),
      refusalReason: verified ? null : (parsed.data.refusalReason ?? null),
    },
    select: { id: true, status: true, operator: true, number: true, reviewedAt: true },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "payout_decision",
    targetType: "PayoutAccount",
    targetId: account.id,
    justification:
      parsed.data.justification?.trim() ||
      (verified
        ? `Compte ${mobileMoneyOperatorLabel(account.operator)} ${account.number} — titulaire ${account.holder} conforme.`
        : `Compte de versement rejeté : ${parsed.data.refusalReason}`),
  });

  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: `payout:${parsed.data.decision}`,
  });

  // Compte vérifié : les créances restées dues faute de compte contrôlé partent maintenant
  // (src/lib/kyc-policy.ts). Non bloquant — la décision est enregistrée, et une créance non
  // transmise ici reste due et réinstructible depuis la console finance.
  if (verified) {
    await releaseAwaitingPayouts(userId).catch((e) => {
      console.error("[payout-decision] transmission des créances en attente échouée (non bloquant) :", e);
    });
  }

  // Non bloquant, même règle que partout ailleurs : une décision enregistrée ne doit jamais
  // devenir un 500 parce que le SMTP a hoqueté.
  void notifyUser({
    userId,
    type: verified ? "payout_verifie" : "payout_rejete",
    message: verified
      ? `Votre compte de versement ${mobileMoneyOperatorLabel(account.operator)} est vérifié : vous pouvez être payé.`
      : `Votre compte de versement a été rejeté. Motif : ${parsed.data.refusalReason}`,
    email: {
      subject: verified ? "Votre compte de versement est vérifié" : "Votre compte de versement n'a pas été validé",
      text: verified
        ? `Votre compte de versement ${mobileMoneyOperatorLabel(account.operator)} (${account.number}) a été vérifié. Les versements pourront y être adressés.`
        : `Votre compte de versement a été rejeté. Motif : ${parsed.data.refusalReason}. Vous pouvez corriger vos informations puis resoumettre le dossier.`,
    },
  }).catch(() => {});

  return NextResponse.json(updated);
}
