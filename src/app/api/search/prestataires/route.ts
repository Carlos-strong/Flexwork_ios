import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Recherche de prestataires par domaine, rôle, tags et zone. Modèle v3 : aucune
// vérification de qualification ne conditionne l'apparition dans les résultats — seul le
// KYC (identité) est un fait vérifié par la plateforme, tout le reste (déclarations) est
// affiché tel quel côté profil, pas filtré ici comme un critère de "qualité".
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const domaine = searchParams.get("domaine");
  const role = searchParams.get("role");
  const tagsParam = searchParams.get("tags");
  const pays = searchParams.get("pays");   // filtre zone: pays du profil

  if (!domaine) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const roleFilter: UserRole[] =
    role && PROVIDER_ROLES.includes(role as UserRole) ? [role as UserRole] : PROVIDER_ROLES;

  const tagsFilter = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : null;

  // Filtrage zone : un prestataire est éligible si sa zonePays = pays demandé,
  // OU s'il n'a pas défini de zonePays (partout), OU si le paramètre pays est absent.
  const profileWhere: Record<string, unknown> = { mainDomain: domaine };
  if (tagsFilter && tagsFilter.length > 0) profileWhere.tags = { hasSome: tagsFilter };
  if (pays) {
    profileWhere.OR = [
      { zonePays: pays },
      { zonePays: null },
    ];
  }

  const providers = await prisma.user.findMany({
    where: {
      kycStatus: "verifie",
      role: { in: roleFilter },
      profiles: { some: profileWhere },
    },
    include: { profiles: true },
  });

  return NextResponse.json({
    items: providers.map((p) => {
      const profile =
        p.profiles.find((pf) => pf.mainDomain === domaine) ??
        p.profiles.find((pf) => pf.isDefault) ??
        p.profiles[0];
      return {
        id: p.id,
        email: p.email,
        role: p.role,
        mainDomain: profile?.mainDomain,
        declaredLevel: profile?.declaredLevel,
        tags: profile?.tags ?? [],
        tarifUnite: profile?.tarifUnite ?? null,
        indicativeRate: profile?.indicativeRate ?? null,
        zonePays: profile?.zonePays ?? null,
        zoneVille: profile?.zoneVille ?? null,
        zoneRayonKm: profile?.zoneRayonKm ?? null,
      };
    }),
  });
}
