import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { signKycDocToken } from "@/lib/storage";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const requesterId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  const doc = await prisma.kycDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const requester = await prisma.user.findUnique({ where: { id: requesterId } });
  const isOwner = doc.userId === requesterId;
  // Séparation des pouvoirs (§13) : une pièce d'identité ne s'ouvre qu'au rôle qui instruit les
  // dossiers. `isAdmin` seul laissait la modération, la médiation, l'éditeur du site — et un
  // admin sans rôle — lire les documents d'identité que leur écran ne leur montre jamais.
  const isKycAdmin = requester?.isAdmin === true && requester.adminRole === "kyc";
  if (!isOwner && !isKycAdmin) {
    // 404 (pas 403) : un tiers ne doit pas savoir que le document KYC existe.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const token = signKycDocToken(doc.id);
  return NextResponse.json({ url: `/api/kyc/file/${token}` });
}
