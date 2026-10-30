// Options du formulaire prestataire (2026-09-23) — source unique des listes déroulantes,
// partagée par l'écran et par la validation serveur.
//
// Les recopier de part et d'autre (une liste dans le composant, un `z.enum` dans la route)
// produit exactement la panne qu'on cherche à éviter : l'écran propose une valeur que le
// serveur refuse, ou l'inverse. Ici l'`enum` zod est DÉRIVÉ de la liste, pas réécrit.
//
// Ces options sont toutes DÉCLARATIVES : aucune ne conditionne un droit (§9 — seul le KYC
// conditionne des actions précises).

import type { UserRole } from "@prisma/client";

export type Option<T extends string = string> = { value: T; label: string };

// ── Filières prestataire ──────────────────────────────────────────────────────────────────
// Cette liste était recopiée à l'IDENTIQUE dans six fichiers (recherche de prestataires,
// avatar public, profil public, inscription, prestataires mis en avant, statistiques de
// plateforme). Six copies, c'est six endroits à corriger le jour où une filière s'ajoute —
// et cinq qui l'oublieront. Elle vit ici, avec les options du formulaire dont elle est le
// pendant (le type `providerType` choisi à l'activation est l'une de ces valeurs).
//
// `responsable_chantier` n'en fait PAS partie : ce n'est pas un prestataire, il ne candidate
// pas, ne soumet pas de devis et n'a pas de wallet (voir UserRole dans le schéma).
//
// ⚠️ SOURDINE (2026-09-23) : ce rôle n'est plus proposé à l'inscription — le formulaire ne
// demande plus de rôle du tout (décision « Option C »). Le rôle, les API qui le concernent
// (POST /api/missions/[id]/site-manager, constat de présence) et son écran restent intacts :
// il sera sollicité PAR API quand un client le désignera sur un contrat, ce qui est la
// condition réelle de son implication. Son modèle d'inscription propre reste à construire.
export const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Valeurs littérales de filière, pour les écrans et les routes qui n'acceptent que celles-là.
export const PROVIDER_ROLE_VALUES = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"] as const;

export function isProviderRole(role: string): boolean {
  return (PROVIDER_ROLES as string[]).includes(role);
}

// Libellés des filières (2026-09-24). SOURCE UNIQUE : ces libellés étaient recopiés dans une
// dizaine d'écrans (profil public, admin, recherche, contrat, tableaux de bord), ce qui rendait
// tout renommage incomplet et provisoire — il suffisait d'un écran oublié, puis d'une nouvelle
// copie. Les écrans importent désormais cette table.
//
// « Prestataire indépendant » remplace « Expert digital » et « Entreprise » remplace « Expert
// BTP / Autres » : les anciens noms portaient un MÉTIER (digital, BTP) alors que la filière
// décrit une FAÇON D'EXERCER. Les codes en base (`expert_digital`, `expert_btp_autres`) ne
// changent pas — décision d'affichage seulement, pour ne rien migrer ni risquer sur les
// comptes existants.
//
// ⚠️ Conséquence assumée : `expert_digital` reste la seule filière HORS barrière d'âge (A13).
// Le nom « Expert digital » la limitait de fait au travail à distance ; « Prestataire
// indépendant » ne dit plus quel travail elle couvre, et un électricien qui s'y déclarerait
// échapperait au contrôle d'âge. Point arbitré et laissé en l'état — ne pas le « corriger »
// sans redemander.
export const PROVIDER_ROLE_LABELS: Record<string, string> = {
  expert_digital: "Prestataire indépendant",
  expert_btp_autres: "Entreprise",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
};

// Type professionnel visé par une MISSION (`Mission.professionalType`) — mêmes quatre
// catégories que les filières, en MAJUSCULES. Libellés alignés sur ceux ci-dessus : le client
// qui choisit une cible de mission et le prestataire qui choisit sa filière doivent lire les
// mêmes mots, sinon la mise en relation paraît oppose des catégories différentes.
export const PROFESSIONAL_TYPE_LABELS: Record<string, string> = {
  EXPERT_DIGITAL: "Prestataire indépendant",
  EXPERT_BTP: "Entreprise",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

// ── Onglet 1 — Présentation ───────────────────────────────────────────────────────────────
// Forme juridique déclarée. Distincte de `UserRole`, qui porte la FILIÈRE (celle qui décide
// des missions proposées) : une entreprise de plomberie reste un artisan au sens de la
// filière, et se déclare « entreprise » au sens juridique.
// Toutes les listes de valeurs sont déclarées `as const` : `z.enum()` dérive d'elles des
// unions LITTÉRALES (« independant » | « entreprise » | …), qui sont les seules acceptées par
// les colonnes d'énumération Prisma. Une liste typée `string[]` compilerait mais produirait un
// `string` que Prisma refuserait à l'assignation.
export const PROVIDER_KIND_VALUES = ["independant", "entreprise", "artisan", "manoeuvre"] as const;
export const PROVIDER_KINDS: Option[] = [
  { value: "independant", label: "Indépendant / Particulier" },
  { value: "entreprise", label: "Entreprise" },
  { value: "artisan", label: "Artisan" },
  { value: "manoeuvre", label: "Manœuvre" },
];
export const PROVIDER_KIND_LABELS: Record<string, string> = Object.fromEntries(
  PROVIDER_KINDS.map((o) => [o.value, o.label]),
);

// ── Onglet 4 — Localisation ───────────────────────────────────────────────────────────────
// Valeurs ALIGNÉES sur `Mission.mode` (presentiel | distance | hybride) : le filtre
// « ce prestataire peut-il prendre cette mission » se lit alors sans table de correspondance.
export const WORK_MODE_VALUES = ["presentiel", "distance", "hybride"] as const;
export const WORK_MODES: Option[] = [
  { value: "presentiel", label: "Présentiel" },
  { value: "distance", label: "À distance" },
  { value: "hybride", label: "Hybride" },
];

export const AVAILABILITY_VALUES = ["temps_plein", "temps_partiel", "ponctuel", "indisponible"] as const;
export const AVAILABILITIES: Option[] = [
  { value: "temps_plein", label: "Temps plein" },
  { value: "temps_partiel", label: "Temps partiel" },
  { value: "ponctuel", label: "Missions ponctuelles" },
  { value: "indisponible", label: "Indisponible" },
];
export const AVAILABILITY_LABELS: Record<string, string> = Object.fromEntries(
  AVAILABILITIES.map((o) => [o.value, o.label]),
);

// ── Moyens de déplacement (2026-09-23) ───────────────────────────────────────────────────
// Le modèle les demande dans l'onglet Localisation. Déclaratif : la plateforme ne les croise
// encore avec rien — ils servent au client qui lit le profil, et à rien d'autre tant qu'aucune
// règle ne s'appuie dessus.
export const DEPLACEMENT_VALUES = ["moto", "voiture", "pied"] as const;
export const DEPLACEMENTS: Option[] = [
  { value: "moto", label: "Moto" },
  { value: "voiture", label: "Voiture" },
  { value: "pied", label: "À pied" },
];

// ── Canal de contact préféré (2026-09-23) ────────────────────────────────────────────────
// « Via FlexWork uniquement » est la valeur par défaut du modèle, et la plus sûre : elle
// n'expose aucune coordonnée tant que le client n'est pas engagé. Les deux autres sont des
// préférences, pas des autorisations — aucun contact direct n'est ouvert par ce champ.
export const MODE_CONTACT_VALUES = ["flexwork", "email", "telephone"] as const;
export const MODE_CONTACTS: Option[] = [
  { value: "flexwork", label: "Via FlexWork uniquement" },
  { value: "email", label: "Email" },
  { value: "telephone", label: "Téléphone" },
];

// ── Onglet 5 — Configuration ──────────────────────────────────────────────────────────────
// L'unité de tarif. Le MONTANT reste facultatif : on peut répondre à une demande de devis
// sans tarif fixe (le formulaire le dit explicitement).
export const TARIF_UNITE_VALUES = ["heure", "jour", "semaine", "mois", "mission"] as const;
export const TARIF_UNITES: Option[] = [
  { value: "heure", label: "Heure" },
  { value: "jour", label: "Jour" },
  { value: "semaine", label: "Semaine" },
  { value: "mois", label: "Mois" },
  { value: "mission", label: "Mission" },
];

// Bornes de saisie partagées : l'écran limite la saisie, la route refuse au-delà. Une limite
// qui n'existe que dans le composant se contourne avec un POST direct.
// `MAX_OFFERED_SERVICES` a disparu avec la carte « Services proposés » (2026-09-23) : les
// services proposés étaient une seconde liste de compétences sous un autre nom, ils sont
// désormais réunis dans `tags`, sous le seul plafond MAX_COMPETENCES.
export const MAX_COMPETENCES = 10;
// Longueur d'UNE compétence. Le champ « Compétences proposées » la bornait seul (maxLength) :
// un POST direct pouvait enregistrer un libellé de plusieurs milliers de caractères, affiché
// tel quel sur les cartes et dans la recherche.
export const MAX_COMPETENCE_LENGTH = 120;
export const MAX_COVERAGE_ZONES = 10;
