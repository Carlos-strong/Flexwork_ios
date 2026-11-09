// Brouillon local du tunnel de création de mission (2026-09-23).
//
// Même principe et même garde-fous que `devis-draft.ts` / `proposal-draft.ts`, dont ce module
// reprend la forme : le tunnel compte quatre étapes, et perdre la saisie parce qu'un onglet
// s'est fermé entre l'étape 2 et l'étape 3 serait le défaut le plus coûteux du parcours.
//
// C'est un CONFORT, jamais une garantie : le stockage peut être plein, désactivé ou en
// navigation privée. Toute lecture comme toute écriture est donc protégée, et un échec est
// silencieux — on ne bloque jamais la création d'une mission pour un brouillon.
//
// À ne pas confondre avec le brouillon SERVEUR (`Mission.status = "brouillon"`), qui est une
// mission réellement créée. Celui-ci ne vit que dans le navigateur, avant toute création.

const KEY = "flexwork:mission-draft";

// Durée au-delà de laquelle un brouillon n'est plus proposé : revenir trois semaines plus
// tard sur une saisie oubliée crée plus de confusion qu'il n'en épargne.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type MissionDraft = {
  step: number;
  // Rattache les pièces jointes déjà déposées (MissionDraftAttachment.draftId) — restauré
  // avec le reste pour qu'un retour après fermeture d'onglet retrouve ses fichiers.
  draftId: string;
  titre: string;
  description: string;
  cahierDesCharges: string;
  categorieId: string;
  categorieLabel: string;
  metierId: string;
  metierLabel: string;
  competences: string[];
  // Déduit de la catégorie (2026-09-28), gardé pour le récapitulatif ; absent des brouillons
  // plus anciens.
  secteurLabel?: string;
  secteur?: string | null;
  // La catégorie autorisait-elle la vérification OPR au moment du brouillon (2026-10-01) ?
  allowsOprVerification?: boolean;
  professionalType: string;
  level: string;
  maxCandidatures: string;
  urgent: boolean;
  pays: string;
  ville: string;
  quartier: string;
  mode: string;
  dateDebut: string;
  delaiJours: string;
  materiel: string;
  budgetType: string;
  financingModeKey: string;
  amount: string;
  budgetMin: string;
  budgetMax: string;
  timeRate: string;
  timeMaxQuantity: string;
  // Mode de pointage d'une mission au temps (2026-10-01) — optionnel pour relire les anciens
  // brouillons ; vide = pas encore choisi.
  attendanceValidation?: "" | "totale" | "partielle";
  // Vérification / validation (2026-10-01) — optionnels pour relire les anciens brouillons.
  validationMode?: "" | "client" | "opr";
  siteManagerIdentifier?: string;
  maxRevisionRounds: string;
  dateExpiration: string;
  currency: string;
  savedAt: string;
};

export function saveMissionDraft(draft: Omit<MissionDraft, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch {
    // Stockage indisponible : le tunnel continue de fonctionner sans brouillon.
  }
}

export function loadMissionDraft(): MissionDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as MissionDraft;
    if (!draft.savedAt || Date.now() - new Date(draft.savedAt).getTime() > MAX_AGE_MS) {
      clearMissionDraft();
      return null;
    }
    return draft;
  } catch {
    // Brouillon illisible (format changé, stockage corrompu) : on repart d'un formulaire
    // vide plutôt que de faire planter la page.
    return null;
  }
}

export function clearMissionDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Sans conséquence : un brouillon résiduel expirera de lui-même.
  }
}
