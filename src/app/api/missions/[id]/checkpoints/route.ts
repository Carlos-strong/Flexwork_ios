import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Historique des points d'étape ("validations partielles", voir .../checkpoint) d'une
// mission — jalon par jalon et/ou au niveau mission (contrat sans jalon). Consultable par les
// DEUX parties du contrat (même restriction que GET .../attachments) : le prestataire doit
// pouvoir voir que le client a confirmé une étape, pas seulement le client qui l'a posée.
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

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const checkpoints = await prisma.progressCheckpoint.findMany({
    where: { missionId },
    orderBy: { createdAt: "desc" },
    include: {
      validatedBy: { select: { firstname: true, lastname: true } },
      jalon: { select: { titre: true, ordre: true } },
    },
  });

  return NextResponse.json({
    items: checkpoints.map((c) => ({
      id: c.id,
      jalonId: c.jalonId,
      jalonTitre: c.jalon?.titre ?? null,
      // Regroupement par jalon côté vues liste (ex. MesMissions) — sur un contrat à
      // jalons, une mission peut avoir plusieurs jalons chacun avec ses propres points
      // d'étape ; sans cet ordre, impossible de les présenter dans l'ordre du contrat.
      jalonOrdre: c.jalon?.ordre ?? null,
      progress: c.progress,
      validatedByName: [c.validatedBy.firstname, c.validatedBy.lastname].filter(Boolean).join(" ") || "Client",
      createdAt: c.createdAt,
    })),
  });
}
