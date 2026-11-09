import { NextResponse } from "next/server";
import { notifyPendingPublications } from "@/lib/mission-publish";
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
  // Un motif n'est exigé QUE pour un rejet (voir plus bas) — valider un dossier conforme
  // n'a pas besoin d'être justifié. `justification` reste accepté pour compat (l'admin
  // dashboard générique, src/app/admin/page.tsx, peut encore en envoyer une), mais n'est
  // plus jamais requis ici : voir logAdminAction plus bas pour la valeur de repli utilisée
  // quand aucune n'est fournie.
  justification: z.string().optional(),
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

  // A13 — la date de naissance (lue sur la pièce d'identité) est OBLIGATOIRE pour valider un
  // KYC, QUELLE QUE SOIT LA FILIÈRE (2026-09-24).
  //
  // L'exigence était réservée aux filières chantier. La barrière d'âge portant désormais sur la
  // CATÉGORIE du métier choisi, n'importe quel compte peut la rencontrer : l'activation de
  // l'espace prestataire est ouverte à tous, y compris à un client qui le demandera dans trois
  // mois. Une identité vérifiée sans âge est donc un dossier incomplet, et ici seulement la
  // pièce est sous les yeux de l'équipe — c'est le seul moment où cette donnée peut être
  // relevée. Laisser passer ce moment, c'était fabriquer des comptes « verifie » incapables de
  // choisir un métier, sans aucun endroit où réparer (le dossier sortait de la file d'attente).
  if (parsed.data.status === "verifie" && parsed.data.dateNaissance === undefined) {
    return NextResponse.json(
      {
        error: "date_naissance_required",
        message:
          "La date de naissance (lue sur la pièce d'identité) est obligatoire pour valider le KYC : elle est la seule donnée d'âge faisant foi, et aucune autre route ne peut l'écrire.",
      },
      { status: 400 },
    );
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

  // Statut AVANT la décision : les missions en attente de publication ne sont signalées qu'au
  // PASSAGE à « verifie », pas à chaque décision sur un compte déjà vérifié.
  const wasVerified =
    (await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }))?.kycStatus === "verifie";
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

  // Identité vérifiée à l'instant : les missions dont le client avait demandé la publication
  // avant la vérification sont prêtes — il en est prévenu (src/lib/mission-publish.ts).
  if (!wasVerified && user.kycStatus === "verifie") {
    await notifyPendingPublications(userId);
  }

  // logAdminAction (US-801) exige une justification non vide pour TOUTE action admin —
  // invariant qu'on ne relâche pas ici : une validation sans motif garde quand même une
  // trace d'audit, juste générée automatiquement plutôt que saisie par l'admin. Pour un
  // rejet, le motif de rejet (obligatoire, voir plus haut) sert aussi de justification —
  // pas besoin de le saisir deux fois.
  await logAdminAction({
    adminId: guard.user.id,
    action: "kyc_decision",
    targetType: "User",
    targetId: userId,
    justification: parsed.data.justification?.trim() || parsed.data.rejectionReason || "Documents conformes — validation sans motif complémentaire.",
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

  // Accusé à l'admin qui vient de décider — les deux parties d'un événement sont notifiées,
  // ici l'« expéditeur » de la décision (2026-09-09). Non bloquant.
  void notifyUser({
    userId: guard.user.id,
    type: "kyc_decision_admin",
    message: `Décision KYC enregistrée pour ${user.email} : ${parsed.data.status === "verifie" ? "dossier validé" : `dossier rejeté (${parsed.data.rejectionReason})`}.`,
  }).catch(() => {});

  return NextResponse.json({
    kycStatus: user.kycStatus,
    selfieMatch: { similarity: match.similarity, passed: match.passed },
  });
}
