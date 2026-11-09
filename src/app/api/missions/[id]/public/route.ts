import { NextResponse } from "next/server";
import { getPublicMission } from "@/lib/public-mission";

// Fiche publique d'une mission PUBLIÉE (2026-11-09), sans connexion — champs filtrés par
// src/lib/public-mission.ts. Toute autre mission (brouillon, engagée, inexistante) : 404, sans
// distinguer les cas.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mission = await getPublicMission(id);
  if (!mission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(mission, { headers: { "Cache-Control": "no-store" } });
}
