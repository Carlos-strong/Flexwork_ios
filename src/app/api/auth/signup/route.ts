import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestOtp, isUnderIpRequestLimit, getClientIp, recordOtpRequestAttempt } from "@/lib/otp";
import { findAccountConflicts } from "@/lib/dedupe";
import { signupSchema } from "@/lib/validation";
import { recordTermsAcceptance } from "@/lib/terms";

// US-101 : création de compte email + téléphone, vérifiés par OTP.
// US-1308 : bloque la création de comptes multiples via empreinte device + téléphone
// (le hash de la pièce d'identité est croisé plus tard, à l'upload KYC — US-102).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { email, tel, firstname, lastname, role, country, city, locality, address, deviceFingerprint } =
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

  // `cgvAccepted` est validé par signupSchema (z.literal(true)) : un compte ne peut pas être
  // créé sans consentement.
  //
  // Le compte ET l'acceptation VERSIONNÉE des CGU sont écrits dans la MÊME TRANSACTION
  // (2026-09-23). Ce n'est pas une coquetterie : la première version faisait l'acceptation
  // APRÈS la création, dans un `try/catch` NON BLOQUANT — et deux inscriptions réelles ont
  // donc produit un compte sans aucune preuve de consentement, sans que rien ne le signale.
  // Un `console.error` que personne ne lit n'est pas un filet de sécurité : sur une preuve
  // légale, une panne doit être BRUYANTE.
  //
  // Conséquence assumée : si l'acceptation ne peut pas être écrite, l'inscription échoue et
  // AUCUN compte n'est créé — l'utilisateur peut réessayer. C'est préférable au compte
  // à demi-complet, impossible à recréer puisque son email serait désormais pris.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        tel,
        firstname,
        lastname,
        role,
        country,
        city,
        locality,
        address,
        deviceFingerprint,
        cgvAcceptedAt: new Date(),
      },
    });
    await recordTermsAcceptance(created.id, tx);
    return created;
  });

  // Échec d'envoi du code (2026-11-09) : le compte EST créé. Répondre 500 ici laissait
  // l'utilisateur sur un message d'erreur, puis « compte déjà existant » au nouvel essai —
  // bloqué. On le laisse continuer vers /verify-otp, qui le lui dit et propose le renvoi.
  let otpSent = true;
  try {
    await requestOtp({
      userId: user.id,
      identifier: email,
      channel: "email",
      purpose: "signup",
    });
  } catch (err) {
    console.error("[signup] échec de l'envoi OTP :", err);
    otpSent = false;
  }

  return NextResponse.json({ userId: user.id, email, otpSent });
}
