import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
// Même garde de LECTURE que les autres files du module — voir le commentaire de badges/route.ts.
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { mobileMoneyOperatorLabel } from "@/lib/mobile-money";

export const dynamic = "force-dynamic";

// File d'instruction des comptes de versement Mobile Money (2026-09-23).
//
// L'Admin KYC y voit ce qu'il doit contrôler : un opérateur et un numéro, un TITULAIRE saisi
// (jamais déduit du compte — un versement sur le compte d'un tiers est un signal), et le
// justificatif de domicile. La pièce d'identité n'est pas listée ici : elle a sa propre file
// (`GET /api/admin/kyc/[userId]/documents`) et son propre statut. Un dossier financier ne
// rejuge pas l'identité, il la suppose acquise.
//
// Seuls les dossiers EN ATTENTE remontent : un compte déjà vérifié n'a rien à faire dans une
// file d'instruction, et une file qui les garderait deviendrait illisible en quelques semaines.

export async function GET() {
  const guard = await requireAnyAdminRole(["kyc", "superviseur"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const accounts = await prisma.payoutAccount.findMany({
    where: { status: "en_attente" },
    orderBy: { submittedAt: "asc" },
    include: {
      user: { select: { id: true, email: true, tel: true, firstname: true, lastname: true, role: true, kycStatus: true } },
    },
  });

  // Les justificatifs sont résolus en une requête et non une par dossier : une file de vingt
  // dossiers ferait sinon vingt allers-retours pour une donnée que l'écran affiche côte à côte.
  const proofIds = accounts.map((a) => a.addressProofDocId).filter((id): id is string => Boolean(id));
  const proofs = proofIds.length
    ? await prisma.kycDocument.findMany({
        where: { id: { in: proofIds } },
        select: { id: true, status: true, createdAt: true },
      })
    : [];
  const proofById = new Map(proofs.map((p) => [p.id, p]));

  return NextResponse.json({
    items: accounts.map((account) => {
      const proof = account.addressProofDocId ? proofById.get(account.addressProofDocId) : undefined;
      return {
        id: account.id,
        userId: account.user.id,
        user: account.user,
        operator: account.operator,
        operatorLabel: mobileMoneyOperatorLabel(account.operator),
        number: account.number,
        holder: account.holder,
        submittedAt: account.submittedAt,
        addressProof: proof ? { docId: proof.id, status: proof.status } : null,
      };
    }),
    count: accounts.length,
  });
}
