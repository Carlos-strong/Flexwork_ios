import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordVerificationHistory } from "@/lib/verification-history";
import { notifyUser } from "@/lib/notify";

// Instruction du badge « Vérifié » (2026-09-23) — le geste qui manquait.
//
// `badgeDecidedAt`, `accorde` et `refuse` n'étaient écrits par AUCUN code : la demande
// restait ouverte indéfiniment, et le prestataire n'avait aucun moyen de savoir où elle en
// était. Cette route est le seul écrivain de ces états, et elle exige le rôle `kyc` : un
// badge se décerne sur un dossier, pas sur une intuition.
//
// Elle n'accorde aucun POUVOIR : le badge n'ouvre ni mission ni paiement. Il dit qu'une
// déclaration de diplôme d'État a été regardée par quelqu'un — d'où l'obligation de rôle et
// l'audit obligatoire.

const decisionSchema = z.object({
  decision: z.enum(["accorde", "refuse"]),
  // Motif du refus, tel qu'il sera affiché au prestataire. Obligatoire pour un refus :
  // « refusé » sans raison est un couperet, pas une instruction.
  refusalReason: z.string().min(3).max(500).optional(),
  // Justification d'audit. Facultative pour un accord (le diplôme d'État vaut motif).
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
  if (parsed.data.decision === "refuse" && !parsed.data.refusalReason) {
    return NextResponse.json(
      { error: "refusal_reason_required", message: "Un refus doit porter un motif lisible par le prestataire." },
      { status: 400 },
    );
  }

  // Le badge est porté par le PROFIL principal : c'est lui qui porte le métier et le
  // diplôme. On refuse d'instruire une demande qui n'existe pas plutôt que d'écrire un
  // « accordé » sur un profil qui n'a rien demandé.
  const profile = await prisma.profile.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (profile.badgeStatus !== "en_attente") {
    return NextResponse.json(
      { error: "no_pending_request", message: "Aucune demande de badge en attente pour ce profil." },
      { status: 409 },
    );
  }

  const granted = parsed.data.decision === "accorde";
  const updated = await prisma.profile.update({
    where: { id: profile.id },
    data: {
      badgeStatus: parsed.data.decision,
      badgeDecidedAt: new Date(),
      badgeRefusalReason: granted ? null : (parsed.data.refusalReason ?? null),
    },
    select: { badgeStatus: true, badgeRequestedAt: true, badgeDecidedAt: true, badgeRefusalReason: true },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "badge_decision",
    targetType: "Profile",
    targetId: profile.id,
    justification:
      parsed.data.justification?.trim() ||
      (granted
        ? "Diplôme d'État déclaré — badge accordé."
        : `Badge refusé : ${parsed.data.refusalReason}`),
  });

  await recordVerificationHistory({
    subjectType: "declaration",
    subjectId: profile.id,
    event: `badge:${parsed.data.decision}`,
  });

  // Non bloquant : un échec d'e-mail ne doit jamais transformer une décision déjà
  // enregistrée en 500.
  void notifyUser({
    userId,
    type: granted ? "badge_accorde" : "badge_refuse",
    message: granted
      ? "Votre badge « Vérifié » a été accordé. Il apparaît désormais sur votre profil public."
      : `Votre demande de badge a été refusée. Motif : ${parsed.data.refusalReason}`,
    email: {
      subject: granted ? "Votre badge « Vérifié » est accordé" : "Votre demande de badge n'a pas été validée",
      text: granted
        ? "Votre badge « Vérifié » a été accordé après instruction de votre diplôme d'État. Il renforce la visibilité de votre profil."
        : `Votre demande de badge a été refusée. Motif : ${parsed.data.refusalReason}. Vous pouvez corriger votre déclaration puis renouveler la demande.`,
      html: granted
        ? "<p>Votre badge « <strong>Vérifié</strong> » a été accordé après instruction de votre diplôme d'État.</p>"
        : `<p>Votre demande de badge a été <strong>refusée</strong>.</p><p>Motif : ${parsed.data.refusalReason}</p>`,
    },
  }).catch(() => {});

  return NextResponse.json({ profileId: profile.id, ...updated });
}
