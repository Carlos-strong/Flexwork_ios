import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SignatureService } from "@/lib/signature";

export const dynamic = "force-dynamic";

// POST /api/signature/verify — Vérifie les signatures d'un contrat
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { contractId, signatureId } = body;

    if (!contractId) {
      return NextResponse.json({ error: "contractId est requis" }, { status: 400 });
    }

    const result = await SignatureService.verifySignature({
      contractId,
      signatureId: signatureId || undefined,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error verifying signature:", error);
    const message = error instanceof Error ? error.message : "Erreur lors de la vérification";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
