import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { garantSchema } from "@/lib/validation";
import { canAddGarant, isDuplicateGarantTel } from "@/lib/garant-rules";

// Personnes ressources (Artisan/Manœuvre) — 1 obligatoire + 2 optionnelles
// (etat-consolide-Flexwork.md §1.3), rattachées au profil générique.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // { where: { userId } } n'est pas une clé unique valide depuis le passage multi-profils
  // (@@unique([userId, label]), pas userId seul) — voir le même correctif détaillé dans
  // src/app/api/profile/route.ts. findFirst() n'exige pas de contrainte unique.
  const profile = await prisma.profile.findFirst({ where: { userId }, include: { garants: true } });
  if (!profile) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }
  if (!canAddGarant(profile.garants.length)) {
    return NextResponse.json({ error: "max_garants_reached" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = garantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Un même garant (numéro) ne doit pas être utilisé deux fois pour le même candidat.
  if (isDuplicateGarantTel(parsed.data.tel, profile.garants)) {
    return NextResponse.json({ error: "duplicate_garant_tel" }, { status: 409 });
  }

  const garant = await prisma.garant.create({
    data: {
      profileId: profile.id,
      nom: parsed.data.nom,
      tel: parsed.data.tel,
      obligatoire: parsed.data.obligatoire ?? profile.garants.length === 0,
    },
  });

  return NextResponse.json(garant);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // { where: { userId } } n'est pas une clé unique valide depuis le passage multi-profils
  // (@@unique([userId, label]), pas userId seul) — voir le même correctif détaillé dans
  // src/app/api/profile/route.ts. findFirst() n'exige pas de contrainte unique.
  const profile = await prisma.profile.findFirst({ where: { userId }, include: { garants: true } });
  return NextResponse.json({ items: profile?.garants ?? [] });
}
