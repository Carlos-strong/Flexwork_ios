import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptPrivateKey, InvalidPassphraseError } from "@/lib/signature";

// Même schéma que SignatureService.generateCertificate : PBKDF2 → AES-256-GCM.
function encrypt(plain: string, passphrase: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return { enc: enc.toString("hex"), salt, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

describe("decryptPrivateKey — passphrase", () => {
  it("bonne passphrase : renvoie la clé", () => {
    const e = encrypt("CLE-PRIVEE", "bonne-phrase");
    expect(decryptPrivateKey(e.enc, "bonne-phrase", e.salt, e.iv, e.tag)).toBe("CLE-PRIVEE");
  });

  it("mauvaise passphrase : InvalidPassphraseError lisible, pas le message brut d'AES-GCM", () => {
    const e = encrypt("CLE-PRIVEE", "bonne-phrase");
    expect(() => decryptPrivateKey(e.enc, "autre", e.salt, e.iv, e.tag)).toThrow(InvalidPassphraseError);
    expect(() => decryptPrivateKey(e.enc, "autre", e.salt, e.iv, e.tag)).toThrow(/Passphrase incorrecte/);
  });
});
