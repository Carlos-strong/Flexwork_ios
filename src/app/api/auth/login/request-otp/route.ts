import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  requestOtp,
  isUnderOtpRequestLimit,
  isUnderIpRequestLimit,
  getClientIp,
  recordOtpRequestAttempt,
} from "@/lib/otp";

const schema = z.object({ identifier: z.string().min(3) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { identifier } = parsed.data;
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

  // Réponse strictement identique que le compte existe ou non — auparavant un 404
  // "account_not_found" laissait énumérer les comptes enregistrés malgré le commentaire
  // affirmant l'inverse. Si aucun compte ne correspond, on ne fait juste rien de plus.
  if (user && user.status === "active") {
    // ⚠️ Volontairement PAS de `await` ici. `requestOtp` écrit en base puis part en SMTP —
    // en l'attendant, la réponse HTTP met mesurablement plus longtemps à revenir pour un
    // compte existant que pour un identifiant inconnu (vérifié : ~20-90ms vs ~10ms en local),
    // ce qui recrée par le simple timing la fuite d'énumération que ce corps de réponse
    // identique est censé éliminer. En laissant la promesse courir en arrière-plan, la
    // réponse part avant l'écriture/l'envoi, dans les deux branches. Ce endpoint tourne sur
    // un process Node persistant (next start) donc la promesse va bien à son terme — à
    // revalider si ce handler est un jour déployé en serverless/edge, où le runtime peut
    // être tué dès la réponse envoyée.
    void requestOtp({
      userId: user.id,
      identifier,
      channel: identifier.includes("@") ? "email" : "sms",
      purpose: "login",
    }).catch((err) => {
      console.error("[request-otp] échec de l'envoi OTP en arrière-plan :", err);
    });
  }

  return NextResponse.json({ ok: true });
}
