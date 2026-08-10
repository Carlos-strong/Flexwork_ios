import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { isValidMinimumAge, isChantierRole } from "@/lib/age-gate";

const schema = z.object({
  country: z.string().min(2),
  profileType: z.enum(["artisan", "manoeuvre", "expert_btp_autres"]),
  domain: z.string().optional(),
  minimumAge: z.number().int(),
  legalReference: z.string().optional(),
  justification: z.string().min(1),
});

// A13 (etat-consolide-Flexwork.md §2) : seuil d'âge administrable par pays, JAMAIS en
// dessous de 18 ans — rejeté côté serveur, pas seulement empêché par l'UI. Une valeur ne
// peut être ajustée que vers le haut (ex. 21 ans pour la conduite d'engins).
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!isChantierRole(parsed.data.profileType)) {
    return NextResponse.json({ error: "not_a_chantier_role" }, { status: 400 });
  }
  if (!isValidMinimumAge(parsed.data.minimumAge)) {
    return NextResponse.json({ error: "minimum_age_below_legal_floor" }, { status: 422 });
  }

  const entry = await prisma.countryAgeRequirement.upsert({
    where: {
      country_profileType_domain: {
        country: parsed.data.country,
        profileType: parsed.data.profileType,
        domain: (parsed.data.domain ?? null) as unknown as string,
      },
    },
    create: { ...parsed.data, setByAdminId: guard.user.id },
    update: { ...parsed.data, setByAdminId: guard.user.id },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "country_age_requirement_set",
    targetType: "CountryAgeRequirement",
    targetId: entry.id,
    justification: parsed.data.justification,
  });

  return NextResponse.json(entry);
}

export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const items = await prisma.countryAgeRequirement.findMany({ orderBy: [{ country: "asc" }, { profileType: "asc" }] });
  return NextResponse.json({ items });
}
