import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

const schema = z.object({ statutAppel: z.enum(["confirme", "injoignable"]) });

// L'admin enregistre le résultat de l'appel à un garant (1 obligatoire + 2 optionnelles,
// etat-consolide-Flexwork.md §1.3 — table `Garant` générique, rattachée au `Profile`).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin();
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

  return NextResponse.json({ statutAppel: garant.statutAppel });
}
