import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { garantUpdateSchema } from "@/lib/validation";
import { isDuplicateGarantTel } from "@/lib/garant-rules";

// Modifie un garant existant (nom et/ou téléphone) — le champ `obligatoire` n'est jamais
// éditable ici, il est géré par POST (premier garant ajouté) et par le repli automatique de
// DELETE ci-dessous.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  // Scope au propriétaire : un garant n'appartient qu'à SON candidat, jamais accessible/
  // modifiable via l'id seul par un autre utilisateur connecté.
  const garant = await prisma.garant.findFirst({
    where: { id, profile: { userId } },
    include: { profile: { include: { garants: true } } },
  });
  if (!garant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = garantUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Un même garant (numéro) ne doit pas être utilisé deux fois pour le même candidat —
  // s'applique aussi à une modification (on exclut le garant qu'on est en train d'éditer).
  if (parsed.data.tel && isDuplicateGarantTel(parsed.data.tel, garant.profile.garants, garant.id)) {
    return NextResponse.json({ error: "duplicate_garant_tel" }, { status: 409 });
  }

  const updated = await prisma.garant.update({
    where: { id },
    data: {
      ...(parsed.data.nom !== undefined ? { nom: parsed.data.nom } : {}),
      ...(parsed.data.tel !== undefined ? { tel: parsed.data.tel } : {}),
    },
  });

  return NextResponse.json(updated);
}

// Supprime un garant. Si c'était le garant obligatoire et qu'il en reste d'autres, le plus
// ancien restant est promu obligatoire à sa place — sans ça, un candidat qui avait bien un
// garant obligatoire + un optionnel se retrouverait avec un garant "juste optionnel" après
// suppression de l'obligatoire, alors que le quota (etat-consolide-Flexwork.md §1.3 : 1
// obligatoire + 2 optionnelles) resterait techniquement non satisfait malgré un garant
// disponible.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  const garant = await prisma.garant.findFirst({ where: { id, profile: { userId } } });
  if (!garant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.garant.delete({ where: { id } });

  if (garant.obligatoire) {
    const nextInLine = await prisma.garant.findFirst({
      where: { profileId: garant.profileId },
      orderBy: { createdAt: "asc" },
    });
    if (nextInLine && !nextInLine.obligatoire) {
      await prisma.garant.update({ where: { id: nextInLine.id }, data: { obligatoire: true } });
    }
  }

  return NextResponse.json({ ok: true });
}
