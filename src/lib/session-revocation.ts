import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

// Déconnexion RÉELLE côté serveur (2026-11-09).
//
// La session est un JWT sans état (src/auth.ts). Avant ce module, « se déconnecter »
// voulait seulement dire « effacer le cookie » — or chaque réponse de /api/auth/session
// réécrit ce cookie. Une requête encore en vol au moment du clic sur « Déconnexion »
// (polling de la cloche, chargement de page sur un serveur lent) pouvait donc le remettre
// en place, et l'utilisateur restait connecté. Même chose pour un cookie copié ailleurs.
//
// Désormais chaque connexion porte un identifiant de session (`sid`). La déconnexion
// l'inscrit dans RevokedSession ; le callback `jwt` refuse tout token qui le porte. Un cookie
// réécrit après coup est donc un cookie mort. Seule CETTE session est fermée : les autres
// appareils de l'utilisateur restent connectés.

/** Durée de vie par défaut d'une session Auth.js (30 jours), si le token n'a pas d'`exp`. */
const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function newSessionId(): string {
  return randomUUID();
}

type RevocableToken = { sid?: unknown; id?: unknown; sub?: unknown; exp?: unknown } | null | undefined;

/**
 * Révoque la session portée par ce token. Idempotent. Purge au passage les révocations
 * expirées (le token qu'elles visaient est de toute façon refusé à l'expiration).
 */
export async function revokeSession(token: RevocableToken, now: Date = new Date()): Promise<boolean> {
  const sid = typeof token?.sid === "string" ? token.sid : null;
  if (!sid) return false;
  const userId =
    typeof token?.id === "string" ? token.id : typeof token?.sub === "string" ? token.sub : "";
  const expiresAt =
    typeof token?.exp === "number"
      ? new Date(token.exp * 1000)
      : new Date(now.getTime() + DEFAULT_SESSION_MAX_AGE_MS);

  await prisma.revokedSession.upsert({
    where: { sid },
    create: { sid, userId, expiresAt },
    update: {},
  });
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } });
  return true;
}

export async function isSessionRevoked(sid: string): Promise<boolean> {
  const row = await prisma.revokedSession.findUnique({ where: { sid }, select: { sid: true } });
  return row !== null;
}
