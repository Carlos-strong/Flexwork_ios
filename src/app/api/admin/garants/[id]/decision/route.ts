import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

const schema = z.object({ statutAppel: z.enum(["confirme", "injoignable"]) });

// L'admin enregistre le résultat de l'appel à un garant (1 obligatoire + 2 optionnelles,
// etat-consolide-Flexwork.md §1.3 — table `Garant` générique, rattachée au `Profile`).
//
// Geste du rôle KYC (2026-09-21) : il porte sur l'identité et la joignabilité d'une personne.
// Il était ouvert à tout administrateur et exposé dans le tableau de bord du superviseur, qui
// par le §13 ne modifie rien. Il est désormais journalisé, comme toute décision sur une personne.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const garant = await prisma.garant.update({
    where: { id },
    data: { statutAppel: parsed.data.statutAppel },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "garant_call_result",
    targetType: "Garant",
    targetId: id,
    justification: parsed.data.statutAppel === "confirme" ? "Garant joint et confirmé par appel" : "Garant injoignable après appel",
  });

  return NextResponse.json({ statutAppel: garant.statutAppel });
}
