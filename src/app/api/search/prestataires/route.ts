import { NextResponse } from "next/server";
import { searchProviders } from "@/lib/provider-search";

// Recherche publique de prestataires (navbar, /recherche, liens partagés). La logique vit dans
// src/lib/provider-search.ts, partagée avec le rendu serveur de /recherche — voir son en-tête,
// notamment sur l'absence d'email dans la réponse.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json({ items: await searchProviders(searchParams) });
}
