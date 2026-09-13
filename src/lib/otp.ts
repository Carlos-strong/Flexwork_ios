import crypto from "crypto";
import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import type { OtpChannel, OtpPurpose } from "@prisma/client";

// Prérequis production (reverse-proxy qui écrase x-forwarded-for, limites) : voir DEPLOYMENT-PRODUCTION.md

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 5;

// Rate-limit PAR IP (en plus de celui par identifiant) : couvre le cas où un attaquant
// contourne la limite par identifiant en en générant des uniques. Plus généreux que la
// limite par identifiant pour ne pas bloquer des IP partagées (NAT/entreprise).
//
// ⚠️ NE PROTÈGE RÉELLEMENT QUE DERRIÈRE UN REVERSE-PROXY DE CONFIANCE qui écrase
// x-forwarded-for avec la vraie adresse du client avant que cette app ne la lise (voir
// getClientIp ci-dessous). Sans un tel proxy configuré et vérifié, x-forwarded-for est un
// header client ordinaire : un appelant fait varier son IP déclarée à chaque requête aussi
// facilement que l'identifiant, et cette limite ne bloque plus rien. Vérifié empiriquement
// (2026-08-20) : 150 requêtes avec un x-forwarded-for différent à chaque fois → 150×200,
// 0 bloquée. Ne pas déployer en confiance tant que la topologie réseau (proxy qui écrase ce
// header, app qui n'écoute que derrière lui) n'est pas confirmée pour cet environnement.
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_IP_WINDOW = 100;

// Purge de OtpRequestAttempt : la table est écrite pour CHAQUE requête reçue (compte
// existant ou non) et grossirait sans fin sans nettoyage — risque de DoS par épuisement du
// stockage. La purge est déclenchée paresseusement à chaque écriture, au plus tous les
// OTP_ATTEMPT_CLEANUP_INTERVAL_MS, pour borner la latence ajoutée à une fois par intervalle.
const OTP_ATTEMPT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let lastOtpAttemptCleanup = 0;

// IP du client : x-forwarded-for (premier hop, normalisé) sinon x-real-ip, sinon "unknown".
// En dev local (pas de proxy) tout le trafic tombe dans "unknown" — un seul bucket global,
// volontaire pour conserver une protection même sans proxy. En prod derrière un reverse-proxy
// qui pose x-forwarded-for, on obtient de vraies IP. À adapter si l'infra pose un autre header.
//
// ⚠️ Ces headers sont fournis par le client HTTP lui-même — rien ici ne vérifie que la
// requête est bien passée par un proxy qui les écrase avant d'atteindre cette app. Tant
// que la topologie de déploiement n'est pas confirmée (proxy de confiance en amont, non
// contournable), traiter la valeur retournée comme une IP DÉCLARÉE, pas authentifiée : un
// appelant direct peut y mettre ce qu'il veut, requête par requête. Ce même risque fait que
// TOUT le trafic peut retomber dans le bucket "unknown" ci-dessus si aucun proxy ne pose
// réellement ce header en prod — un seul quota partagé par l'ensemble des utilisateurs.
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Anti-spam sur la demande d'un NOUVEAU code — sans ça, le plafond de 5 tentatives par
// code (MAX_ATTEMPTS) est contournable en redemandant simplement un code frais après
// chaque série d'échecs. Compte par identifiant brut (email/tel), pas par IP — une
// limite par IP nécessiterait une infra supplémentaire non présente ici.
//
// ⚠️ Compte sur OtpRequestAttempt, PAS sur OtpCode : OtpCode a un userId obligatoire et
// n'existe donc que pour des comptes réels. Compter sur OtpCode ferait de ce rate-limit un
// oracle d'énumération à lui seul — un identifiant inexistant ne serait jamais bloqué
// (jamais de ligne créée), un compte réel finirait par recevoir un 429 : l'attaquant n'a
// qu'à observer si le 6e appel renvoie 429 pour savoir si le compte existe, sans même lire
// le corps de la réponse. `recordOtpRequestAttempt` doit être appelé pour CHAQUE requête,
// que le compte existe ou non, pour que ce signal reste symétrique.
export async function isUnderOtpRequestLimit(identifier: string): Promise<boolean> {
  const since = new Date(Date.now() - REQUEST_WINDOW_MS);
  const count = await prisma.otpRequestAttempt.count({
    where: { identifier, createdAt: { gte: since } },
  });
  return count < MAX_REQUESTS_PER_WINDOW;
}

// Limite par IP — voir MAX_REQUESTS_PER_IP_WINDOW. Doit tourner pour CHAQUE requête (compte
// existant ou non), comme la limite par identifiant, pour ne pas devenir un oracle : elle
// ne révèle rien sur l'existence d'un compte (elle dépend du comportement de l'émetteur).
export async function isUnderIpRequestLimit(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - IP_WINDOW_MS);
  const count = await prisma.otpRequestAttempt.count({
    where: { ip, createdAt: { gte: since } },
  });
  return count < MAX_REQUESTS_PER_IP_WINDOW;
}

// Supprime les tentatives plus vieilles que la fenêtre. Throttlée par un timestamp en
// mémoire pour ne pas lancer un deleteMany à chaque requête. L'index autonome sur createdAt
// (migration 20260820204300) rend ce balayage efficace.
export async function cleanupOtpRequestAttempts(): Promise<void> {
  const now = Date.now();
  if (now - lastOtpAttemptCleanup < OTP_ATTEMPT_CLEANUP_INTERVAL_MS) return;
  lastOtpAttemptCleanup = now;
  await prisma.otpRequestAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now - REQUEST_WINDOW_MS) } },
  });
}

// À appeler pour CHAQUE demande d'OTP reçue (compte existant ou non) avant de brancher sur
// l'existence du compte — voir l'avertissement sur isUnderOtpRequestLimit ci-dessus. Déclenche
// aussi la purge paresseuse de la table (borner sa croissance).
export async function recordOtpRequestAttempt(identifier: string, ip?: string | null): Promise<void> {
  await cleanupOtpRequestAttempts();
  await prisma.otpRequestAttempt.create({ data: { identifier, ip: ip ?? null } });
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
