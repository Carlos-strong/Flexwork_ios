import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { SignatureService } from "@/lib/signature";

export const dynamic = "force-dynamic";

// GET /api/signature/certificate — Liste les certificats de l'utilisateur connecté
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  try {
    const certificates = await SignatureService.getUserCertificates(userId);
    return NextResponse.json({ success: true, data: certificates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur lors du chargement des certificats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/signature/certificate — Génère un nouveau certificat numérique
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  try {
    const body = await req.json();
    const { commonName, email, organization, passphrase } = body;

    if (!commonName || !email || !passphrase) {
      return NextResponse.json(
        { error: "commonName, email et passphrase sont requis" },
        { status: 400 }
      );
    }

    if (passphrase.length < 8) {
      return NextResponse.json(
        { error: "La passphrase doit contenir au moins 8 caractères" },
        { status: 400 }
      );
    }

    const certificate = await SignatureService.generateCertificate({
      userId,
      commonName,
      email,
      organization,
      passphrase,
    });

    return NextResponse.json({ success: true, data: certificate }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur lors de la génération du certificat";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
