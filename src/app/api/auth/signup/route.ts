import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requestOtp, isUnderIpRequestLimit, getClientIp, recordOtpRequestAttempt } from "@/lib/otp";
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

  // Anti-spam par IP sur la création de comptes : la limite par identifiant n'a pas de sens
  // ici (chaque inscription utilise un email/tél uniques), la limite par IP est la seule qui
  // bloque un bot qui créerait des comptes en masse. Comptabilisée pour CHAQUE tentative.
  //
  // ⚠️ Ne protège réellement que derrière un reverse-proxy de confiance (voir l'avertissement
  // sur getClientIp dans src/lib/otp.ts). Vérifié (2026-08-20) : sans un tel proxy, un bot qui
  // fait varier x-forwarded-for à chaque appel crée des comptes sans jamais être bloqué (20/20
  // comptes créés dans ce test). Ne pas compter sur cette limite seule pour empêcher la
  // création de comptes en masse tant que la topologie réseau n'est pas confirmée.
  const ip = getClientIp(req);
  if (!(await isUnderIpRequestLimit(ip))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  await recordOtpRequestAttempt(email, ip);

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
