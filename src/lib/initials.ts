// Initiales d'avatar — source unique (2026-11-09). Neuf écrans les recalculaient chacun à sa
// façon (prénom + nom, ou nom complet), avec des replis différents ; le repli reste propre à
// chaque écran (« ? », « CL », « PR »…), passé en paramètre.

/** Initiales à partir du prénom et du nom (« Awa Mensah » → « AM »). */
export function initials(firstname?: string | null, lastname?: string | null, fallback = "?"): string {
  const a = firstname?.trim().charAt(0) ?? "";
  const b = lastname?.trim().charAt(0) ?? "";
  return `${a}${b}`.toUpperCase() || fallback;
}

/** Initiales à partir d'un nom complet : premières lettres des deux premiers mots. */
export function initialsFromName(name: string, fallback = "?"): string {
  const [first, second] = name.trim().split(/\s+/).filter(Boolean);
  return `${first?.charAt(0) ?? ""}${second?.charAt(0) ?? ""}`.toUpperCase() || fallback;
}
