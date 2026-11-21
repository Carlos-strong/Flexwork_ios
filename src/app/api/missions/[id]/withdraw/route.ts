import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { withdrawEngagement } from "@/lib/engagement-withdrawal";

const schema = z.object({ reason: z.string().min(3).max(500) });

const MESSAGES: Record<string, string> = {
  not_engagement: "Seul l'engagement d'un prestataire retenu peut être annulé.",
  not_withdrawable: "Le contrat est déjà signé par les deux parties : l'engagement ne peut plus être annulé ici.",
  reason_required: "Indiquez le motif du désistement.",
  no_favorites: "Aucun favori disponible pour remplacer ce prestataire : shortlistez d'abord un candidat.",
};

// Désistement / retrait d'un prestataire retenu sur un ENGAGEMENT (2026-11-11) — le prestataire
// retenu ou le client propriétaire, avant la signature complète du contrat. Voir
// src/lib/engagement-withdrawal.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "reason_required", message: MESSAGES.reason_required }, { status: 400 });
  }
  const result = await withdrawEngagement({ engagementId: id, userId, reason: parsed.data.reason });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "reason_required" ? 400 : 409;
    return NextResponse.json({ error: result.error, message: MESSAGES[result.error] }, { status });
  }
  return NextResponse.json({ ok: true, actor: result.actor });
}
