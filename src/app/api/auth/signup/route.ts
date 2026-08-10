import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requestOtp } from "@/lib/otp";
import { findAccountConflicts } from "@/lib/dedupe";
import { signupSchema } from "@/lib/validation";

// US-101 : création de compte email + téléphone, vérifiés par OTP.
// US-1308 : bloque la création de comptes multiples via empreinte device + téléphone
// (le hash de la pièce d'identité est croisé plus tard, à l'upload KYC — US-102).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { email, tel, password, firstname, lastname, role, country, city, locality, address, deviceFingerprint } =
    parsed.data;

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { tel }] } });
  if (existing) {
    return NextResponse.json({ error: "account_already_exists" }, { status: 409 });
  }

  const conflict = await findAccountConflicts({ deviceFingerprint, tel });
  if (conflict.conflict) {
    return NextResponse.json(
      { error: "duplicate_account_suspected", reason: conflict.reason },
      { status: 409 }
    );
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

  const user = await prisma.user.create({
    data: { email, tel, passwordHash, firstname, lastname, role, country, city, locality, address, deviceFingerprint },
  });

  await requestOtp({
    userId: user.id,
    identifier: email,
    channel: "email",
    purpose: "signup",
  });

  return NextResponse.json({ userId: user.id });
}
