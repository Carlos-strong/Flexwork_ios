import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { checkInOptInSchema } from "@/lib/validation";

// A12 — chaque partie active uniquement SON propre consentement, jamais celui de l'autre
// ni celui d'un admin (etat-consolide-Flexwork.md §2, A12, condition n°3 : activation par
// les DEUX parties via le contrat).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = checkInOptInSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isClient = contract.clientId === userId;
  const updated = await prisma.prestationContract.update({
    where: { missionId },
    data: isClient
      ? { clientOptedInCheckIn: parsed.data.optIn }
      : { providerOptedInCheckIn: parsed.data.optIn },
  });

  return NextResponse.json({
    clientOptedInCheckIn: updated.clientOptedInCheckIn,
    providerOptedInCheckIn: updated.providerOptedInCheckIn,
  });
}
