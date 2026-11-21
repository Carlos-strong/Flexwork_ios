import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// DELETE /api/proposal-drafts/[id] — le prestataire abandonne une candidature en brouillon.
// Seul son auteur la voit et la supprime : un autre identifiant répond 404, sans dire si elle existe.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  const { count } = await prisma.proposalDraft.deleteMany({ where: { id, providerId: userId } });
  if (count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
