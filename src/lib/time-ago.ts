// Ancienneté relative d'un événement (« Il y a 5 min », « Hier », « Il y a 3j »), au-delà d'une
// semaine la date. Source unique (2026-11-09) : la même fonction était recopiée dans six
// écrans des tableaux de bord.
export function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffJ = Math.floor(diffH / 24);
  if (diffJ === 1) return "Hier";
  if (diffJ < 7) return `Il y a ${diffJ}j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}
