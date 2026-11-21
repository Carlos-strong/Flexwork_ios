import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { escrowBalancesFor } from "@/lib/escrow";

export const dynamic = "force-dynamic";

/**
 * Contrats de prestation — rubrique « Contrats » de flexwork_job.
 *
 * Lecture pour la Médiation (qui instruit les litiges et agit sur le séquestre d'un contrat
 * depuis Paiements) et pour le superviseur. Là-bas, cette rubrique offre un geste « réinitialiser
 * l'étape du workflow » ; il n'est PAS repris : un contrat signé est une chaîne de hachage
 * (`previousHash` / `currentHash`) et un journal append-only, et rejouer une étape reviendrait à
 * réécrire ce que les deux parties ont signé. Le médiateur propose une résolution, il ne rembobine
 * pas un contrat.
 */
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["mediation", "superviseur"]);
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const contracts = await prisma.prestationContract.findMany({
    where: q
      ? {
          OR: [
            { mission: { titre: { contains: q, mode: "insensitive" } } },
            { client: { email: { contains: q, mode: "insensitive" } } },
            { provider: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      clientSignedAt: true,
      providerSignedAt: true,
      financingMode: true,
      retentionRate: true,
      mission: { select: { id: true, titre: true, status: true, currency: true } },
      client: { select: { email: true } },
      provider: { select: { email: true } },
      _count: { select: { jalons: true, mediations: true } },
      mediations: { where: { closedAt: null }, select: { id: true } },
    },
  });

  const balances = await escrowBalancesFor(contracts.map((c) => c.id));

  return NextResponse.json({
    items: contracts.map((c) => {
      const b = balances.get(c.id);
      return {
        id: c.id,
        createdAt: c.createdAt,
        signedByClient: c.clientSignedAt !== null,
        signedByProvider: c.providerSignedAt !== null,
        financingMode: c.financingMode,
        retentionRate: c.retentionRate,
        mission: c.mission,
        client: c.client.email,
        provider: c.provider.email,
        jalons: c._count.jalons,
        openMediation: c.mediations.length > 0,
        balance: b ? { contractual: b.contractual, funded: b.funded, released: b.released, held: b.held, fundingPending: b.fundingPending } : null,
      };
    }),
  });
}
