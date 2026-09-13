import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { profileSchema, declaredLevelSchema } from "@/lib/validation";
import { isChantierPrestataireAgeOk } from "@/lib/chantier-age";

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

  // A13 — décision arbitrée (point 03) : le contrôle porte sur la FILIÈRE PRESTATAIRE,
  // jamais sur le compte. Le blocage s'applique à l'activation du profil, pas seulement à
  // la candidature ; réévalué à chaque activation, jamais un statut figé (un profil refusé
  // à 17 ans s'active à 18 sans repasser le KYC).
  const ageOk = await isChantierPrestataireAgeOk({
    role: user.role,
    country: user.country,
    dateNaissance: user.dateNaissance,
  });
  if (!ageOk.ok) {
    return NextResponse.json({ error: "profile_below_minimum_age" }, { status: 403 });
  }

  // ⚠️ Pas de prisma.profile.upsert({ where: { userId } }) : depuis le passage multi-profils
  // (2026-08-06), Profile n'a plus de contrainte unique sur userId seul — seulement le
  // couple userId_label (@@unique([userId, label])). `where: { userId }` ne compile même
  // pas contre le type ProfileWhereUniqueInput généré ; en JS non strictement vérifié au
  // runtime ça levait une PrismaClientValidationError non interceptée = 500 systématique,
  // sans exception, sur CHAQUE tentative d'enregistrement du profil ("Domaine
  // d'intervention" ne pouvait jamais être sauvegardé). Cette UI ne gère qu'un seul profil
  // par utilisateur ("Principal"/par défaut) : on le retrouve par userId seul via findFirst
  // (pas de contrainte unique requise), et on distingue nous-mêmes create/update.
  const existing = await prisma.profile.findFirst({ where: { userId } });
  const profile = existing
    ? await prisma.profile.update({ where: { id: existing.id }, data: { ...parsed.data } })
    : await prisma.profile.create({ data: { userId, label: "Principal", isDefault: true, ...parsed.data } });

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

  // Même correctif qu'au POST ci-dessus : { where: { userId } } n'est pas une clé unique valide.
  const existing = await prisma.profile.findFirst({ where: { userId } });
  if (!existing) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }
  const profile = await prisma.profile.update({
    where: { id: existing.id },
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

  // Même correctif : { where: { userId } } n'est plus une clé unique valide depuis le
  // passage multi-profils — findFirst() n'a besoin d'aucune contrainte unique.
  const profile = await prisma.profile.findFirst({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(profile);
}
