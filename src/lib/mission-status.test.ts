/**
 * La table d'affichage des statuts doit couvrir l'enum RÉEL (16/09/2026).
 *
 * `remboursee` manquait à `MISSION_STATUSES` et à `MISSION_STATUS_STYLE` depuis sa création.
 * Comme chaque appelant écrit `MISSION_STATUS_STYLE[m.status] ?? MISSION_STATUS_STYLE.brouillon`,
 * rien ne plantait : une mission remboursée s'affichait simplement « Brouillon », partout. Un
 * repli silencieux ne se remarque pas — c'est pourquoi le contrôle se fait ici, contre la source
 * de vérité (l'enum généré par Prisma) et non contre une liste recopiée à la main.
 */

import { describe, expect, it } from "vitest";
import { MissionStatus } from "@prisma/client";
import {
  MISSION_STATUSES,
  MISSION_STATUS_STYLE,
  missionEscrowStatusLabel,
  type MissionStatusValue,
} from "@/lib/mission-status";

const REELS = Object.values(MissionStatus) as string[];

describe("MISSION_STATUSES / MISSION_STATUS_STYLE face à l'enum Prisma", () => {
  it("couvre chaque valeur de l'enum, sans en inventer aucune", () => {
    expect([...MISSION_STATUSES].sort()).toEqual([...REELS].sort());
  });

  it("chaque statut a un style ET un libellé non vide", () => {
    for (const statut of REELS) {
      const style = MISSION_STATUS_STYLE[statut as MissionStatusValue];
      expect(style, `aucun style pour « ${statut} » — il s'afficherait « Brouillon »`).toBeDefined();
      expect(style.label.trim().length, `libellé vide pour « ${statut} »`).toBeGreaterThan(0);
      expect(style.bg && style.text && style.dot, `style incomplet pour « ${statut} »`).toBeTruthy();
    }
  });

  it("aucun libellé n'est partagé par deux statuts — sinon deux états seraient indistinguables", () => {
    const libelles = REELS.map((s) => MISSION_STATUS_STYLE[s as MissionStatusValue].label);
    expect(new Set(libelles).size).toBe(libelles.length);
  });

  it("une mission remboursée ne se lit ni « Brouillon » ni « Terminée »", () => {
    // Le schéma fait de `remboursee` un état À PART pour qu'un abandon ne passe pas pour une
    // réussite. Confondre son libellé avec celui de `cloturee` annulerait cette distinction.
    const remboursee = MISSION_STATUS_STYLE.remboursee;
    expect(remboursee.label).toBe("Remboursée");
    expect(remboursee.label).not.toBe(MISSION_STATUS_STYLE.brouillon.label);
    expect(remboursee.label).not.toBe(MISSION_STATUS_STYLE.cloturee.label);
  });
});

/**
 * L'écran de validation client garde ses propres libellés d'ACTION pour les trois états où le
 * client a quelque chose à faire, mais son repli ne doit plus laisser fuir la valeur brute de
 * l'enum : « remboursee » s'affichait tel quel sur la carte de mission.
 */
describe("libellé de statut sur l'écran de validation client", () => {
  it("garde les libellés d'action sur les trois états concernés", () => {
    expect(missionEscrowStatusLabel("livrable_soumis")).toBe("À valider");
    expect(missionEscrowStatusLabel("fonds_sous_sequestre")).toBe("Financé — en attente du prestataire");
    expect(missionEscrowStatusLabel("en_cours")).toBe("Financé — en attente du prestataire");
  });

  it("retombe sur le libellé partagé — jamais sur la valeur brute — pour tous les autres", () => {
    for (const statut of REELS) {
      const libelle = missionEscrowStatusLabel(statut);
      expect(libelle, `« ${statut} » fuit en clair à l'écran`).not.toBe(statut);
    }
    expect(missionEscrowStatusLabel("remboursee")).toBe("Remboursée");
    expect(missionEscrowStatusLabel("cloturee")).toBe("Terminée");
  });
});
