import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { profileSchema, declaredLevelSchema } from "@/lib/validation";
import { isChantierProfileAllowed, isChantierRole } from "@/lib/age-gate";

// US-102 (Phase 1) : profil générique, quel que soit le rôle. Ne conditionne aucune
// vérification de la plateforme — jamais bloqué par le statut KYC (modele-skillafrica-v3-
// Flexwork.md §9 : le KYC ne bloque jamais la complétion du profil).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // A13 — le blocage porte sur l'activation du profil, pas seulement sur la candidature
  // (etat-consolide-Flexwork.md §2, A13). Réévalué à chaque activation/mise à jour, jamais
  // un statut figé : un profil refusé à 17 ans s'active de lui-même à 18 ans.
  if (isChantierRole(user.role)) {
    const requirement = await prisma.countryAgeRequirement.findUnique({
      where: {
        country_profileType_domain: {
          country: user.country ?? "",
          profileType: user.role,
          domain: null as unknown as string,
        },
      },
    });

    if (
      !isChantierProfileAllowed({
        role: user.role,
        dateNaissance: user.dateNaissance,
        minimumAge: requirement?.minimumAge ?? null,
      })
    ) {
      return NextResponse.json({ error: "profile_below_minimum_age" }, { status: 403 });
    }
  }

  const profile = await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...parsed.data },
    update: { ...parsed.data },
  });

  return NextResponse.json(profile);
}

// US-305 (Phase 3) : niveau et expérience purement auto-déclarés, aucun calcul serveur.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = declaredLevelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.profile.update({
    where: { userId },
    data: parsed.data,
  });

  return NextResponse.json(profile);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(profile);
}
