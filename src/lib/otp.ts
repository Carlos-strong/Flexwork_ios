import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import type { OtpChannel, OtpPurpose } from "@prisma/client";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 5;

// Anti-spam sur la demande d'un NOUVEAU code — sans ça, le plafond de 5 tentatives par
// code (MAX_ATTEMPTS) est contournable en redemandant simplement un code frais après
// chaque série d'échecs. Compte par identifiant brut (email/tel), pas par IP — une
// limite par IP nécessiterait une infra supplémentaire non présente ici.
export async function isUnderOtpRequestLimit(identifier: string): Promise<boolean> {
  const since = new Date(Date.now() - REQUEST_WINDOW_MS);
  const count = await prisma.otpCode.count({
    where: { identifier, createdAt: { gte: since } },
  });
  return count < MAX_REQUESTS_PER_WINDOW;
}

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// bcrypt est délibérément lent (anti brute-force sur un secret longue durée à forte valeur,
// ex. mot de passe compte). Un OTP à 6 chiffres est le cas inverse : faible entropie (900k
// possibilités), courte durée de vie (10 min), déjà limité à 5 tentatives (MAX_ATTEMPTS
// ci-dessus) — bcrypt n'y ajoute aucune sécurité réelle, seulement de la latence perçue à
// chaque envoi/vérification. SHA-256 + comparaison à temps constant suffit largement ici.
function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function codeMatches(code: string, codeHash: string): boolean {
  const candidate = Buffer.from(hashCode(code));
  const stored = Buffer.from(codeHash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

/**
 * Génère et "envoie" un OTP. En dev/local (pas de provider SMS/WhatsApp réel),
 * l'envoi est stubé : le code est journalisé côté serveur au lieu de partir par SMS.
 * Remplacer `deliverOtp` par un vrai provider (Twilio / WhatsApp Cloud API) en prod.
 */
export async function requestOtp(params: {
  userId: string;
  identifier: string;
  channel: OtpChannel;
  purpose: OtpPurpose;
}) {
  const code = generateSixDigitCode();
  const codeHash = hashCode(code);

  await prisma.otpCode.create({
    data: {
      userId: params.userId,
      identifier: params.identifier,
      channel: params.channel,
      purpose: params.purpose,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await deliverOtp({ identifier: params.identifier, channel: params.channel, code });
}

async function deliverOtp(params: { identifier: string; channel: OtpChannel; code: string }) {
  if (params.channel === "email") {
    await sendMail({
      to: params.identifier,
      subject: `Votre code de vérification Flexwork : ${params.code}`,
      text: `Votre code de vérification est ${params.code}. Il expire dans 10 minutes.`,
      html: `<p>Votre code de vérification est <strong>${params.code}</strong>.</p><p>Il expire dans 10 minutes.</p>`,
    });
    return;
  }

  // SMS : pas de provider réel branché (Twilio / WhatsApp Cloud API) — reste stubbé.
  console.log(`[OTP STUB] channel=${params.channel} identifier=${params.identifier} code=${params.code}`);
}

export async function verifyOtp(params: {
  userId: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const otp = await prisma.otpCode.findFirst({
    where: {
      userId: params.userId,
      purpose: params.purpose,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return { ok: false, reason: "no_pending_otp" };
  if (otp.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (otp.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  const matches = codeMatches(params.code, otp.codeHash);

  if (!matches) {
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid_code" };
  }

  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true };
}
