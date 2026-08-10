import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

// File d'attente des garants non encore confirmés par appel (etat-consolide-Flexwork.md
// §1.3 — 1 garant obligatoire + 2 optionnels pour Artisan/Manœuvre). Miroir de
// /api/admin/kyc/queue, manquant jusqu'ici : la route de décision (POST .../decision)
// existait déjà sans aucune liste pour l'alimenter.
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const garants = await prisma.garant.findMany({
    where: { statutAppel: "a_appeler" },
    include: { profile: { include: { user: { select: { id: true, email: true, tel: true, country: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: garants.map((g) => ({
      id: g.id,
      nom: g.nom,
      tel: g.tel,
      obligatoire: g.obligatoire,
      createdAt: g.createdAt,
      manoeuvre: g.profile.user,
    })),
  });
}
