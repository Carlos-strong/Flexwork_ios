// Pages d'atterrissage Catégorie / Métier de /recherche (2026-10-06).
//
// Les liens de l'accueil (CategoriesBar, PopularServices, recherche libre) ouvrent
// /recherche?domaine=<libellé> avec un libellé ÉDITORIAL — « Design », « Code », « Vidéo » —
// qui n'est pas forcément celui du catalogue (« Design et UX/UI »). Ce module rapproche ce
// libellé de la taxonomie pour savoir si la page doit s'ouvrir sur une catégorie ou un métier,
// à la façon d'une page catégorie de marketplace (héros, métiers populaires, sous-catégories).
//
// Les liens émis par la page elle-même portent un IDENTIFIANT (?categorie= / ?metier=) plutôt
// qu'un libellé : plusieurs métiers partagent un nom d'une catégorie à l'autre
// (« Électricité bâtiment », « Déménagement », « Espaces verts »), et un libellé ne suffirait
// pas à les distinguer.
//
// Module PUR (aucun import Prisma ni React) : il opère sur l'arbre déjà chargé.

export type LandingMetier = { id: string; libelle: string; description: string | null };
export type LandingCategorie = {
  id: string;
  libelle: string;
  description: string | null;
  icon: string | null;
  metiers: LandingMetier[];
};

export type LandingTarget =
  | { kind: "categorie"; categorie: LandingCategorie; position: number }
  | { kind: "metier"; categorie: LandingCategorie; metier: LandingMetier; position: number };

/**
 * Forme comparable d'un libellé : sans accents, sans casse, « & » lu comme « et », ponctuation
 * ramenée à des espaces. « Électricité » et « electricite », « Design & UX » et « design et ux »
 * se comparent ainsi à égalité.
 */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// En deçà, un terme libre (« ux », « it ») se retrouverait dans trop de libellés pour désigner
// une rubrique : la page reste une recherche simple.
const MIN_PARTIAL_LENGTH = 3;

/**
 * Rubrique désignée par l'URL. Les identifiants priment ; à défaut, le libellé libre est
 * rapproché par ordre de précision décroissante :
 *   1. catégorie de même libellé      3. catégorie dont le libellé contient le terme
 *   2. métier de même libellé         4. métier dont le libellé contient le terme
 * Les catégories passent avant les métiers à précision égale : « Électricité » ouvre
 * « Énergie et Électricité », pas l'un de ses métiers. À égalité, l'ordre du catalogue décide.
 * `null` : aucune rubrique — la page se comporte en recherche libre.
 */
export function resolveLandingTarget(
  tree: LandingCategorie[],
  query: { domaine?: string | null; categorie?: string | null; metier?: string | null },
): LandingTarget | null {
  const position = (categorie: LandingCategorie) => tree.indexOf(categorie);
  if (query.metier) {
    for (const categorie of tree) {
      const metier = categorie.metiers.find((m) => m.id === query.metier);
      if (metier) return { kind: "metier", categorie, metier, position: position(categorie) };
    }
  }
  if (query.categorie) {
    const categorie = tree.find((c) => c.id === query.categorie);
    if (categorie) return { kind: "categorie", categorie, position: position(categorie) };
  }

  const term = query.domaine ? normalizeLabel(query.domaine) : "";
  if (!term) return null;

  const categoryWhere = (match: (label: string) => boolean): LandingTarget | null => {
    const categorie = tree.find((c) => match(normalizeLabel(c.libelle)));
    return categorie ? { kind: "categorie", categorie, position: position(categorie) } : null;
  };
  const metierWhere = (match: (label: string) => boolean): LandingTarget | null => {
    for (const categorie of tree) {
      const metier = categorie.metiers.find((m) => match(normalizeLabel(m.libelle)));
      if (metier) return { kind: "metier", categorie, metier, position: position(categorie) };
    }
    return null;
  };

  const exact = (label: string) => label === term;
  const exactHit = categoryWhere(exact) ?? metierWhere(exact);
  if (exactHit || term.length < MIN_PARTIAL_LENGTH) return exactHit;

  // Correspondance sur des MOTS entiers : « art » ne doit pas ouvrir « Artisanat ». Le terme
  // normalisé ne contient que lettres, chiffres et espaces : rien à échapper.
  const partial = (label: string) => ` ${label} `.includes(` ${term} `);
  return categoryWhere(partial) ?? metierWhere(partial);
}

// ── Habillage visuel ────────────────────────────────────────────────────────────────────────
// Chaque catégorie reçoit une teinte tirée de sa POSITION dans le catalogue (ordre d'affichage) :
// le héros et les vignettes de ses métiers partagent ainsi une même couleur, comme les pages
// catégorie de référence, sans qu'un administrateur ait à la choisir. La position plutôt qu'un
// hachage du libellé : deux catégories voisines ne peuvent pas tomber sur la même teinte.

export type LandingTheme = { deep: string; mid: string; soft: string; ink: string };

const THEMES: LandingTheme[] = [
  { deep: "#3D1408", mid: "#B4441C", soft: "#FBE9E1", ink: "#7C2D12" }, // terre cuite
  { deep: "#0A1931", mid: "#2F5D9E", soft: "#E6EEF9", ink: "#1E3A6B" }, // nuit
  { deep: "#0B3B2C", mid: "#1B9C6A", soft: "#E3F5EC", ink: "#14532D" }, // forêt
  { deep: "#3B0F3A", mid: "#8B2E86", soft: "#F6E6F5", ink: "#6B1F67" }, // prune
  { deep: "#3A2A05", mid: "#C08A0E", soft: "#FBF2DC", ink: "#7A5A0B" }, // ocre
  { deep: "#3A0B16", mid: "#C0304F", soft: "#FBE6EB", ink: "#8A1C35" }, // grenat
  { deep: "#0B3138", mid: "#1F8A99", soft: "#E1F3F5", ink: "#155E68" }, // lagune
];

export function landingTheme(categoriePosition: number): LandingTheme {
  return THEMES[Math.max(0, categoriePosition) % THEMES.length];
}

// Icône d'un métier, choisie par mots-clés du libellé — le catalogue n'en porte qu'au niveau
// catégorie (un emoji). Le premier mot-clé trouvé l'emporte ; à défaut, `fallback`. Sert aussi
// aux compétences, avec l'icône de leur métier pour repli.
const ICON_KEYWORDS: [string, string][] = [
  ["cyber", "ShieldCheck"], ["securite", "ShieldCheck"], ["support informatique", "Headphones"],
  ["multimedia", "Video"], ["video", "Video"], ["cloud", "Cloud"], ["reseau", "Network"],
  ["marketing", "Megaphone"], ["publicite", "Megaphone"], ["communication", "Megaphone"],
  ["mobile", "Smartphone"], ["web", "Code"], ["data", "Database"], ["intelligence", "Bot"],
  ["design", "Palette"], ["graphisme", "PenTool"], ["branding", "Sparkles"], ["seo", "Search"],
  ["redaction", "FileText"], ["relations publiques", "Newspaper"], ["etudes", "LineChart"],
  ["chantier", "HardHat"], ["menuiserie", "Hammer"], ["architecture", "Ruler"],
  ["plomberie", "Droplets"], ["assainissement", "Droplets"], ["electricite", "Zap"],
  ["maconnerie", "Building2"], ["climatisation", "Snowflake"], ["froid", "Snowflake"],
  ["terrassement", "Shovel"], ["toiture", "House"], ["peinture", "Paintbrush"],
  ["solaire", "Sun"], ["renouvelable", "Sun"], ["groupes electrogenes", "Plug"],
  ["mesures", "Gauge"], ["batteries", "Battery"], ["audit energetique", "ClipboardCheck"],
  ["eclairage", "Lightbulb"], ["energie", "Zap"], ["automatisation", "Cpu"],
  ["controle qualite", "ClipboardCheck"], ["qualite", "ClipboardCheck"], ["hygiene", "ShieldCheck"],
  ["agro", "Tractor"], ["agricole", "Tractor"], ["maintenance", "Wrench"], ["mecanique", "Cog"],
  ["usinage", "Cog"], ["soudure", "Flame"], ["fabrication", "Factory"], ["production", "Factory"],
  ["ingenierie", "Settings"], ["carrosserie", "Car"], ["automobile", "Car"], ["moto", "Bike"],
  ["diagnostic", "Activity"], ["engins", "Truck"], ["pneus", "Car"],
  ["langues", "Languages"], ["informatique", "Laptop"], ["formation", "GraduationCap"],
  ["enseignement", "BookOpen"], ["alphabetisation", "BookOpen"], ["coaching", "GraduationCap"],
  ["education", "GraduationCap"], ["pharmacie", "Pill"], ["psychologie", "Brain"],
  ["laboratoire", "Microscope"], ["nutrition", "Apple"], ["infirmier", "Stethoscope"],
  ["medic", "Stethoscope"], ["medecine", "Stethoscope"], ["kinesitherapie", "Activity"],
  ["sante", "HeartPulse"], ["bien etre", "Sparkles"], ["enfant", "Baby"], ["handicap", "Accessibility"],
  ["personnes agees", "HandHeart"], ["domicile", "House"], ["social", "HandHeart"],
  ["insertion", "Users"], ["administrati", "FileText"], ["proximite", "Users"],
  ["textile", "Shirt"], ["couture", "Scissors"], ["cordonnerie", "Footprints"], ["bijou", "Gem"],
  ["alimentaire", "Utensils"], ["poterie", "Sparkles"], ["vannerie", "Sparkles"],
  ["reparation", "Wrench"], ["evenementiel", "PartyPopper"], ["espaces verts", "Leaf"],
  ["demenagement", "Truck"], ["nettoyage", "Sparkles"], ["dechets", "Recycle"],
  ["manutention", "Package"], ["magasinage", "Warehouse"], ["entrepot", "Warehouse"],
  ["stock", "Package"], ["livraison", "Truck"], ["transport", "Truck"], ["logistique", "Truck"],
  ["transit", "Ship"], ["courrier", "Mail"], ["comptabilite", "Calculator"], ["achats", "Store"],
  ["juridique", "Scale"], ["ressources humaines", "Users"], ["relation client", "Headphones"],
  ["secretariat", "FileText"], ["gestion de projet", "Calendar"], ["entrepreneuriat", "Briefcase"],
];

export function metierIconName(libelle: string, fallback = "Briefcase"): string {
  const label = normalizeLabel(libelle);
  return ICON_KEYWORDS.find(([kw]) => label.includes(kw))?.[1] ?? fallback;
}
