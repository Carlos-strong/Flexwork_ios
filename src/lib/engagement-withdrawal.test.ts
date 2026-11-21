import { describe, expect, it } from "vitest";
import { canWithdrawEngagement, favoritesAvailable } from "./engagement-withdrawal-rules";
import { isReserveOpen, reserveUntil, RESERVE_DAYS } from "./mission-expiry";

const e = (status: string, contract: { clientSignedAt: string | null; providerSignedAt: string | null } | null = null, parentMissionId: string | null = "annonce") => ({
  parentMissionId,
  status,
  contract,
});

describe("canWithdrawEngagement", () => {
  it("annulable avant la signature complète", () => {
    expect(canWithdrawEngagement(e("proposition_acceptee"))).toBe(true);
    expect(canWithdrawEngagement(e("contrat_genere", { clientSignedAt: null, providerSignedAt: "2026-11-11" }))).toBe(true);
  });
  it("plus annulable une fois signé des deux parties, financé ou terminé", () => {
    expect(canWithdrawEngagement(e("contrat_genere", { clientSignedAt: "2026-11-11", providerSignedAt: "2026-11-11" }))).toBe(false);
    expect(canWithdrawEngagement(e("contrat_signe"))).toBe(false);
    expect(canWithdrawEngagement(e("fonds_sous_sequestre"))).toBe(false);
    expect(canWithdrawEngagement(e("annulee"))).toBe(false);
  });
  it("une mission qui n'est pas un engagement n'est pas concernée", () => {
    expect(canWithdrawEngagement(e("proposition_acceptee", null, null))).toBe(false);
  });
});

describe("réserve", () => {
  const close = new Date("2026-11-01T00:00:00Z");
  it(`dure ${RESERVE_DAYS} jours après la clôture`, () => {
    const a = { status: "annonce_close", dateExpiration: close };
    expect(reserveUntil(a)?.toISOString()).toBe(new Date(close.getTime() + RESERVE_DAYS * 86_400_000).toISOString());
    expect(isReserveOpen(a, new Date("2026-11-20T00:00:00Z"))).toBe(true);
    expect(isReserveOpen(a, new Date("2026-12-02T00:00:00Z"))).toBe(false);
  });
  it("n'existe que sur une annonce close", () => {
    expect(isReserveOpen({ status: "publiee", dateExpiration: close }, close)).toBe(false);
  });
});

describe("favoritesAvailable (Changer ce prestataire)", () => {
  it("exige au moins un favori", () => {
    expect(favoritesAvailable({ annonceStatus: "publiee", reserveOpen: false, favoris: 0 })).toBe(false);
    expect(favoritesAvailable({ annonceStatus: "publiee", reserveOpen: false, favoris: 1 })).toBe(true);
  });
  it("après la clôture, seulement tant que la réserve court", () => {
    expect(favoritesAvailable({ annonceStatus: "annonce_close", reserveOpen: true, favoris: 2 })).toBe(true);
    expect(favoritesAvailable({ annonceStatus: "annonce_close", reserveOpen: false, favoris: 2 })).toBe(false);
  });
});
