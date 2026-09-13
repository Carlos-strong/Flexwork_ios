/**
 * Service de signature numérique des commandes Gig (modèle Gig — recommandation #3).
 *
 * Réutilise le MÊME standard cryptographique que le modèle Mission (certificats RSA-2048,
 * passphrase, hash SHA-256) — helpers partagés exportés depuis src/lib/signature.ts —
 * mais avec un flux de signature INVERSE :
 *
 *   Mission : prestataire signe 1er (1/2), client contre-signe en dernier (2/2).
 *   Gig     : le CLIENT signe 1er (1/2, il achète et les fonds sont mis sous séquestre),
 *             le PRESTATAIRE signe en dernier (2/2, il accepte la commande) sous 24h —
 *             sinon remboursement automatique au client (voir src/lib/gig-expiry.ts).
 *
 * Les tables dédiées (GigOrderSignature / GigOrderAuditEntry / GigOrderEscrowOperation)
 * évitent de coupler le modèle Mission existant (PrestationContract) : la plateforme
 * instruit, ne détient jamais les fonds (même principe que PspEscrowOperation).
 */

import { prisma } from "@/lib/db";
import * as crypto from "crypto";
import {
  decryptPrivateKey,
  HASH_ALGORITHM,
  SIGNING_METHOD,
} from "@/lib/signature";

export interface GigSignInput {
  orderId: string;
  certificateId: string;
  passphrase: string;
  signerIp?: string;
  signerUserAgent?: string;
}

export interface GigSignResult {
  signatureId: string;
  signedDataHash: string;
  signature: string;
  signingMethod: string;
  signedAt: string;
  verifiedAt: string | null;
  keyFingerprint: string;
  role: "CLIENT" | "PRESTATAIRE";
  isLocked: boolean;
}

export class GigSignatureService {
  /**
   * Signe une commande Gig avec le certificat de l'utilisateur.
   * L'ordre (client 1/2 puis prestataire 2/2) est imposé ICI (défense en profondeur) et
   * dans la route POST /api/gigs/orders/[orderId]/sign (messages français à l'utilisateur).
   */
  static async signOrder(input: GigSignInput): Promise<GigSignResult> {
    // 1. Pas de double verrouillage
    const sigCount = await prisma.gigOrderSignature.count({ where: { orderId: input.orderId } });
    if (sigCount >= 2) {
      throw new Error("Cette commande est déjà verrouillée — impossible d'ajouter une signature");
    }

    // 2. Certificat
    const cert = await prisma.digitalCertificate.findUniqueOrThrow({ where: { id: input.certificateId } });
    if (cert.status !== "ACTIVE") {
      throw new Error("Le certificat n'est pas actif (révoqué ou expiré)");
    }
    if (cert.validUntil < new Date()) {
      throw new Error("Le certificat a expiré — veuillez en générer un nouveau");
    }

    // 3. Commande + données à signer
    const order = await prisma.gigOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { gig: { select: { titre: true, delaiJours: true } } },
    });

    const contractData = {
      orderId: order.id,
      gigId: order.gigId,
      gigTitle: order.gig.titre,
      montant: order.montant,
      currency: order.currency,
      delaiJours: order.gig.delaiJours,
      clientId: order.clientId,
      providerId: order.providerId,
      certFingerprint: cert.keyFingerprint,
      signedAt: new Date().toISOString(),
    };
    const contentString = JSON.stringify(contractData, Object.keys(contractData).sort());
    const dataHash = crypto.createHash(HASH_ALGORITHM).update(contentString).digest("hex");

    // 4. Déchiffrer la clé privée et signer
    const decryptedKey = decryptPrivateKey(
      cert.encryptedPrivateKey,
      input.passphrase,
      cert.keySalt,
      cert.keyIv,
      cert.keyAuthTag
    );
    const signer = crypto.createSign(SIGNING_METHOD);
    signer.update(dataHash);
    signer.end();
    const signature = signer.sign(decryptedKey, "base64");

    // 5. Auto-vérification
    const verifier = crypto.createVerify(SIGNING_METHOD);
    verifier.update(dataHash);
    verifier.end();
    const isValid = verifier.verify(cert.publicKey, signature, "base64");
    if (!isValid) {
      throw new Error("La signature générée est invalide — erreur interne");
    }

    // 6. Stocker la signature
    const orderSignature = await prisma.gigOrderSignature.create({
      data: {
        orderId: input.orderId,
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

    // 7. Rôle du signataire + ORDRE INVERSÉ (client 1/2, prestataire 2/2)
    const isClientSign = cert.userId === order.clientId;
    if (isClientSign) {
      if (order.clientSignedAt) {
        throw new Error("Vous avez déjà signé cette commande");
      }
      await prisma.gigOrder.update({ where: { id: order.id }, data: { clientSignedAt: new Date() } });
    } else {
      if (order.providerSignedAt) {
        throw new Error("Vous avez déjà signé cette commande");
      }
      if (!order.clientSignedAt) {
        throw new Error("Le client doit signer en premier — ordre de signature invalide");
      }
      await prisma.gigOrder.update({ where: { id: order.id }, data: { providerSignedAt: new Date() } });
    }
    const roleLabel = isClientSign ? "CLIENT" : "PRESTATAIRE";
    const roleLabelFr = isClientSign ? "Client" : "Prestataire";

    // 8. Audit chaîné
    const auditEvent = isClientSign ? "CLIENT_SIGNED_GIG" : "PROVIDER_SIGNED_GIG";
    await GigSignatureService.addAuditEntry(
      order.id,
      auditEvent,
      `Signature par le ${roleLabelFr} (${cert.commonName}) — certificat ${cert.keyFingerprint}`,
      {
        certificateId: input.certificateId,
        keyFingerprint: cert.keyFingerprint,
        commonName: cert.commonName,
        signatureId: orderSignature.id,
        signedDataHash: dataHash,
        role: roleLabel,
      }
    );

    // 9. Verrouillage à la 2ᵉ signature → commande active
    const existingSignatures = await prisma.gigOrderSignature.count({ where: { orderId: order.id } });
    let isLocked = false;
    if (existingSignatures >= 2) {
      await prisma.gigOrder.update({ where: { id: order.id }, data: { status: "active" } });
      await GigSignatureService.addAuditEntry(
        order.id,
        "LOCKED_GIG",
        "Commande verrouillée après double signature — la mission est engagée",
        { lockedByCertificate: input.certificateId }
      );
      isLocked = true;
    }

    return {
      signatureId: orderSignature.id,
      signedDataHash: dataHash,
      signature,
      signingMethod: SIGNING_METHOD,
      signedAt: orderSignature.signedAt.toISOString(),
      verifiedAt: orderSignature.verifiedAt?.toISOString() ?? null,
      keyFingerprint: cert.keyFingerprint,
      role: roleLabel as "CLIENT" | "PRESTATAIRE",
      isLocked,
    };
  }

  /**
   * Vérifie les signatures d'une commande Gig (pour réafficher les QR de preuve).
   */
  static async verifySignature(input: { orderId: string; signatureId?: string }) {
    const order = await prisma.gigOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, clientId: true, providerId: true, clientSignedAt: true, providerSignedAt: true },
    });
    if (!order) throw new Error("Commande introuvable");

    const where: Record<string, unknown> = { orderId: input.orderId };
    if (input.signatureId) where.id = input.signatureId;

    const sigs = await prisma.gigOrderSignature.findMany({
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
        signedDataHash: s.signedDataHash,
      };
    });

    return {
      orderId: order.id,
      clientSignedAt: order.clientSignedAt?.toISOString() ?? null,
      providerSignedAt: order.providerSignedAt?.toISOString() ?? null,
      signatures: verifiedSigs,
    };
  }

  /**
   * Journal d'audit immuable et chaîné d'une commande Gig (même format que ContractAuditEntry).
   */
  static async addAuditEntry(
    orderId: string,
    event: string,
    description: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const lastEntry = await prisma.gigOrderAuditEntry.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { currentHash: true },
    });

    const previousHash = lastEntry?.currentHash ?? null;
    const timestamp = new Date().toISOString();
    const metaStr = metadata ? JSON.stringify(metadata, Object.keys(metadata).sort()) : "{}";
    const raw = `${previousHash ?? "ROOT"}||${event}||${description}||${metaStr}||${timestamp}`;
    const currentHash = crypto.createHash(HASH_ALGORITHM).update(raw).digest("hex");

    await prisma.gigOrderAuditEntry.create({
      data: {
        orderId,
        event,
        description,
        metadata: (metadata ?? {}) as unknown as import("@prisma/client").Prisma.InputJsonValue,
        previousHash,
        currentHash,
        systemSignature: `sha256-${currentHash}`,
      },
    });
  }
}
