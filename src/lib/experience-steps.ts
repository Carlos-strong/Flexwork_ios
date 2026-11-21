// Parcours en étapes de l'onglet « Expérience » du profil prestataire (2026-11-09).
//
// Les rubriques de l'onglet (niveau, expériences, diplômes, portfolio, garants) se remplissent
// l'une après l'autre, chacune validée avant la suivante, jusqu'à une étape finale de
// validation. Les règles « obligatoire / fait » sont celles du barème serveur
// (src/lib/provider-profile-completion.ts — années + ≥ 1 expérience + ≥ 1 diplôme) et des
// garants (src/lib/garant-rules.ts) : l'onglet ne se dit complet que si le serveur le compte.

import { hasRequiredGarants } from "@/lib/garant-rules";

export type ExperienceStepKey = "niveau" | "experiences" | "diplomes" | "portfolio" | "garants" | "validation";

export type ExperienceStep = {
  key: ExperienceStepKey;
  label: string;
  /** Bloque la suite tant qu'elle n'est pas faite. */
  required: boolean;
  done: boolean;
  /** Ce qui manque, en une phrase — affiché sous l'étape et dans la validation. */
  missing?: string;
};

export type ExperienceStepsInput = {
  declaredLevel?: string | null;
  declaredExperienceYears?: number | null;
  experiencesCount: number;
  diplomasCount: number;
  portfolioCount: number;
  hasCv: boolean;
  garants: { obligatoire: boolean }[];
  /** Exigence de garant activée par l'Admin KYC pour ce compte. */
  garantRequired: boolean;
  /** Faux dans la vue « profil complet », où le portfolio est une rubrique à part. */
  showPortfolio: boolean;
};

export function experienceSteps(input: ExperienceStepsInput): ExperienceStep[] {
  const levelDone = !!input.declaredLevel;
  // `0` est une réponse valide (débutant) : on teste la présence, pas la valeur.
  const yearsDone = typeof input.declaredExperienceYears === "number" && input.declaredExperienceYears >= 0;
  const garantsOk = input.garantRequired ? hasRequiredGarants(input.garants) : true;

  const steps: ExperienceStep[] = [
    {
      key: "niveau",
      label: "Niveau",
      required: true,
      done: levelDone && yearsDone,
      missing: !levelDone
        ? "Choisissez votre niveau professionnel."
        : !yearsDone
          ? "Indiquez vos années d'expérience (0 si vous débutez)."
          : undefined,
    },
    {
      key: "experiences",
      label: "Expériences",
      required: true,
      done: input.experiencesCount > 0,
      missing: input.experiencesCount > 0 ? undefined : "Déclarez au moins une expérience professionnelle.",
    },
    {
      key: "diplomes",
      label: "Diplômes",
      required: true,
      done: input.diplomasCount > 0,
      missing: input.diplomasCount > 0 ? undefined : "Déclarez au moins un diplôme ou une certification.",
    },
  ];
  if (input.showPortfolio) {
    steps.push({ key: "portfolio", label: "Portfolio et CV", required: false, done: input.portfolioCount > 0 || input.hasCv });
  }
  steps.push({
    key: "garants",
    label: "Garants",
    required: input.garantRequired,
    done: input.garantRequired ? garantsOk : input.garants.length > 0,
    missing: garantsOk ? undefined : "Ajoutez un garant obligatoire : l'administration l'exige pour votre compte.",
  });
  steps.push({ key: "validation", label: "Validation", required: false, done: isSectionComplete(steps) });
  return steps;
}

/** Toutes les étapes obligatoires sont faites. */
export function isSectionComplete(steps: ExperienceStep[]): boolean {
  return steps.filter((s) => s.key !== "validation").every((s) => !s.required || s.done);
}

/** Une étape est atteignable si toutes les étapes OBLIGATOIRES qui la précèdent sont faites. */
export function canReachStep(steps: ExperienceStep[], key: ExperienceStepKey): boolean {
  const index = steps.findIndex((s) => s.key === key);
  return index >= 0 && steps.slice(0, index).every((s) => !s.required || s.done);
}

/** Étape où reprendre : la première obligatoire non faite, sinon la validation. */
export function resumeStep(steps: ExperienceStep[]): ExperienceStepKey {
  return steps.find((s) => s.required && !s.done)?.key ?? "validation";
}

/** Années d'expérience saisies : entier de 0 à 60, sinon un message d'erreur. */
export function validateYears(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  if (raw.trim() === "") return { ok: false, message: "Indiquez vos années d'expérience (0 si vous débutez)." };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 60) return { ok: false, message: "Les années d'expérience vont de 0 à 60." };
  return { ok: true, value: n };
}
