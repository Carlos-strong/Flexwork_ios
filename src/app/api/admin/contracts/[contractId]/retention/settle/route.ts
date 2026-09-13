import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { totalRetentionAmount } from "@/lib/jalons";
import { emitRetentionRelease } from "@/lib/psp-webhook";

// Solde de la retenue de garantie d'une mission qui n'ira PAS au bout (règle 18.10, 2026-09-11).
//
// Le chemin nominal ne libère la retenue que lorsque TOUS les jalons sont `libere`
// (closeJalonFullyReleased, src/lib/psp-webhook.ts). C'est correct tant que la mission se
// termine — et c'est un piège dès qu'elle s'arrête en cours de route : la retenue prélevée sur
// les jalons DÉJÀ payés reste alors au séquestre indéfiniment, sans aucune instruction pour
// aller la chercher. L'argent ne disparaît pas, il s'immobilise : c'est le mode de défaillance
// propre à toute retenue, et il n'avait pas d'issue avant cette route.
//
// Ce que la route instruit : la retenue accumulée sur les jalons effectivement LIBÉRÉS, et rien
// d'autre. Un jalon jamais validé n'a jamais rien retenu — son montant entier est encore sous
// séquestre et relève du remboursement client ou de la médiation, pas d'ici.
//
// Pourquoi l'admin médiation et pas le client : la retenue est une garantie prise sur le
// prestataire. Décider qu'elle lui est due alors que la mission s'est arrêtée est un arbitrage,
// pas une opération de gestion — le client seul y serait juge et partie.
//
// Sert aussi de REPRISE : si l'instruction nominale a été refusée par le PSP (`failed`), la
// garde d'idempotence de `emitRetentionRelease` ne compte que les `pending`/`confirmed`, donc
// un nouvel appel ici la retransmet.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { contractId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    include: {
      mission: { select: { id: true, currency: true } },
      jalons: { select: { montant: true, status: true } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.retentionRate <= 0) {
    return NextResponse.json({ error: "no_retention_on_contract" }, { status: 409 });
  }

  // Seuls les jalons libérés ont effectivement subi une retenue.
  const liberes = contract.jalons.filter((j) => j.status === "libere");
  const accrued = totalRetentionAmount(liberes, contract.retentionRate);
  if (accrued <= 0) {
    return NextResponse.json({ error: "no_retention_accrued" }, { status: 409 });
  }

  // Statut mission volontairement NON modifié : voir emitRetentionRelease. Solder le séquestre
  // ne clôt pas un litige, et la confirmation PSP posera `cloturee` seulement si aucune
  // médiation n'est ouverte.
  const result = await emitRetentionRelease({
    contractId: contract.id,
    missionId: contract.mission.id,
    amount: accrued,
    currency: contract.mission.currency,
  });
  if (!result.emitted) {
    return NextResponse.json({ error: "retention_already_instructed" }, { status: 409 });
  }

  return NextResponse.json({ amount: accrued, currency: contract.mission.currency, jalonsLiberes: liberes.length });
}
