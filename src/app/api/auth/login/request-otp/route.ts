import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  requestOtp,
  isUnderOtpRequestLimit,
  isUnderIpRequestLimit,
  getClientIp,
  normalizeIdentifier,
  recordOtpRequestAttempt,
} from "@/lib/otp";

// `purpose` (2026-09-23) : l'écran /verify-otp doit pouvoir RENVOYER le code reçu à
// l'inscription. `verifyOtp` filtre par `purpose` (src/lib/otp.ts) et la vérification envoie
// `purpose=signup` (src/auth.ts) : un renvoi créé en `login` ne serait JAMAIS retrouvé par
// elle. Liste FERMÉE, et non un `z.string()` : `purpose` vient du client, on n'accepte que ce
// dont cet écran a besoin.
const schema = z.object({
  identifier: z.string().min(3),
  purpose: z.enum(["login", "signup"]).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Forme canonique (minuscules, sans espaces) : c'est aussi elle que compte le rate-limit,
  // sinon « A@x.com » et « a@x.com » auraient chacun leurs cinq demandes.
  const identifier = normalizeIdentifier(parsed.data.identifier);
  const purpose = parsed.data.purpose ?? "login";
  const ip = getClientIp(req);

  // Les deux limites (par identifiant et par IP) tournent pour CHAQUE requête, compte
  // existant ou non, avant tout branchement sur l'existence du compte : la réponse (200/429)
  // ne dépend que du comportement de l'émetteur, jamais de l'existence du compte visé.
  //
  // ⚠️ La limite par IP (isUnderIpRequestLimit) ne bloque réellement un contournement par
  // identifiants uniques QUE derrière un reverse-proxy de confiance qui écrase
  // x-forwarded-for — voir l'avertissement sur getClientIp dans src/lib/otp.ts. Vérifié
  // (2026-08-20) : sans un tel proxy, faire varier x-forwarded-for à chaque requête suffit à
  // contourner cette limite (150/150 requêtes passées en rotant l'IP déclarée).
  if (!(await isUnderOtpRequestLimit(identifier))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }
  if (!(await isUnderIpRequestLimit(ip))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  // Comptabilisée pour CHAQUE identifiant, existant ou non — sinon le rate-limit lui-même
  // devient l'oracle d'énumération (voir le commentaire sur isUnderOtpRequestLimit dans
  // src/lib/otp.ts) : un identifiant inexistant ne finirait jamais par recevoir un 429.
  await recordOtpRequestAttempt(identifier, ip);

  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { tel: identifier }] },
  });

  // Vérification d'existence AVANT toute génération d'OTP (2026-11-07) : un identifiant
  // inconnu reçoit un 404 explicite au lieu d'un `ok` silencieux qui envoyait l'utilisateur
  // attendre sur /verify-otp un code qui n'arriverait jamais. L'anti-énumération par réponse
  // identique n'avait de toute façon plus de portée : /api/auth/signup répond déjà 409
  // `account_already_exists`. Le rate-limit ci-dessus (par identifiant ET par IP, comptabilisé
  // pour tout identifiant) reste le garde-fou contre le balayage d'identifiants.
  if (!user) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }
  if (user.status !== "active") {
    return NextResponse.json({ error: "account_inactive" }, { status: 403 });
  }

  // Attendu désormais : plus de fuite de timing à masquer, et un échec d'envoi (SMTP/SMS)
  // remonte à l'utilisateur au lieu de le laisser attendre un code jamais parti.
  try {
    await requestOtp({
      userId: user.id,
      identifier,
      channel: identifier.includes("@") ? "email" : "sms",
      purpose,
    });
  } catch (err) {
    console.error("[request-otp] échec de l'envoi OTP :", err);
    return NextResponse.json({ error: "otp_send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
