/**
 * Acceptation des CGU — versionnée et chaînée par hash (2026-09-23).
 *
 * Ce qui est verrouillé ici : `User.cgvAcceptedAt` ne dit pas QUELLE version du texte a été
 * acceptée. Ces tests fixent le fait que chaque acceptation enregistre la version en vigueur,
 * l'empreinte du contenu, et se chaîne à la précédente — de sorte qu'une acceptation ne peut
 * être ni retirée ni réordonnée sans rompre la chaîne.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { recordTermsAcceptance, CURRENT_TERMS_VERSION, termsDigest, termsChainEntry } from "@/lib/terms";
import { computeChainedHash, verifyChainIntegrity } from "@/lib/hash-chain";

const RUN = Date.now();
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `e2e-cgu-${RUN}@flexwork.test`,
      tel: `+2295${String(RUN).slice(-7)}`,
      role: "client",
      country: "BJ",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.termsAcceptance.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("acceptation des CGU", () => {
  it("enregistre la version en vigueur, l'empreinte du texte et un premier maillon sans prédécesseur", async () => {
    const first = await recordTermsAcceptance(userId);

    expect(first.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(first.digest).toBe(termsDigest());
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.previousHash).toBeNull();
    // Le premier maillon se recalcule à partir du seul matériau canonique.
    expect(first.chainedHash).toBe(computeChainedHash(null, termsChainEntry(first).payload));
  });

  it("chaîne une nouvelle acceptation à la précédente, sans jamais réécrire l'ancienne", async () => {
    const first = await prisma.termsAcceptance.findFirstOrThrow({
      where: { userId, previousHash: null },
    });

    const second = await recordTermsAcceptance(userId);

    expect(second.previousHash).toBe(first.chainedHash);
    expect(second.chainedHash).not.toBe(first.chainedHash);

    // Append-only : la première ligne est intacte.
    const unchanged = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: first.id } });
    expect(unchanged.chainedHash).toBe(first.chainedHash);
  });

  it("produit une chaîne dont l'intégrité se vérifie", async () => {
    const rows = await prisma.termsAcceptance.findMany({ where: { userId } });
    const first = rows.find((r) => r.previousHash === null);
    const second = rows.find((r) => r.previousHash === first?.chainedHash);

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const ordered = [first!, second!].map(termsChainEntry);

    expect(verifyChainIntegrity(ordered)).toBe(true);

    // Un maillon altéré rompt la vérification — c'est tout l'intérêt du chaînage.
    const tampered = [{ ...ordered[0], payload: { material: "altéré" } }, ordered[1]];
    expect(verifyChainIntegrity(tampered)).toBe(false);
  });

  it("l'instantané conserve ce qui a été montré : version, date d'entrée en vigueur et liens", async () => {
    const row = await prisma.termsAcceptance.findFirstOrThrow({
      where: { userId, previousHash: null },
    });
    const snapshot = row.snapshot as Record<string, unknown>;

    expect(snapshot.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(snapshot.userId).toBe(userId);
    expect(snapshot.effectiveAt).toBe("2025-11-20T09:00:00.000Z");
    expect(snapshot.cguUrl).toBe("/cgu");
    expect(snapshot.privacyUrl).toBe("/confidentialite");
    expect(row.effectiveAt.toISOString()).toBe("2025-11-20T09:00:00.000Z");
  });
});
