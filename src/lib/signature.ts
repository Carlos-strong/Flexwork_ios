/**
 * Service de signature numérique — certificats RSA, signature cryptographique, validation.
 *
 * Architecture :
 *   1. Génération de paire de clés RSA-2048
 *   2. Création de certificat numérique (clé publique + métadonnées)
 *   3. La clé privée est chiffrée (AES-256-GCM) avec une clé dérivée (PBKDF2)
 *      avant d'être stockée en base — seule la clé publique est exportable
 *   4. Signature SHA-256 + RSA du contenu d'un contrat
 *   5. Vérification de signature avec la clé publique
 *
 * Utilisation API :
 *   POST /api/signature/certificate  → générer un certificat
 *   POST /api/signature/sign         → signer un contrat
 *   POST /api/signature/verify       → vérifier une signature
 *   GET  /api/signature/certificate  → lister/consulter ses certificats
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import * as crypto from "crypto";

// ── Constantes ──────────────────────────────
const RSA_KEY_SIZE = 2048;
// Constantes partagées avec le service de signature Gig (src/lib/gig-signature.ts) — le
// même standard cryptographique s'applique aux deux modèles (certificats RSA-2048,
// passphrase, hash SHA-256).
export const HASH_ALGORITHM = "sha256";
export const SIGNING_METHOD = "RSA-SHA256";
export const CERTIFICATE_VALIDITY_YEARS = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const KEY_LENGTH = 32; // 256 bits pour AES-256
export const AES_ALGORITHM = "aes-256-gcm";
export const AUTH_TAG_LENGTH = 16;

// ── Types ───────────────────────────────────
export interface CertificateInput {
  userId: string;
  commonName: string;
  email: string;
  organization?: string;
  passphrase: string;
}

export interface SignInput {
  contractId: string;
  certificateId: string;
  passphrase: string;
  signerIp?: string;
  signerUserAgent?: string;
}

export interface VerifyInput {
  contractId: string;
  signatureId?: string;
}

export interface CertificateInfo {
  id: string;
  userId: string;
  commonName: string;
  email: string;
  organization: string | null;
  validFrom: Date;
  validUntil: Date;
  status: string;
  keyFingerprint: string;
  publicKey: string;
  createdAt: Date;
}

// ── Helpers cryptographiques ────────────────

export function decryptPrivateKey(
  encryptedHex: string,
  passphrase: string,
  saltHex: string,
  ivHex: string,
  authTagHex: string
): string {
  const key = crypto.pbkdf2Sync(passphrase, saltHex, PBKDF2_ITERATIONS, KEY_LENGTH, HASH_ALGORITHM);
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ── Service ─────────────────────────────────
export class SignatureService {
  /**
   * Génère un certificat numérique RSA-2048 pour un utilisateur.
   * La clé privée est chiffrée (AES-256-GCM) avant stockage.
   * Révoque tout certificat actif précédent du même utilisateur.
   */
  static async generateCertificate(input: CertificateInput): Promise<CertificateInfo> {
    // 1. Révoquer les certificats actifs existants
    await prisma.digitalCertificate.updateMany({
      where: { userId: input.userId, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokeReason: "Remplacé par un nouveau certificat",
      },
    });

    // 2. Générer la paire de clés RSA-2048
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: RSA_KEY_SIZE,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // 3. Calculer l'empreinte de la clé publique
    const fingerprint = crypto
      .createHash(HASH_ALGORITHM)
      .update(keyPair.publicKey)
      .digest("hex")
      .toUpperCase()
      .replace(/(.{2})(?=.)/g, "$1:");

    // 4. Chiffrer la clé privée avec AES-256-GCM + PBKDF2
    const salt = crypto.randomBytes(32).toString("hex");
    const iv = crypto.randomBytes(12).toString("hex");

    const key = crypto.pbkdf2Sync(input.passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, HASH_ALGORITHM);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, key, Buffer.from(iv, "hex"));
    const encrypted = Buffer.concat([
      cipher.update(keyPair.privateKey, "utf-8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag().toString("hex");

    // 5. Dates de validité
    const validFrom = new Date();
    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + CERTIFICATE_VALIDITY_YEARS);

    // 6. Stocker en base
    const certificate = await prisma.digitalCertificate.create({
      data: {
        userId: input.userId,
        commonName: input.commonName,
        email: input.email,
        organization: input.organization,
        validFrom,
        validUntil,
        status: "ACTIVE",
        publicKey: keyPair.publicKey,
        encryptedPrivateKey: encrypted.toString("hex"),
        keyFingerprint: fingerprint,
        keySalt: salt,
        keyIv: iv,
        keyAuthTag: authTag,
      },
    });

    return {
      id: certificate.id,
      userId: certificate.userId,
      commonName: certificate.commonName,
      email: certificate.email,
      organization: certificate.organization,
      validFrom: certificate.validFrom,
      validUntil: certificate.validUntil,
      status: certificate.status,
      keyFingerprint: certificate.keyFingerprint,
      publicKey: certificate.publicKey,
      createdAt: certificate.createdAt,
    };
  }

  /**
   * Calcule le hash SHA-256 complet d'un contrat (toutes les données + jalons).
   */
  static async computeContractHash(contractId: string): Promise<{ hash: string; contentString: string }> {
    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: {
        mission: { select: { titre: true, description: true, budget: true } },
        jalons: { select: { titre: true, montant: true, ordre: true, status: true } },
      },
    });

    const normalizable = {
      contractId: contract.id,
      missionId: contract.missionId,
      missionTitle: contract.mission.titre,
      missionDescription: contract.mission.description,
      missionBudget: contract.mission.budget,
      termsSnapshot: contract.termsSnapshot,
      acceptanceDeadlineDays: contract.acceptanceDeadlineDays,
      jalons: contract.jalons.map((j) => ({
        ordre: j.ordre,
        titre: j.titre,
        montant: j.montant,
        status: j.status,
      })),
    };

    const contentString = JSON.stringify(normalizable, Object.keys(normalizable).sort());
    const hash = crypto.createHash("sha256").update(contentString).digest("hex");
    return { hash, contentString };
  }

  /**
   * Crée une entrée dans le journal d'audit immuable du contrat.
   * Chaque entrée est chaînée au hash de l'entrée précédente.
   */
  static async addAuditEntry(
    contractId: string,
    event: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const lastEntry = await prisma.contractAuditEntry.findFirst({
      where: { contractId },
      orderBy: { createdAt: "desc" },
      select: { currentHash: true },
    });

    const previousHash = lastEntry?.currentHash ?? null;
    const timestamp = new Date().toISOString();
    const metaStr = metadata ? JSON.stringify(metadata, Object.keys(metadata).sort()) : "{}";

    const raw = `${previousHash ?? "ROOT"}||${event}||${description}||${metaStr}||${timestamp}`;
    const currentHash = crypto.createHash("sha256").update(raw).digest("hex");

    await prisma.contractAuditEntry.create({
      data: {
        contractId,
        event,
        description,
        metadata: (metadata ?? {}) as unknown as Prisma.InputJsonValue,
        previousHash,
        currentHash,
        systemSignature: `sha256-${currentHash}`,
      },
    });
  }

  /**
   * Verrouille un contrat après la double signature.
   * Calcule le hash final du contrat, le stocke.
   */
  static async lockContract(contractId: string, byCertificateId: string): Promise<void> {
    const { hash } = await SignatureService.computeContractHash(contractId);

    // Mettre à jour le currentHash existant — cohérent avec le chaînage
    // existant du modèle PrestationContract (previousHash → currentHash)
    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      select: { currentHash: true },
    });

    await prisma.prestationContract.update({
      where: { id: contractId },
      data: {
        previousHash: contract.currentHash,
        currentHash: hash,
      },
    });

    await SignatureService.addAuditEntry(
      contractId,
      "LOCKED",
      "Contrat verrouillé après double signature — empreinte enregistrée",
      { documentHash: hash, lockedByCertificate: byCertificateId }
    );
  }

  /**
   * Vérifie l'intégrité d'un contrat verrouillé.
   */
  static async checkIntegrity(contractId: string): Promise<{
    valid: boolean;
    reason: string;
    currentHash: string | null;
    lockedHash: string | null;
  }> {
    const contract = await prisma.prestationContract.findUnique({
      where: { id: contractId },
      select: { currentHash: true },
    });

    if (!contract) {
      return { valid: false, reason: "Contrat introuvable", currentHash: null, lockedHash: null };
    }

    // Vérifier qu'il y a bien 2 signatures
    const sigCount = await prisma.contractSignature.count({ where: { contractId } });
    if (sigCount < 2) {
      return {
        valid: false,
        reason: "Le contrat n'est pas encore verrouillé (en attente des signatures)",
        currentHash: null,
        lockedHash: null,
      };
    }

    const { hash: currentHash } = await SignatureService.computeContractHash(contractId);
    const valid = currentHash === contract.currentHash;

    const event = valid ? "INTEGRITY_CHECK" : "TAMPER_DETECTED";
    await SignatureService.addAuditEntry(
      contractId,
      event,
      valid
        ? "Vérification d'intégrité réussie — le contenu du contrat est identique à l'original"
        : "⚠️ ALTÉRATION DÉTECTÉE — le contenu du contrat ne correspond plus à l'empreinte verrouillée !",
      { currentHash, lockedHash: contract.currentHash, integrityValid: valid }
    );

    return {
      valid,
      reason: valid
        ? "Intégrité vérifiée — le contrat n'a pas été modifié depuis son verrouillage"
        : "⚠️ ALTÉRATION DÉTECTÉE — le contenu a été modifié après les signatures !",
      currentHash,
      lockedHash: contract.currentHash,
    };
  }

  /**
   * Récupère la chaîne d'audit complète d'un contrat (journal immuable).
   */
  static async getAuditTrail(contractId: string) {
    const entries = await prisma.contractAuditEntry.findMany({
      where: { contractId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        event: true,
        description: true,
        metadata: true,
        previousHash: true,
        currentHash: true,
        createdAt: true,
      },
    });

    let chainValid = true;
    for (let i = 0; i < entries.length; i++) {
      const prevHash = i === 0 ? null : entries[i - 1].currentHash;
      if (entries[i].previousHash !== prevHash) {
        chainValid = false;
        break;
      }
    }

    return {
      contractId,
      entries: entries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      chainValid,
    };
  }

  /**
   * Signe numériquement un contrat avec le certificat de l'utilisateur.
   *
   * Processus :
   *   1. Vérifie que le contrat n'est pas déjà verrouillé (2 signatures)
   *   2. Récupère le certificat et vérifie qu'il est ACTIVE
   *   3. Déchiffre la clé privée avec la passphrase
   *   4. Calcule le hash SHA-256 du contenu du contrat
   *   5. Signe le hash avec la clé privée RSA
   *   6. Stocke la signature
   *   7. Met à jour clientSignedAt / providerSignedAt sur le contrat
   *   8. Si les 2 parties ont signé → verrouillage automatique
   */
  static async signContract(input: SignInput) {
    // 1. Vérifier que le contrat n'est pas déjà doublement signé
    const sigCount = await prisma.contractSignature.count({
      where: { contractId: input.contractId },
    });
    if (sigCount >= 2) {
      throw new Error("Ce contrat est déjà verrouillé — impossible d'ajouter une signature");
    }

    // 2. Récupérer le certificat
    const cert = await prisma.digitalCertificate.findUniqueOrThrow({
      where: { id: input.certificateId },
    });

    if (cert.status !== "ACTIVE") {
      throw new Error("Le certificat n'est pas actif (révoqué ou expiré)");
    }

    if (cert.validUntil < new Date()) {
      throw new Error("Le certificat a expiré — veuillez en générer un nouveau");
    }

    // 3. Récupérer le contrat avec ses données pour le hash
    const signingContract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: input.contractId },
      include: {
        mission: { select: { titre: true } },
        jalons: { select: { titre: true, montant: true } },
      },
    });

    // 4. Construire le contenu à signer
    const contractData = {
      contractId: signingContract.id,
      missionId: signingContract.missionId,
      missionTitle: signingContract.mission.titre,
      acceptanceDeadlineDays: signingContract.acceptanceDeadlineDays,
      jalons: signingContract.jalons.map((j) => ({
        titre: j.titre,
        montant: j.montant,
      })),
      certFingerprint: cert.keyFingerprint,
      signedAt: new Date().toISOString(),
    };

    const contentString = JSON.stringify(contractData, Object.keys(contractData).sort());
    const dataHash = crypto.createHash(HASH_ALGORITHM).update(contentString).digest("hex");

    // 5. Déchiffrer la clé privée
    const decryptedKey = decryptPrivateKey(
      cert.encryptedPrivateKey,
      input.passphrase,
      cert.keySalt,
      cert.keyIv,
      cert.keyAuthTag
    );

    // 6. Signer le hash avec la clé privée RSA
    const signer = crypto.createSign(SIGNING_METHOD);
    signer.update(dataHash);
    signer.end();
    const signature = signer.sign(decryptedKey, "base64");

    // 7. Auto-vérification
    const verifier = crypto.createVerify(SIGNING_METHOD);
    verifier.update(dataHash);
    verifier.end();
    const isValid = verifier.verify(cert.publicKey, signature, "base64");

    if (!isValid) {
      throw new Error("La signature générée est invalide — erreur interne");
    }

    // 8. Stocker la signature
    const contractSignature = await prisma.contractSignature.create({
      data: {
        contractId: input.contractId,
        certificateId: input.certificateId,
        signedDataHash: dataHash,
        signature,
        signingMethod: SIGNING_METHOD,
        signedAt: new Date(),
        verifiedAt: new Date(),
        signerIp: input.signerIp,
        signerUserAgent: input.signerUserAgent,
      },
    });

    // 9. Déterminer le rôle du signataire
    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: input.contractId },
      select: { clientId: true, providerId: true },
    });

    const isClientSign = cert.userId === contract.clientId;
    const roleLabel = isClientSign ? "CLIENT" : "PRESTATAIRE";
    const roleLabelFr = isClientSign ? "Client" : "Prestataire";

    // 10. Mettre à jour le contrat
    if (isClientSign) {
      await prisma.prestationContract.update({
        where: { id: input.contractId },
        data: { clientSignedAt: new Date() },
      });
    } else {
      await prisma.prestationContract.update({
        where: { id: input.contractId },
        data: { providerSignedAt: new Date() },
      });
    }

    // 11. Journal d'audit
    const auditEvent = isClientSign ? "CLIENT_SIGNED" : "PROVIDER_SIGNED";
    await SignatureService.addAuditEntry(
      input.contractId,
      auditEvent,
      `Signature par le ${roleLabelFr} (${cert.commonName}) — certificat ${cert.keyFingerprint}`,
      {
        certificateId: input.certificateId,
        keyFingerprint: cert.keyFingerprint,
        commonName: cert.commonName,
        signatureId: contractSignature.id,
        signedDataHash: dataHash,
        role: roleLabel,
      }
    );

    // 12. Si les deux parties ont signé → verrouillage automatique
    const existingSignatures = await prisma.contractSignature.count({
      where: { contractId: input.contractId },
    });
    let isLocked = false;
    if (existingSignatures >= 2) {
      await SignatureService.lockContract(input.contractId, input.certificateId);
      isLocked = true;
    }

    return {
      signatureId: contractSignature.id,
      signedDataHash: dataHash,
      signature,
      signingMethod: SIGNING_METHOD,
      signedAt: contractSignature.signedAt.toISOString(),
      verifiedAt: contractSignature.verifiedAt?.toISOString(),
      keyFingerprint: cert.keyFingerprint,
      role: roleLabel,
      isLocked,
    };
  }

  /**
   * Vérifie les signatures d'un contrat.
   */
  static async verifySignature(input: VerifyInput) {
    const contract = await prisma.prestationContract.findUnique({
      where: { id: input.contractId },
      select: { id: true, clientId: true, providerId: true, clientSignedAt: true, providerSignedAt: true },
    });

    if (!contract) throw new Error("Contrat introuvable");

    const where: Record<string, unknown> = { contractId: input.contractId };
    if (input.signatureId) where.id = input.signatureId;

    const sigs = await prisma.contractSignature.findMany({
      where,
      include: {
        certificate: {
          select: {
            id: true,
            commonName: true,
            email: true,
            keyFingerprint: true,
            publicKey: true,
            status: true,
            validUntil: true,
          },
        },
      },
      orderBy: { signedAt: "asc" },
    });

    const verifiedSigs = sigs.map((s) => {
      const verifier = crypto.createVerify(s.signingMethod);
      verifier.update(s.signedDataHash);
      verifier.end();
      const valid = verifier.verify(s.certificate.publicKey, s.signature, "base64");

      const isClient = s.certificate.id
        ? true // On ne peut pas résoudre sans la FK userId sur ContractSignature
        : false;

      return {
        signatureId: s.id,
        signerName: s.certificate.commonName,
        signerEmail: s.certificate.email,
        keyFingerprint: s.certificate.keyFingerprint,
        certificateStatus: s.certificate.status,
        certificateValidUntil: s.certificate.validUntil.toISOString(),
        signedAt: s.signedAt.toISOString(),
        signatureValid: valid,
        signingMethod: s.signingMethod,
        // Nécessaire pour régénérer le même QR (SignatureQRCode) qu'à l'instant T de la
        // signature lors d'une visite ultérieure de la page contrat — donnée déjà stockée
        // (ContractSignature.signedDataHash), simplement absente du payload jusqu'ici.
        signedDataHash: s.signedDataHash,
      };
    });

    return {
      contractId: contract.id,
      clientSignedAt: contract.clientSignedAt?.toISOString() ?? null,
      providerSignedAt: contract.providerSignedAt?.toISOString() ?? null,
      signatures: verifiedSigs,
    };
  }

  /**
   * Récupère les certificats d'un utilisateur.
   */
  static async getUserCertificates(userId: string): Promise<CertificateInfo[]> {
    const certs = await prisma.digitalCertificate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        commonName: true,
        email: true,
        organization: true,
        validFrom: true,
        validUntil: true,
        status: true,
        keyFingerprint: true,
        publicKey: true,
        createdAt: true,
      },
    });

    return certs;
  }
}
