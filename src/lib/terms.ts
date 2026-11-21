import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeChainedHash } from "@/lib/hash-chain";

// ── Conditions générales d'utilisation — version en vigueur et acceptation (2026-09-23) ───
//
// Le POURQUOI du versionnement et du chaînage est documenté sur le modèle `TermsAcceptance`
// (prisma/schema.prisma). En résumé : `User.cgvAcceptedAt` date une acceptation mais ne dit
// pas QUELLE version du texte a été acceptée, et une acceptation qu'on ne peut pas rattacher
// au texte accepté ne prouve rien.
//
// Le hash chaîné n'est PAS réimplémenté ici : `computeChainedHash` est déjà celui des
// déclarations professionnelles et des contrats (src/lib/hash-chain.ts). Un seul mécanisme.

/** Version en vigueur. À incrémenter à chaque modification substantielle des CGU. */
export const CURRENT_TERMS = {
  version: "3.2",
  effectiveAt: "2025-11-20T09:00:00.000Z",
  cguUrl: "/cgu",
  privacyUrl: "/confidentialite",
} as const;

export const CURRENT_TERMS_VERSION = CURRENT_TERMS.version;

/**
 * Empreinte du contenu présenté. Elle ne remplace pas le texte (qui vit dans /cgu) : elle
 * permet de répondre à « ce compte a-t-il accepté CE texte-là ? » sans dupliquer les CGU
 * entières en base pour chaque utilisateur.
 */
export function termsDigest(): string {
  return crypto
    .createHash("sha256")
    .update(
      [CURRENT_TERMS.version, CURRENT_TERMS.effectiveAt, CURRENT_TERMS.cguUrl, CURRENT_TERMS.privacyUrl].join("|"),
    )
    .digest("hex");
}

/**
 * Matériau canonique de l'acceptation : une CHAÎNE à ordre fixe, jamais un objet.
 *
 * Pourquoi c'est indispensable : `computeChainedHash` sérialise son payload avec
 * `JSON.stringify`. Or l'instantané est stocké dans une colonne `jsonb`, et Postgres
 * RÉORDONNE les clés (et déduplique) — un objet relu depuis la base ne se resérialise donc
 * jamais à l'identique de ce qui a été haché à l'écriture. Hasher un objet rendait la
 * vérification impossible sur des données relues : `verifyChainIntegrity` échouait
 * systématiquement, y compris sur une chaîne intacte (constaté par test).
 *
 * Une chaîne à ordre fixe traverse la base sans être altérée : la chaîne reste vérifiable.
 */
export function termsMaterial(input: {
  userId: string;
  termsVersion: string;
  effectiveAt: string;
  digest: string;
}): string {
  return [input.userId, input.termsVersion, input.effectiveAt, input.digest].join("|");
}

/** Maillon prêt pour `verifyChainIntegrity`, à partir d'une ligne relue en base. */
export function termsChainEntry(row: {
  previousHash: string | null;
  chainedHash: string;
  snapshot: unknown;
}): { previousHash: string | null; currentHash: string; payload: Record<string, unknown> } {
  const snapshot = row.snapshot as { material?: string } | null;
  return {
    previousHash: row.previousHash,
    currentHash: row.chainedHash,
    // Le payload du hash est le matériau canonique — voir termsMaterial ci-dessus.
    payload: { material: snapshot?.material ?? "" },
  };
}

/**
 * Enregistre l'acceptation des CGU par un utilisateur, chaînée à sa précédente acceptation
 * (s'il en a une — un compte peut accepter une nouvelle version plus tard).
 *
 * `db` existe pour que l'appelant puisse fournir un client de TRANSACTION (2026-09-23) :
 * l'inscription écrit le compte et son acceptation dans la même transaction, de sorte qu'il
 * ne puisse pas exister de compte sans preuve de consentement. La première version faisait
 * l'acceptation après coup, dans un `try/catch` non bloquant — deux inscriptions réelles ont
 * produit un compte sans aucune ligne, en silence. Voir POST /api/auth/signup.
 *
 * Append-only : cette fonction ne modifie ni ne supprime jamais une acceptation existante.
 */
export async function recordTermsAcceptance(userId: string, db: Prisma.TransactionClient = prisma) {
  const previous = await db.termsAcceptance.findFirst({
    where: { userId },
    orderBy: { acceptedAt: "desc" },
    select: { chainedHash: true },
  });

  const digest = termsDigest();
  const material = termsMaterial({
    userId,
    termsVersion: CURRENT_TERMS.version,
    effectiveAt: CURRENT_TERMS.effectiveAt,
    digest,
  });

  const snapshot = {
    userId,
    termsVersion: CURRENT_TERMS.version,
    effectiveAt: CURRENT_TERMS.effectiveAt,
    digest,
    material,
    cguUrl: CURRENT_TERMS.cguUrl,
    privacyUrl: CURRENT_TERMS.privacyUrl,
  };

  const previousHash = previous?.chainedHash ?? null;

  return db.termsAcceptance.create({
    data: {
      userId,
      termsVersion: CURRENT_TERMS.version,
      effectiveAt: new Date(CURRENT_TERMS.effectiveAt),
      digest,
      snapshot,
      previousHash,
      chainedHash: computeChainedHash(previousHash, { material }),
    },
  });
}
