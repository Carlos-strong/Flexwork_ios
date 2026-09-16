import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";
import { detectCollusionSuspicion } from "@/lib/collusion-detection";

// Alerte sur les opérations d'escrow PSP anormales entre deux mêmes comptes (même device,
// montants ronds répétés), pour prévenir la collusion/blanchiment. Porte désormais sur
// `PspEscrowOperation` (instructions transmises au PSP), pas sur un solde interne détenu
// par la plateforme (qui n'existe plus, modele-skillafrica-v3-Flexwork.md §6).
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Portée `mission_contract` (2026-09-14) : depuis l'unification des registres, la même table
  // porte les opérations des commandes Gig, qui n'ont pas de contrat — et donc pas de couple
  // client/prestataire contractuel sur lequel raisonner. La détection de collusion entre deux
  // mêmes comptes se fait sur les contrats ; l'étendre aux Gigs demanderait un autre critère,
  // pas seulement une requête plus large.
  const operations = await prisma.pspEscrowOperation.findMany({
    where: { status: "confirmed", sourceType: "mission_contract" },
    include: { contract: { include: { client: true, provider: true } } },
  });

  const byPair = new Map<
    string,
    { montant: number; payerDeviceFingerprint: string | null; payeeDeviceFingerprint: string | null }[]
  >();

  for (const op of operations) {
    // `contract` est garanti non nul par le filtre de portée ci-dessus ; Prisma ne sait pas
    // l'exprimer dans son type, la contrainte de base de données le garantit (voir
    // PspEscrowOperation_scope_exclusive).
    if (!op.contract) continue;
    const key = `${op.contract.clientId}:${op.contract.providerId}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push({
      montant: op.amount,
      payerDeviceFingerprint: op.contract.client.deviceFingerprint,
      payeeDeviceFingerprint: op.contract.provider.deviceFingerprint,
    });
  }

  const suspects = Array.from(byPair.entries())
    .filter(([, txs]) => detectCollusionSuspicion(txs))
    .map(([key, txs]) => {
      const [clientId, providerId] = key.split(":");
      return { clientId, providerId, transactionCount: txs.length };
    });

  return NextResponse.json({ items: suspects });
}
