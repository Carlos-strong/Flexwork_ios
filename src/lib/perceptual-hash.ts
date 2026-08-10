import crypto from "crypto";

/**
 * US-1307 — hash perceptuel simplifié (average-hash) pour détecter les photos de
 * portfolio/chantier recyclées ou dupliquées entre comptes, comparé à toutes les photos
 * déjà en base avant d'accepter un nouvel upload. La recherche d'image inversée (TinEye ou
 * équivalent) reste à intégrer en complément — non disponible en local.
 *
 * NB : un vrai aHash/pHash opère sur les pixels décodés (nécessite une lib d'image comme
 * `sharp`, absente ici). Ce stub hashe les octets bruts du fichier : il détecte les
 * doublons strictement identiques mais pas les recadrages/recompressions — à durcir avant
 * la mise en production avec un vrai hash perceptuel pixel.
 */
export function computePerceptualHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hexToBits(hex: string): string {
  return hex
    .split("")
    .map((c) => parseInt(c, 16).toString(2).padStart(4, "0"))
    .join("");
}

export function hammingDistance(hashA: string, hashB: string): number {
  const bitsA = hexToBits(hashA);
  const bitsB = hexToBits(hashB);
  const length = Math.min(bitsA.length, bitsB.length);
  let distance = Math.abs(bitsA.length - bitsB.length);
  for (let i = 0; i < length; i++) {
    if (bitsA[i] !== bitsB[i]) distance++;
  }
  return distance;
}

const DUPLICATE_THRESHOLD = 8; // seuil de départ, à affiner avec des données réelles

export function isLikelyDuplicatePhoto(newHash: string, existingHashes: string[]): boolean {
  return existingHashes.some((h) => hammingDistance(newHash, h) <= DUPLICATE_THRESHOLD);
}
