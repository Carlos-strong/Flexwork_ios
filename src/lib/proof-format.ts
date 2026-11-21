// Affichage des preuves de livraison (2026-11-09) — partagé par la soumission (prestataire),
// la validation (client) et l'historique de mission, qui en avaient chacun une copie.

/** Coordonnées d'une preuve de géolocalisation, stockées « lat,lng » dans sa note. */
export function parseLatLng(note: string | null): { lat: number; lng: number } | null {
  if (!note) return null;
  const [latStr, lngStr] = note.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Taille lisible d'un fichier joint (« 2.4 Mo », « 12 Ko ») ; `null` sans taille connue. */
export function formatFileSize(size: number | null | undefined): string | null {
  if (typeof size !== "number" || size <= 0) return null;
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(size / 1024))} Ko`;
}
