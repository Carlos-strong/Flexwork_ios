import { describe, expect, it } from "vitest";
import { groupAnnonces, groupIsActive, groupIsClosed } from "./annonce-groups";

const m = (id: string, status: string, parentMissionId: string | null = null) => ({ id, status, parentMissionId });

describe("groupAnnonces", () => {
  it("rattache les engagements à leur annonce et n'affiche que le premier niveau", () => {
    const groups = groupAnnonces([m("site", "fonds_sous_sequestre"), m("clim", "publiee"), m("e1", "proposition_acceptee", "clim"), m("e2", "proposition_acceptee", "clim")]);
    expect(groups.map((g) => g.mission.id)).toEqual(["site", "clim"]);
    expect(groups[1].engagements.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(groups[0].engagements).toEqual([]);
  });
  it("garde un engagement orphelin plutôt que de le perdre", () => {
    expect(groupAnnonces([m("e1", "en_cours", "absente")]).map((g) => g.mission.id)).toEqual(["e1"]);
  });
});

describe("état d'un groupe", () => {
  it("une annonce encore publiée avec un engagement en cours est active", () => {
    expect(groupIsActive({ mission: m("a", "publiee"), engagements: [m("e", "contrat_signe", "a")] })).toBe(true);
    expect(groupIsActive({ mission: m("a", "publiee"), engagements: [] })).toBe(false);
  });
  it("terminée seulement si tout est clôturé", () => {
    expect(groupIsClosed({ mission: m("a", "cloturee"), engagements: [] })).toBe(true);
    expect(groupIsClosed({ mission: m("a", "annonce_close"), engagements: [m("e", "cloturee", "a")] })).toBe(true);
    expect(groupIsClosed({ mission: m("a", "annonce_close"), engagements: [m("e", "en_cours", "a")] })).toBe(false);
  });
});

describe("groupFilterTags", () => {
  it("annonce ouverte avec un engagement en cours : Publiées et En cours", async () => {
    const { groupFilterTags } = await import("./annonce-groups");
    expect(groupFilterTags({ mission: m("a", "publiee"), engagements: [m("e1", "proposition_acceptee", "a"), m("e2", "contrat_signe", "a")] }).sort()).toEqual(["En cours", "Publiées"]);
    expect(groupFilterTags({ mission: m("s", "fonds_sous_sequestre"), engagements: [] })).toEqual(["En cours"]);
    expect(groupFilterTags({ mission: m("s", "cloturee"), engagements: [] })).toEqual(["Terminées"]);
    expect(groupFilterTags({ mission: m("a", "annonce_close"), engagements: [m("e", "mediation_ouverte", "a")] })).toEqual(["En litige"]);
    expect(groupFilterTags({ mission: m("a", "publiee"), engagements: [] })).toEqual(["Publiées"]);
  });
});

describe("engagement annulé", () => {
  it("n'apparaît ni comme retenu ni comme mission", () => {
    const groups = groupAnnonces([m("clim", "publiee"), m("e1", "annulee", "clim"), m("e2", "contrat_genere", "clim")]);
    expect(groups.map((g) => g.mission.id)).toEqual(["clim"]);
    expect(groups[0].engagements.map((e) => e.id)).toEqual(["e2"]);
  });
});
