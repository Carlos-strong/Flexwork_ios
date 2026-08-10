import { NextResponse } from "next/server";

// Route désactivée (2026-08-06) — remplacée par la signature électronique réelle
// (POST /api/signature/sign, src/lib/signature.ts). Cette route ne faisait que poser un
// horodatage `clientSignedAt`/`providerSignedAt` sans aucune preuve cryptographique — ni
// certificat, ni hash, ni ContractSignature — alors qu'elle produisait exactement le même
// effet (mission → "contrat_signe") qu'une vraie signature. La laisser active aurait permis
// de contourner tout le système de certificats RSA en appelant directement cette route.
// Conservée en 410 (plutôt que supprimée) pour documenter explicitement pourquoi elle ne
// répond plus, au cas où un appelant externe l'utiliserait encore.
export async function POST() {
  return NextResponse.json(
    { error: "route_disabled", message: "Utilisez POST /api/signature/sign (certificat électronique réel)." },
    { status: 410 }
  );
}
