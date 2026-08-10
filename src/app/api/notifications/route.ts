import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Fil de notifications in-app de l'utilisateur connecté (dashboard) — voir src/lib/notify.ts.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const items = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });

  return NextResponse.json({ items, unreadCount });
}

const schema = z.object({ id: z.string().optional() });

// Marque une notification précise comme lue, ou toutes si `id` est omis.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(parsed.data.id ? { id: parsed.data.id } : {}) },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
