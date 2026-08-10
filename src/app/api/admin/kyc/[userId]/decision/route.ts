import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { runSelfieMatch } from "@/lib/selfieMatch";
import { logAdminAction, isUnderKycRateLimit } from "@/lib/admin-audit";
import { recordVerificationHistory } from "@/lib/verification-history";
import { notifyUser } from "@/lib/notify";

const schema = z.object({
  status: z.enum(["verifie", "rejete"]),
  rejectionReason: z.string().optional(),
  justification: z.string().min(1),
  // A13 — date de naissance extraite de la pièce d'identité, saisie par l'Admin KYC au
  // moment de la décision. Jamais déclarée par l'utilisateur (etat-consolide-Flexwork.md
  // §2, A13) : c'est la seule donnée d'âge faisant foi pour les filières chantier.
  dateNaissance: z.coerce.date().optional(),
});

// US-202 (Phase 2) : l'Admin KYC valide ou rejette un dossier, justification obligatoire,
// garde-fou 30 validations/heure. C'est la SEULE vérification effective de la plateforme
// (modele-skillafrica-v3-Flexwork.md §9) — aucune autre route admin ne "vérifie" quoi que
// ce soit d'autre (qualifications, assurance : voir Phase 3, purement déclaratif).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (!(await isUnderKycRateLimit(guard.user.id))) {
    return NextResponse.json({ error: "kyc_rate_limit_exceeded" }, { status: 429 });
  }

  if (parsed.data.status === "rejete" && !parsed.data.rejectionReason) {
    return NextResponse.json({ error: "rejection_reason_required" }, { status: 400 });
  }

  const match = await runSelfieMatch(userId, "kyc_review");

  await prisma.kycDocument.updateMany({
    where: { userId, status: "en_attente" },
    data: {
      status: parsed.data.status,
      reviewedById: guard.user.id,
      reviewedAt: new Date(),
      rejectionReason: parsed.data.status === "rejete" ? parsed.data.rejectionReason : null,
    },
  });

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: parsed.data.status,
      ...(parsed.data.dateNaissance
        ? {
            dateNaissance: parsed.data.dateNaissance,
            dateNaissanceSetById: guard.user.id,
            dateNaissanceSetAt: new Date(),
          }
        : {}),
    },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "kyc_decision",
    targetType: "User",
    targetId: userId,
    justification: parsed.data.justification,
  });
  await recordVerificationHistory({ subjectType: "kyc", subjectId: userId, event: `decision:${parsed.data.status}` });

  // Notifie l'utilisateur sur les deux canaux (in-app + e-mail) — jusqu'ici la décision
  // n'était visible qu'en rechargeant /kyc, sans aucun signal actif côté utilisateur.
  if (parsed.data.status === "verifie") {
    await notifyUser({
      userId,
      type: "kyc_verifie",
      message: "Votre identité a été vérifiée. Vous pouvez désormais publier une mission ou candidater selon votre profil.",
      email: {
        subject: "Votre identité a été vérifiée sur Flexwork",
        text: "Bonne nouvelle : votre dossier KYC a été validé par notre équipe. Vous pouvez désormais publier une mission (client) ou candidater à une mission (prestataire).",
        html: "<p>Bonne nouvelle : votre dossier KYC a été <strong>validé</strong> par notre équipe.</p><p>Vous pouvez désormais publier une mission (client) ou candidater à une mission (prestataire).</p>",
      },
    });
  } else {
    await notifyUser({
      userId,
      type: "kyc_rejete",
      message: `Votre dossier KYC a été rejeté. Motif : ${parsed.data.rejectionReason}`,
      email: {
        subject: "Votre dossier KYC n'a pas été validé",
        text: `Votre dossier KYC a été rejeté. Motif : ${parsed.data.rejectionReason}. Vous pouvez soumettre de nouveaux documents depuis votre espace de vérification.`,
        html: `<p>Votre dossier KYC a été <strong>rejeté</strong>.</p><p>Motif : ${parsed.data.rejectionReason}</p><p>Vous pouvez soumettre de nouveaux documents depuis votre espace de vérification.</p>`,
      },
    });
  }

  return NextResponse.json({
    kycStatus: user.kycStatus,
    selfieMatch: { similarity: match.similarity, passed: match.passed },
  });
}
