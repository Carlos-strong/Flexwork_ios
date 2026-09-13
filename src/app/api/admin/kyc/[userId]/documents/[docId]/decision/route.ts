import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction, isUnderKycRateLimit } from "@/lib/admin-audit";
import { recordVerificationHistory } from "@/lib/verification-history";
import { notifyUser } from "@/lib/notify";
import { deriveKycStatus } from "@/lib/kyc-status";
import { isChantierRole } from "@/lib/age-gate";

const schema = z.object({
  status: z.enum(["verifie", "rejete"]),
  rejectionReason: z.string().optional(),
  // Motif exigé UNIQUEMENT pour un rejet (voir plus bas) — valider un document conforme
  // n'a pas besoin d'être justifié.
  justification: z.string().optional(),
  // A13 — date de naissance lue sur la pièce d'identité, saisie au moment de la décision.
  dateNaissance: z.coerce.date().optional(),
});

// Décision par document KYC (extension du tableau de validation) : l'admin visualise tous
// les documents d'un compte et valide/rejette CHAQUE document individuellement. Après chaque
// décision, l'état global du compte (user.kycStatus) est resynchronisé depuis l'état réel
// des documents via deriveKycStatus — même règle que le script scripts/sync-kyc-status.ts.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string; docId: string }> }
) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId, docId } = await params;
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

  const doc = await prisma.kycDocument.findFirst({ where: { id: docId, userId } });
  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.kycDocument.update({
    where: { id: docId },
    data: {
      status: parsed.data.status,
      reviewedById: guard.user.id,
      reviewedAt: new Date(),
      rejectionReason: parsed.data.status === "rejete" ? parsed.data.rejectionReason : null,
    },
  });

  // Synchronisation de l'état global du compte depuis l'état réel de ses documents.
  const allDocs = await prisma.kycDocument.findMany({ where: { userId } });
  const derivedRaw = deriveKycStatus(allDocs);
  // A13 — une filière chantier ne peut PAS devenir « verifie » sans date de naissance (jamais
  // déclarée par l'utilisateur, saisie admin sur la pièce) : la validation PAR DOCUMENT ne
  // doit pas court-circuiter cette exigence via deriveKycStatus. Le document est validé, mais
  // le compte reste « en_attente » tant que la validation finale du dossier
  // (POST .../decision) n'apporte pas la date — sinon le compte serait « verifie » et pourtant
  // bloqué en candidature chantier (kyc_required_for_age, message trompeur). (2026-09-09)
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const derived =
    derivedRaw === "verifie" && target && isChantierRole(target.role) && !parsed.data.dateNaissance
      ? "en_attente"
      : derivedRaw;
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      kycStatus: derived,
      ...(parsed.data.dateNaissance && parsed.data.status === "verifie"
        ? {
            dateNaissance: parsed.data.dateNaissance,
            dateNaissanceSetById: guard.user.id,
            dateNaissanceSetAt: new Date(),
          }
        : {}),
    },
  });

  // logAdminAction (US-801) exige une justification non vide pour TOUTE action admin — une
  // validation sans motif saisi garde quand même une trace d'audit, générée automatiquement
  // plutôt que tapée par l'admin. Pour un rejet, le motif de rejet (obligatoire, voir plus
  // haut) sert aussi de justification.
  await logAdminAction({
    adminId: guard.user.id,
    action: "kyc_decision",
    targetType: "KycDocument",
    targetId: docId,
    justification: parsed.data.justification?.trim() || parsed.data.rejectionReason || "Document conforme — validation sans motif complémentaire.",
  });
  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: `document:${doc.type}:${parsed.data.status}`,
  });

  // Notifie uniquement quand l'état global du compte devient définitif (dossier complet).
  // Envoi NON bloquant : un échec d'e-mail ne doit jamais transformer une décision déjà
  // enregistrée en 500 (la notification in-app est créée, l'e-mail est best-effort).
  if (derived === "verifie") {
    void notifyUser({
      userId,
      type: "kyc_verifie",
      message: "Votre identité a été vérifiée. Vous pouvez désormais publier une mission ou candidater selon votre profil.",
      email: {
        subject: "Votre identité a été vérifiée sur Flexwork",
        text: "Bonne nouvelle : votre dossier KYC a été validé par notre équipe. Vous pouvez désormais publier une mission (client) ou candidater à une mission (prestataire).",
        html: "<p>Bonne nouvelle : votre dossier KYC a été <strong>validé</strong> par notre équipe.</p><p>Vous pouvez désormais publier une mission (client) ou candidater à une mission (prestataire).</p>",
      },
    }).catch(() => {});
  } else if (derived === "rejete") {
    const reason = parsed.data.rejectionReason ?? updated.rejectionReason ?? "documents non conformes";
    void notifyUser({
      userId,
      type: "kyc_rejete",
      message: `Votre dossier KYC a été rejeté. Motif : ${reason}`,
      email: {
        subject: "Votre dossier KYC n'a pas été validé",
        text: `Votre dossier KYC a été rejeté. Motif : ${reason}. Vous pouvez soumettre de nouveaux documents depuis votre espace de vérification.`,
        html: `<p>Votre dossier KYC a été <strong>rejeté</strong>.</p><p>Motif : ${reason}</p><p>Vous pouvez soumettre de nouveaux documents depuis votre espace de vérification.</p>`,
      },
    }).catch(() => {});
  }

  // Accusé à l'admin qui vient de décider (non bloquant).
  void notifyUser({
    userId: guard.user.id,
    type: "kyc_decision_admin",
    message: `Document ${updated.type} de ${user.email} marqué « ${updated.status} ». Statut KYC du compte : ${user.kycStatus}.`,
  }).catch(() => {});

  return NextResponse.json({ document: updated, kycStatus: user.kycStatus });
}
