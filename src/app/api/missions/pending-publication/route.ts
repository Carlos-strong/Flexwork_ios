import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { clientPublicationRight } from "@/lib/kyc-policy";

// Brouillons de missions du client, avec l'état de son KYC (2026-10-06) : c'est le SEUL
// endroit où ils apparaissent — la gestion des missions (GET /api/missions, résumé du
// tableau de bord) ne montre que des missions publiées. Ceux dont la publication a été
// demandée avant la vérification d'identité (`publicationRequestedAt`) viennent en premier.
// `canPublish` dit si la mise en ligne est possible MAINTENANT (src/lib/kyc-policy.ts) — un
// KYC en attente n'y suffit plus à refuser ; sinon `publicationBlock` dit pourquoi.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const [user, right, missions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }),
    clientPublicationRight(userId),
    prisma.mission.findMany({
      where: { clientId: userId, status: "brouillon" },
      select: { id: true, titre: true, domaine: true, publicationRequestedAt: true, createdAt: true },
      orderBy: [{ publicationRequestedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }),
  ]);

  return NextResponse.json({
    kycVerified: user?.kycStatus === "verifie",
    kycStatus: user?.kycStatus ?? null,
    canPublish: right.ok,
    publicationBlock: right.ok ? null : { error: right.error, message: right.message },
    missions,
  });
}
