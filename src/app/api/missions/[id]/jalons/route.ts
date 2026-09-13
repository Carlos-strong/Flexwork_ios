import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Liste des jalons du contrat de la mission — vide si le contrat n'utilise pas de paiement
// fractionné (comportement historique, un seul HOLD/RELEASE sur le prix total).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { jalons: { orderBy: { ordre: "asc" } } },
  });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // financingMode/jalonsSequential (règle 18.4/18.8-18.9) — pour que l'UI explique POURQUOI un
  // jalon `en_attente` reste verrouillé (18.9) et affiche un indicateur de mode de financement.
  return NextResponse.json({
    items: contract.jalons,
    financingMode: contract.financingMode,
    jalonsSequential: contract.jalonsSequential,
  });
}
