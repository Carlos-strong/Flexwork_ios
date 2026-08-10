import crypto from "crypto";

const WEBHOOK_SECRET = process.env.ESCROW_WEBHOOK_SECRET ?? "dev-escrow-webhook-secret";

/**
 * Signature HMAC générique pour tous les webhooks de paiement de la plateforme
 * (escrow mission — US-1314, paiement de session de certification — US-602).
 * Un seul secret partagé pour l'instant ; à séparer par provider si plusieurs
 * intégrations réelles coexistent en production.
 */
export function signWebhookPayload(payload: Record<string, unknown>): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
}

export function verifyWebhookSignatureGeneric(payload: Record<string, unknown>, signature: string): boolean {
  const expected = signWebhookPayload(payload);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
