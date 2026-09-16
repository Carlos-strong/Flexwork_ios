/**
 * Une mission close ne se finance plus (16/09/2026).
 *
 * Défaut d'origine : la page contrat affichait « Procéder au paiement sous séquestre » sur une
 * mission déjà `cloturee`, et le serveur — contrairement au cas symétrique du prestataire, où le
 * HOLD était refusé — n'avait AUCUNE garde de statut. `hasInFlightHold` n'y suffisait pas : elle
 * ignore les HOLD `failed`, si bien qu'un financement refusé par le PSP suivi d'une clôture ou
 * d'un remboursement rouvrait la porte à un nouveau débit du client sur un dossier soldé.
 *
 * La règle est une seule liste (`MISSION_FUNDING_CLOSED_STATUSES`) lue par l'écran ET par le
 * serveur, précisément pour qu'ils ne puissent plus diverger.
 */

import { describe, expect, it } from "vitest";
import { MISSION_STATUSES } from "@/lib/mission-status";
import { MISSION_FUNDING_CLOSED_STATUSES, isMissionFundingClosed } from "@/lib/mission-status";

describe("isMissionFundingClosed", () => {
  it("ferme le financement sur une mission clôturée et sur une mission remboursée", () => {
    expect(isMissionFundingClosed("cloturee")).toBe(true);
    expect(isMissionFundingClosed("remboursee")).toBe(true);
    expect([...MISSION_FUNDING_CLOSED_STATUSES]).toEqual(["cloturee", "remboursee"]);
  });

  it("laisse passer TOUS les autres statuts du cycle — la règle ne ferme que la fin", () => {
    const encoreOuverts = MISSION_STATUSES.filter((s) => !isMissionFundingClosed(s));
    // `mediation_ouverte` en fait partie volontairement : un litige gèle les fonds, il ne
    // termine pas la mission — et une recharge peut rester nécessaire pendant l'arbitrage.
    expect(encoreOuverts).toContain("mediation_ouverte");
    expect(encoreOuverts).toContain("contrat_signe");
    expect(encoreOuverts).toContain("validee");
    expect(encoreOuverts).not.toContain("cloturee");
  });

  it("une absence de statut n'est pas une clôture — la page interroge avant d'avoir la réponse", () => {
    // `missionStatus` vaut null tant que GET /api/missions/[id] n'a pas répondu. Traiter ce
    // null comme « close » aurait fait clignoter le bouton hors de l'écran au chargement.
    expect(isMissionFundingClosed(null)).toBe(false);
    expect(isMissionFundingClosed(undefined)).toBe(false);
    expect(isMissionFundingClosed("")).toBe(false);
  });

  it("un statut inconnu ne ferme rien", () => {
    expect(isMissionFundingClosed("statut_inexistant")).toBe(false);
  });
});
