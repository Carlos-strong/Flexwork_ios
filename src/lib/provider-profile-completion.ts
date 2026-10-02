// Complétion du profil prestataire (2026-09-23) — pendant de
// `client-profile-completion.ts`, dont il reprend les deux règles de fond.
//
// Fonction PURE, sans accès base : le pourcentage affiché sur le tableau de bord et celui
// affiché en tête du formulaire doivent être le même chiffre. Deux calculs parallèles
// finiraient par diverger, et l'utilisateur verrait « 40 % » à un endroit et « 45 % » à
// l'autre sans comprendre pourquoi.
//
// ── Le barème est celui arbitré, pas un barème inventé ───────────────────────────────────
//
//   Présentation   20 %   type + photo + titre + bio
//   Domaines       30 %   métier + ≥ 3 compétences
//   Expérience     20 %   années + ≥ 1 expérience + ≥ 1 diplôme
//   Localisation   15 %   pays + ville + rayon + disponibilité
//   Configuration  15 %   unité de tarif
//
// Une section vaut son poids ENTIER ou rien : c'est ce qui rend la « Répartition » lisible
// (« 20 % ✅ / 30 % ⬜ »). Un score au prorata à l'intérieur des sections afficherait 7 %
// après avoir saisi un seul champ, un progrès que l'utilisateur ne peut pas relier à un acte.
//
// ── Deux écarts assumés par rapport au tableau d'origine ────────────────────────────────
//
//  1. `currency` est HORS barème. Elle a une valeur par défaut (XOF) : la compter offrirait
//     3 % gratuits à un compte qui n'a rien saisi, exactement le point gratuit que le barème
//     client refuse. C'est donc l'unité de tarif qui tranche la section Configuration.
//
//  2. La CATÉGORIE (BTP, Services…) n'est pas exigée : elle n'est pas persistée. Seul le
//     libellé du métier l'est (`Profile.mainDomain`), parce que c'est la clé que
//     `domain-match` compare à `Mission.domaine`. Réclamer une valeur que le formulaire
//     n'enregistre nulle part rendrait la section impossible à valider.
//
// ── Ce que ce pourcentage n'est PAS ─────────────────────────────────────────────────────
//
// Il n'ouvre et ne ferme aucun droit (§9 : seul le KYC conditionne des actions précises). Un
// prestataire à 40 % peut candidater dès que son identité est vérifiée ; le pourcentage ne
// fait que dire ce qui manque pour être recommandé sur des missions pertinentes.

export type ProviderCompletionItem = {
  key: string;
  label: string;
  done: boolean;
};

export type ProviderCompletionSection = {
  key: "presentation" | "domaines" | "experience" | "localisation" | "configuration";
  label: string;
  weight: number;
  done: boolean;
  items: ProviderCompletionItem[];
};

export type ProviderProfileCompletion = {
  percent: number;
  /** Nombre de sections complètes — le « x/y » de la carte de tableau de bord. */
  done: number;
  total: number;
  sections: ProviderCompletionSection[];
  /** Critères manquants, à plat, pour la ligne « il reste à renseigner : … ». */
  missing: string[];
};

export type ProviderProfileCompletionInput = {
  // Onglet 1 — Présentation.
  providerKind?: string | null;
  avatarPath?: string | null;
  title?: string | null;
  description?: string | null;
  // Onglet 2 — Domaines.
  mainDomain?: string | null;
  tags?: string[] | null;
  // Onglet 3 — Expérience (les deux derniers viennent des déclarations, pas du profil).
  declaredExperienceYears?: number | null;
  experiencesCount?: number;
  diplomasCount?: number;
  // Onglet 4 — Localisation.
  zonePays?: string | null;
  zoneVille?: string | null;
  zoneRayonKm?: number | null;
  availability?: string | null;
  // Onglet 5 — Configuration.
  tarifUnite?: string | null;
};

/** Nombre minimal de compétences attendu pour que l'onglet Domaines soit réputé complet. */
export const MIN_COMPETENCES = 3;

const MIN_BIO_CHARS = 40;

const filled = (value?: string | null) => typeof value === "string" && value.trim().length > 0;

export function computeProviderProfileCompletion(
  input: ProviderProfileCompletionInput,
): ProviderProfileCompletion {
  const bio = typeof input.description === "string" ? input.description.trim() : "";

  const sections: ProviderCompletionSection[] = [
    {
      key: "presentation",
      label: "Présentation",
      weight: 20,
      done: false,
      items: [
        { key: "type_prestataire", label: "Type de prestataire", done: filled(input.providerKind) },
        { key: "photo", label: "Photo de profil", done: filled(input.avatarPath) },
        { key: "titre", label: "Titre professionnel", done: filled(input.title) },
        // La bio est comptée À PARTIR de 40 caractères : « Bonjour » n'est pas une
        // présentation, et valider la section sur un mot vide ferait perdre au pourcentage
        // ce qu'il a de crédible.
        { key: "bio", label: "Bio courte", done: bio.length >= MIN_BIO_CHARS },
      ],
    },
    {
      key: "domaines",
      label: "Domaines",
      weight: 30,
      done: false,
      items: [
        { key: "metier", label: "Métier principal", done: filled(input.mainDomain) },
        // La « Spécialité » a été retirée du barème (2026-09-23) : c'était un texte libre qui
        // redisait le métier sous une autre forme, en concurrence avec les compétences — que
        // le catalogue décrit, lui, précisément. Les compétences portent désormais seules la
        // précision du métier, et la section n'exige plus que le métier et ces compétences.
        {
          key: "competences",
          label: `Au moins ${MIN_COMPETENCES} compétences`,
          done: (input.tags?.filter((t) => filled(t)).length ?? 0) >= MIN_COMPETENCES,
        },
      ],
    },
    {
      key: "experience",
      label: "Expérience",
      weight: 20,
      done: false,
      items: [
        // `0` est une réponse valide (« débutant ») : on teste la présence de la valeur, pas
        // sa véracité. Exiger un nombre strictement positif exclurait les profils débutants
        // que la plateforme accepte explicitement (ProfessionalLevel.debutant).
        {
          key: "annees",
          label: "Années d'expérience",
          done: typeof input.declaredExperienceYears === "number" && input.declaredExperienceYears >= 0,
        },
        { key: "experience_1", label: "Au moins une expérience déclarée", done: (input.experiencesCount ?? 0) > 0 },
        { key: "diplome_1", label: "Au moins un diplôme déclaré", done: (input.diplomasCount ?? 0) > 0 },
      ],
    },
    {
      key: "localisation",
      label: "Localisation",
      weight: 15,
      done: false,
      items: [
        { key: "zonePays", label: "Pays d'intervention", done: filled(input.zonePays) },
        { key: "zoneVille", label: "Ville", done: filled(input.zoneVille) },
        // `zoneRayonKm` à 0 est refusé par le schéma (positive) et signifierait de toute
        // façon « aucun déplacement » : on exige une valeur strictement positive.
        {
          key: "zoneRayonKm",
          label: "Rayon d'intervention",
          done: typeof input.zoneRayonKm === "number" && input.zoneRayonKm > 0,
        },
        { key: "disponibilite", label: "Disponibilité", done: filled(input.availability) },
      ],
    },
    {
      key: "configuration",
      label: "Configuration",
      weight: 15,
      done: false,
      items: [{ key: "tarifUnite", label: "Unité de tarif", done: filled(input.tarifUnite) }],
    },
  ];

  for (const section of sections) {
    section.done = section.items.every((item) => item.done);
  }

  // Le pourcentage est la SOMME DES POIDS des sections complètes, pas un ratio de critères :
  // c'est la lecture du barème arbitré (« Répartition : Présentation 20 %, Domaines 30 %… »).
  const percent = sections.reduce((sum, s) => (s.done ? sum + s.weight : sum), 0);

  return {
    percent,
    done: sections.filter((s) => s.done).length,
    total: sections.length,
    sections,
    missing: sections.flatMap((s) => s.items.filter((i) => !i.done).map((i) => i.label)),
  };
}
