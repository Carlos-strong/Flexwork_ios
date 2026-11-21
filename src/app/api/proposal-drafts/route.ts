import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOpenForApplications } from "@/lib/mission-expiry";
import { proposalDraftEndpoint, type ProposalDraftKind } from "@/lib/proposal-drafts";

// GET /api/proposal-drafts — candidatures du prestataire connecté retenues faute de KYC vérifié
// (src/lib/proposal-drafts.ts) : en attente d'envoi automatique, ou dont l'envoi automatique a
// échoué (`lastError`). Avec la route et le corps à rejouer pour un nouvel essai, et l'état de
// la vérification d'identité. `?missionId=` restreint à une mission.
export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const missionId = new URL(req.url).searchParams.get("missionId");

  const [user, drafts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }),
    prisma.proposalDraft.findMany({
      where: { providerId: userId, ...(missionId ? { missionId } : {}) },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        kind: true,
        payload: true,
        lastError: true,
        updatedAt: true,
        mission: { select: { id: true, titre: true, status: true, budget: true, currency: true, budgetType: true, dateExpiration: true } },
      },
    }),
  ]);

  const now = new Date();
  return NextResponse.json({
    kycStatus: user?.kycStatus ?? null,
    kycVerified: user?.kycStatus === "verifie",
    items: drafts.map((d) => ({
      id: d.id,
      kind: d.kind,
      payload: d.payload,
      lastError: d.lastError,
      updatedAt: d.updatedAt,
      endpoint: proposalDraftEndpoint(d.kind as ProposalDraftKind, d.mission.id),
      mission: { id: d.mission.id, titre: d.mission.titre, budget: d.mission.budget, currency: d.mission.currency, budgetType: d.mission.budgetType },
      // Une mission fermée entre-temps : le brouillon ne peut plus partir, on le dit.
      missionOpen: isOpenForApplications(d.mission, now),
    })),
  });
}
