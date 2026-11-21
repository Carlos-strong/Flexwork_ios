// Complétion du profil client (2026-09-23).
//
// Fonction pure — aucun accès base, pour que le calcul soit testable seul et identique
// partout où il est affiché (dashboard, page profil). Le serveur est la seule source du
// pourcentage : l'UI ne le recalcule jamais de son côté.
//
// Deux règles qui gouvernent ce calcul :
//
//  1. On ne compte QUE des champs qu'un client peut encore remplir. `currency` a une
//     valeur par défaut (XOF) et n'est donc jamais vide : la compter reviendrait à offrir
//     un point gratuit. Elle est hors barème.
//
//  2. Le dénominateur est variable. Un particulier n'a ni organisation ni secteur
//     d'activité : ces deux items sortent du barème au lieu de le plafonner à 80 %. Un
//     profil complet affiche 100 % quel que soit le type de client.
//
// Un compte neuf sort de l'inscription à 3/8 (38 %) : identité, contact et localisation
// sont déjà renseignés par le formulaire d'inscription, le reste est à faire.

export type ClientProfileCompletionItem = {
  key: string;
  label: string;
  done: boolean;
};

export type ClientProfileCompletion = {
  percent: number;
  done: number;
  total: number;
  items: ClientProfileCompletionItem[];
  missing: ClientProfileCompletionItem[];
};

export type ClientProfileCompletionInput = {
  // Porté par User — commun aux deux rôles, jamais dupliqué dans ClientProfile.
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  tel?: string | null;
  country?: string | null;
  city?: string | null;
  avatarPath?: string | null;
  address?: string | null;
  // Porté par ClientProfile.
  profession?: string | null;
  clientType?: string | null;
  company?: string | null;
  sector?: string | null;
  languages?: string[] | null;
};

const filled = (value?: string | null) => typeof value === "string" && value.trim().length > 0;

export function computeClientProfileCompletion(
  input: ClientProfileCompletionInput,
): ClientProfileCompletion {
  // Une organisation est attendue dès que le client n'agit pas en son nom propre. Tant que
  // le type n'est pas choisi, on reste sur le barème de base : on ne réclame pas des
  // champs dont on ignore encore s'ils s'appliquent.
  const hasOrganisation =
    input.clientType === "entreprise" ||
    input.clientType === "association" ||
    input.clientType === "administration";

  const items: ClientProfileCompletionItem[] = [
    { key: "identite", label: "Nom et prénom", done: filled(input.firstname) && filled(input.lastname) },
    { key: "contact", label: "Email et téléphone", done: filled(input.email) && filled(input.tel) },
    { key: "localisation", label: "Pays et ville", done: filled(input.country) && filled(input.city) },
    { key: "photo", label: "Photo de profil", done: filled(input.avatarPath) },
    { key: "adresse", label: "Adresse complète", done: filled(input.address) },
    { key: "profession", label: "Profession", done: filled(input.profession) },
    { key: "type_client", label: "Type de client", done: filled(input.clientType) },
    { key: "langues", label: "Langues", done: (input.languages?.length ?? 0) > 0 },
  ];

  if (hasOrganisation) {
    items.push(
      { key: "organisation", label: "Organisation", done: filled(input.company) },
      { key: "secteur", label: "Secteur d'activité", done: filled(input.sector) },
    );
  }

  const done = items.filter((item) => item.done).length;
  const total = items.length;

  return {
    percent: Math.round((done / total) * 100),
    done,
    total,
    items,
    missing: items.filter((item) => !item.done),
  };
}
