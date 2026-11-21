import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { isUnderOtpRequestLimit, recordOtpRequestAttempt, requestOtp, verifyOtp, type OtpFailure } from "@/lib/otp";

// Réinitialisation de la passphrase de signature (2026-11-10).
//
// La passphrase chiffre la clé privée du certificat : oubliée, elle ne se récupère pas, on
// génère un nouveau certificat (l'ancien est révoqué — SignatureService.generateCertificate).
// Sans contrôle, quiconque tenant une session ouverte pouvait remplacer le certificat d'un
// utilisateur et signer à sa place. Remplacer un certificat ACTIF exige donc un code OTP
// envoyé à l'e-mail du compte ; le PREMIER certificat n'en demande pas (rien à remplacer).
// Le titulaire est ensuite prévenu par e-mail du renouvellement.

export type ResetOtpError = "no_active_certificate" | "too_many_requests" | "send_failed";

/** « pr*******@gmail.com » — l'écran indique où chercher le code sans exposer l'adresse. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}${"*".repeat(Math.max(local.length - keep.length, 3))}@${domain}`;
}

export async function hasActiveCertificate(userId: string): Promise<boolean> {
  return (await prisma.digitalCertificate.count({ where: { userId, status: "ACTIVE" } })) > 0;
}

/** Envoie le code de réinitialisation à l'e-mail du compte. */
export async function sendSignatureResetOtp(
  userId: string,
  ip?: string | null,
): Promise<{ ok: true; destination: string } | { ok: false; error: ResetOtpError }> {
  if (!(await hasActiveCertificate(userId))) return { ok: false, error: "no_active_certificate" };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const identifier = user.email.toLowerCase();
  // Même limite que la connexion (5 demandes / 15 min par identifiant).
  if (!(await isUnderOtpRequestLimit(identifier))) return { ok: false, error: "too_many_requests" };
  await recordOtpRequestAttempt(identifier, ip);
  try {
    await requestOtp({ userId, identifier, channel: "email", purpose: "signature_reset" });
  } catch (err) {
    console.error("[signature-reset] Échec d'envoi du code :", err);
    return { ok: false, error: "send_failed" };
  }
  return { ok: true, destination: maskEmail(identifier) };
}

export const RESET_OTP_MESSAGES: Record<OtpFailure | "otp_required", string> = {
  otp_required: "Un code de vérification est requis pour remplacer votre certificat de signature.",
  no_pending_otp: "Aucun code en cours : demandez un nouveau code de vérification.",
  expired: "Ce code a expiré : demandez-en un nouveau.",
  too_many_attempts: "Trop de tentatives : demandez un nouveau code de vérification.",
  invalid_code: "Code de vérification incorrect.",
};

export function checkSignatureResetOtp(userId: string, code: string) {
  return verifyOtp({ userId, purpose: "signature_reset", code });
}

/** Prévient le titulaire que son certificat a été remplacé (il n'en est peut-être pas l'auteur). */
export async function notifyCertificateRenewed(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;
  const text =
    "Votre certificat de signature électronique Flexwork vient d'être renouvelé avec une nouvelle passphrase. " +
    "L'ancien certificat est révoqué ; vos signatures déjà apposées restent valides. " +
    "Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement le support.";
  await sendMail({ to: user.email, subject: "Votre certificat de signature a été renouvelé", text, html: `<p>${text}</p>` });
}
