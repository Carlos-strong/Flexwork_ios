// Langues parlées (2026-11-08) — biographie du profil prestataire.
//
// Liste fermée : codes ISO 639-1, ou 639-3 quand la langue n'a pas de code à deux lettres
// (fon, dioula, mooré). Les langues nationales les plus parlées de la zone couverte y figurent
// à côté des langues internationales : un client cherche souvent un prestataire qui parle SA
// langue, pas seulement le français.

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "Anglais" },
  { code: "ar", label: "Arabe" },
  { code: "pt", label: "Portugais" },
  { code: "es", label: "Espagnol" },
  { code: "de", label: "Allemand" },
  { code: "zh", label: "Chinois" },
  { code: "fon", label: "Fon" },
  { code: "yo", label: "Yoruba" },
  { code: "ee", label: "Éwé" },
  { code: "ha", label: "Haoussa" },
  { code: "wo", label: "Wolof" },
  { code: "bm", label: "Bambara" },
  { code: "dyu", label: "Dioula" },
  { code: "mos", label: "Mooré" },
  { code: "ff", label: "Peul" },
  { code: "ig", label: "Igbo" },
  { code: "tw", label: "Twi" },
  { code: "ln", label: "Lingala" },
  { code: "sw", label: "Swahili" },
];

export const LANGUAGE_LEVELS = [
  { value: "debutant", label: "Notions" },
  { value: "intermediaire", label: "Intermédiaire" },
  { value: "courant", label: "Courant" },
  { value: "natif", label: "Langue maternelle" },
] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number]["value"];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];
export const LANGUAGE_LEVEL_VALUES = LANGUAGE_LEVELS.map((l) => l.value) as [LanguageLevel, ...LanguageLevel[]];
export const MAX_LANGUAGES = 6;

export type SpokenLanguage = { code: string; niveau: LanguageLevel };

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;
export const levelLabel = (niveau: string) => LANGUAGE_LEVELS.find((l) => l.value === niveau)?.label ?? niveau;

/** Lecture tolérante de la colonne JSON `Profile.languages` : ignore toute entrée invalide. */
export function readLanguages(raw: unknown): SpokenLanguage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SpokenLanguage[] = [];
  for (const item of raw) {
    const code = (item as { code?: unknown })?.code;
    const niveau = (item as { niveau?: unknown })?.niveau;
    if (typeof code !== "string" || !LANGUAGE_CODES.includes(code) || seen.has(code)) continue;
    if (typeof niveau !== "string" || !(LANGUAGE_LEVEL_VALUES as string[]).includes(niveau)) continue;
    seen.add(code);
    out.push({ code, niveau: niveau as LanguageLevel });
  }
  return out.slice(0, MAX_LANGUAGES);
}
