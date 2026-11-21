/**
 * Preuves de CONSTAT du CLIENT (maquette Flexwork-Modal-Client-Validation-Preuve.html,
 * section « Vos preuves de constat ») — pendant CLIENT des preuves de livrable du
 * prestataire : ce que le client a lui-même relevé sur site pour étayer le taux d'exécution
 * qu'il constate, plutôt que de constater "à l'aveugle" sur les seules preuves de l'autre
 * partie.
 *
 * Stockées dans MissionAttachment (même table, même stockage signé que les preuves du
 * prestataire) mais sous des catégories PRÉFIXÉES `constat_` : les deux jeux de preuves ne
 * doivent jamais se mélanger — les listes de livrable (GET .../deliverable et
 * GET .../jalons/[jalonId]/attachments) les excluent explicitement, et l'appréciation
 * (validee/rejetee) ne s'applique qu'aux preuves du prestataire.
 */

// Les 4 onglets de la modale « Ajouter vos preuves de constat » (Photos / Vidéos /
// Documents / Géoloc), dans cet ordre.
export const CONSTAT_CATEGORIES = [
  "constat_photo",
  "constat_video",
  "constat_document",
  "constat_geolocation",
] as const;

export type ConstatCategory = (typeof CONSTAT_CATEGORIES)[number];

export function isConstatCategory(category: string | null | undefined): category is ConstatCategory {
  return typeof category === "string" && (CONSTAT_CATEGORIES as readonly string[]).includes(category);
}

// Catégorie texte-seule (pas de fichier attendu) — même règle que `geolocation` côté
// prestataire : l'information vit dans `note` ("lat,lng" capturé via navigator.geolocation).
export function isConstatTextOnly(category: ConstatCategory): boolean {
  return category === "constat_geolocation";
}
