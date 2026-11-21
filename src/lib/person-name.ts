// Noms de personnes — source unique (2026-11-09). « Prénom Nom » était recomposé en ligne une
// quarantaine de fois ([u.firstname, u.lastname].filter(Boolean).join(" ")), avec ou sans
// .trim() ; le nom public d'un client (« Awa M. ») l'était dans trois fichiers. Le repli
// (« Client », l'email, « Prestataire »…) reste propre à chaque écran : `personFullName(u) || …`.

type NameParts = { firstname?: string | null; lastname?: string | null } | null | undefined;

/** « Prénom Nom », sans espaces superflus ; chaîne vide si aucun des deux n'est renseigné. */
export function personFullName(u: NameParts): string {
  return [u?.firstname?.trim(), u?.lastname?.trim()].filter(Boolean).join(" ");
}

/**
 * Nom public d'un client : prénom et initiale du nom (« Awa M. »). Le nom complet d'un client
 * n'est pas montré aux prestataires avant l'engagement.
 */
export function clientPublicName(u: NameParts, fallback = "Client"): string {
  const first = u?.firstname?.trim();
  const last = u?.lastname?.trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  return first || last || fallback;
}
