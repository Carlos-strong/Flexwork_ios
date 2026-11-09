import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listQualificationSpecialties } from "@/lib/qualification-specialties";

export const dynamic = "force-dynamic";

/**
 * GET /api/qualification-specialties → { specialties: [{ libelle, categorieId }] }
 *
 * Suggestions de spécialités de diplômes (src/lib/qualification-specialties.ts). Réservé aux
 * comptes connectés : la liste est faite de saisies d'utilisateurs, non modérées, et ne sert
 * qu'au formulaire de déclaration.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const specialties = await listQualificationSpecialties();
  return NextResponse.json({ specialties });
}
