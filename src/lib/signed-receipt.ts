import crypto from "crypto";

const SECRET = process.env.AUTH_SECRET ?? "dev-secret";

// US-1304 — accusé de validation de jalon signé (HMAC), opposable en cas de rétrofacturation
// carte : preuve que le client a bien validé la livraison avant le déblocage des fonds.
export function signReceiptPayload(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return crypto.createHmac("sha256", SECRET).update(json).digest("hex");
}

export function verifyReceiptSignature(payload: Record<string, unknown>, signature: string): boolean {
  const expected = signReceiptPayload(payload);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
