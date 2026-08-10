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
  const isAdmin = requester?.isAdmin === true;
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const token = signKycDocToken(doc.id);
  return NextResponse.json({ url: `/api/kyc/file/${token}` });
}
