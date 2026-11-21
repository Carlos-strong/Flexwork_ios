import { describe, expect, it } from "vitest";
import { canReachStep, experienceSteps, isSectionComplete, resumeStep, validateYears, type ExperienceStepsInput } from "@/lib/experience-steps";

// Parcours en étapes de l'onglet « Expérience » (2026-11-09).
const base: ExperienceStepsInput = {
  declaredLevel: null,
  declaredExperienceYears: null,
  experiencesCount: 0,
  diplomasCount: 0,
  portfolioCount: 0,
  hasCv: false,
  garants: [],
  garantRequired: false,
  showPortfolio: true,
};
const keys = (i: ExperienceStepsInput) => experienceSteps(i).map((s) => s.key);
const stepOf = (i: ExperienceStepsInput, k: string) => experienceSteps(i).find((s) => s.key === k)!;

describe("étapes de l'onglet Expérience", () => {
  it("ordre des étapes ; sans portfolio dans la vue « profil complet »", () => {
    expect(keys(base)).toEqual(["niveau", "experiences", "diplomes", "portfolio", "garants", "validation"]);
    expect(keys({ ...base, showPortfolio: false })).toEqual(["niveau", "experiences", "diplomes", "garants", "validation"]);
  });

  it("niveau : il faut le niveau ET les années — 0 an (débutant) compte", () => {
    expect(stepOf({ ...base, declaredLevel: "confirme" }, "niveau")).toMatchObject({ done: false, missing: expect.stringContaining("années") });
    expect(stepOf({ ...base, declaredExperienceYears: 3 }, "niveau")).toMatchObject({ done: false, missing: expect.stringContaining("niveau") });
    expect(stepOf({ ...base, declaredLevel: "debutant", declaredExperienceYears: 0 }, "niveau").done).toBe(true);
  });

  it("expériences et diplômes obligatoires ; portfolio facultatif", () => {
    expect(stepOf(base, "experiences")).toMatchObject({ required: true, done: false });
    expect(stepOf({ ...base, experiencesCount: 1 }, "experiences").done).toBe(true);
    expect(stepOf({ ...base, diplomasCount: 2 }, "diplomes").done).toBe(true);
    expect(stepOf(base, "portfolio")).toMatchObject({ required: false, done: false });
    expect(stepOf({ ...base, hasCv: true }, "portfolio").done).toBe(true);
  });

  it("garants : obligatoires seulement si l'administration l'exige", () => {
    expect(stepOf(base, "garants").required).toBe(false);
    expect(stepOf({ ...base, garantRequired: true }, "garants")).toMatchObject({ required: true, done: false });
    expect(stepOf({ ...base, garantRequired: true, garants: [{ obligatoire: false }] }, "garants").done).toBe(false);
    expect(stepOf({ ...base, garantRequired: true, garants: [{ obligatoire: true }] }, "garants").done).toBe(true);
  });

  it("on n'avance pas au-delà d'une étape obligatoire non faite ; on revient toujours en arrière", () => {
    const s = experienceSteps({ ...base, declaredLevel: "confirme", declaredExperienceYears: 4 });
    expect(canReachStep(s, "niveau")).toBe(true);
    expect(canReachStep(s, "experiences")).toBe(true);
    expect(canReachStep(s, "diplomes")).toBe(false);
    expect(canReachStep(s, "validation")).toBe(false);
  });

  it("reprise à la première étape obligatoire non faite, sinon à la validation", () => {
    expect(resumeStep(experienceSteps(base))).toBe("niveau");
    const filled = { ...base, declaredLevel: "confirme", declaredExperienceYears: 4, experiencesCount: 1 };
    expect(resumeStep(experienceSteps(filled))).toBe("diplomes");
    const complete = { ...filled, diplomasCount: 1 };
    expect(resumeStep(experienceSteps(complete))).toBe("validation");
    // Les étapes facultatives (portfolio, garants non exigés) ne bloquent pas la validation.
    expect(isSectionComplete(experienceSteps(complete))).toBe(true);
    expect(isSectionComplete(experienceSteps({ ...complete, garantRequired: true }))).toBe(false);
  });

  it("années d'expérience : entier de 0 à 60", () => {
    expect(validateYears("")).toMatchObject({ ok: false });
    expect(validateYears("0")).toEqual({ ok: true, value: 0 });
    expect(validateYears("12")).toEqual({ ok: true, value: 12 });
    expect(validateYears("61")).toMatchObject({ ok: false });
    expect(validateYears("2.5")).toMatchObject({ ok: false });
    expect(validateYears("-1")).toMatchObject({ ok: false });
  });
});
