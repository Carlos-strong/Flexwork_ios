import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requestOtp, isUnderOtpRequestLimit } from "@/lib/otp";

const schema = z.object({ identifier: z.string().min(3) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { identifier } = parsed.data;

  if (!(await isUnderOtpRequestLimit(identifier))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { tel: identifier }] },
  });

  // Réponse strictement identique que le compte existe ou non — auparavant un 404
  // "account_not_found" laissait énumérer les comptes enregistrés malgré le commentaire
  // affirmant l'inverse. Si aucun compte ne correspond, on ne fait juste rien de plus.
  if (user && user.status === "active") {
    await requestOtp({
      userId: user.id,
      identifier,
      channel: identifier.includes("@") ? "email" : "sms",
      purpose: "login",
    });
  }

  return NextResponse.json({ ok: true });
}
