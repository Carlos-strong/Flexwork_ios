import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SignatureService } from "@/lib/signature";

export const dynamic = "force-dynamic";

// POST /api/signature/sign — Signe un contrat avec le certificat de l'utilisateur
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  try {
    const body = await req.json();
    const { contractId, certificateId, passphrase } = body;

    if (!contractId || !certificateId || !passphrase) {
      return NextResponse.json(
        { error: "contractId, certificateId et passphrase sont requis" },
        { status: 400 }
      );
    }

    // Vérifier que l'utilisateur est bien partie au contrat
    const contract = await prisma.prestationContract.findUnique({
      where: { id: contractId },
      select: { clientId: true, providerId: true },
    });
    if (!contract) {
      return NextResponse.json({ error: "Contrat introuvable" }, { status: 404 });
    }
    if (contract.clientId !== userId && contract.providerId !== userId) {
      return NextResponse.json({ error: "Vous n'êtes pas partie à ce contrat" }, { status: 403 });
    }

    // Vérifier que le certificat appartient bien à l'utilisateur
    const cert = await prisma.digitalCertificate.findUnique({
      where: { id: certificateId },
      select: { userId: true },
    });
    if (!cert) {
      return NextResponse.json({ error: "Certificat introuvable" }, { status: 404 });
    }
    if (cert.userId !== userId) {
      return NextResponse.json({ error: "Ce certificat ne vous appartient pas" }, { status: 403 });
    }

    const result = await SignatureService.signContract({
      contractId,
      certificateId,
      passphrase,
      signerIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined,
      signerUserAgent: req.headers.get("user-agent") || undefined,
    });

    // Si les deux parties ont signé, mettre à jour le statut de la mission
    if (result.isLocked) {
      const updatedContract = await prisma.prestationContract.findUnique({
        where: { id: contractId },
        select: { missionId: true, clientSignedAt: true, providerSignedAt: true },
      });
      if (updatedContract?.clientSignedAt && updatedContract?.providerSignedAt) {
        await prisma.mission.update({
          where: { id: updatedContract.missionId },
          data: { status: "contrat_signe" },
        });
      }
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error signing contract:", error);
    const message = error instanceof Error ? error.message : "Erreur lors de la signature";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
