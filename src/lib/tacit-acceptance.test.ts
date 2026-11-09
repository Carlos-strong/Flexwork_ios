/**
 * Règle du délai d'acceptation tacite — fonctions PURES (2026-09-14).
 *
 * Testées seules, sans base : ce sont elles qui décident qu'un paiement part sans geste du
 * client. Les cas limites comptent donc davantage que le cas nominal — une borne mal posée
 * libère de l'argent trop tôt, une valeur ambiguë mal interprétée en libère sans aucun délai.
 */

import { describe, expect, it } from "vitest";
import { isTacitlyAccepted, tacitAcceptanceDeadline } from "@/lib/tacit-acceptance";

const T0 = new Date("2026-09-01T12:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

describe("tacitAcceptanceDeadline", () => {
  it("ajoute exactement le nombre de jours du contrat", () => {
    expect(tacitAcceptanceDeadline(T0, 7).toISOString()).toBe("2026-09-08T12:00:00.000Z");
  });
});

describe("isTacitlyAccepted", () => {
  it("avant l'échéance, le client garde la main", () => {
    expect(isTacitlyAccepted(T0, 7, days(6))).toBe(false);
  });

  it("après l'échéance, le silence vaut acceptation", () => {
    expect(isTacitlyAccepted(T0, 7, days(8))).toBe(true);
  });

  it("À l'instant EXACT de l'échéance, le délai n'est pas encore écoulé", () => {
    // Borne stricte : le client a jusqu'au bout de son délai, pas une milliseconde de moins.
    expect(isTacitlyAccepted(T0, 7, days(7))).toBe(false);
    expect(isTacitlyAccepted(T0, 7, new Date(days(7).getTime() + 1))).toBe(true);
  });

  it("sans date de soumission, jamais d'acceptation tacite", () => {
    // Cas d'un livrable antérieur à l'introduction de `submittedAt` : aucune date à laquelle
    // accrocher le délai, donc aucune libération automatique. Le client garde la main.
    expect(isTacitlyAccepted(null, 7, days(365))).toBe(false);
  });

  it("un délai nul ou négatif DÉSACTIVE la règle au lieu de la déclencher aussitôt", () => {
    // Le sens le moins dangereux de la seule valeur ambiguë : un contrat mal renseigné laisse
    // la main au client, il ne paie jamais sans délai.
    expect(isTacitlyAccepted(T0, 0, days(365))).toBe(false);
    expect(isTacitlyAccepted(T0, -7, days(365))).toBe(false);
  });

  it("un délai non fini est refusé plutôt que propagé en date invalide", () => {
    expect(isTacitlyAccepted(T0, Number.NaN, days(365))).toBe(false);
    expect(isTacitlyAccepted(T0, Number.POSITIVE_INFINITY, days(365))).toBe(false);
  });

  it("un délai long repousse d'autant", () => {
    expect(isTacitlyAccepted(T0, 30, days(29))).toBe(false);
    expect(isTacitlyAccepted(T0, 30, days(31))).toBe(true);
  });
});
