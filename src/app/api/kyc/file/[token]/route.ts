import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { readStoredFile, verifyKycDocToken } from "@/lib/storage";

// Sert un document KYC uniquement via une URL signée à durée limitée (5 min),
// et uniquement au propriétaire du document ou à un admin.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const decoded = verifyKycDocToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const requesterId = (session.user as typeof session.user & { id: string }).id;

  const doc = await prisma.kycDocument.findUnique({ where: { id: decoded.docId } });
  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const requester = await prisma.user.findUnique({ where: { id: requesterId } });
  const isOwner = doc.userId === requesterId;
  const isAdmin = requester?.isAdmin === true;
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const buffer = await readStoredFile(doc.filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
