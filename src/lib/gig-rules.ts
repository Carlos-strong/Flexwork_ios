import { z } from "zod";

// Règles d'un Gig (service à prix fixe), 2026-11-08 — source UNIQUE pour l'API et l'éditeur.
//
// Un bon Gig, d'après le guide de rédaction retenu pour la plateforme :
//   - un titre accrocheur, formulé « Je vais + bénéfice concret pour le client » ;
//   - TROIS formules (Basique / Standard / Premium) à prix progressifs ;
//   - pour chacune : ce qui est inclus, le délai de livraison, le nombre de révisions ;
//   - un visuel (image de couverture, ou courte vidéo) ;
//   - des mots-clés pour être trouvé dans la recherche.
//
// Les Gigs créés avant cette date n'ont ni formules ni visuel : ils restent valides et
// commandables à leur prix unique. Ces règles s'appliquent aux créations et modifications.

export const GIG_TIERS = ["basique", "standard", "premium"] as const;
export type GigTier = (typeof GIG_TIERS)[number];
export const GIG_TIER_LABELS: Record<GigTier, string> = { basique: "Basique", standard: "Standard", premium: "Premium" };

export const GIG_TITLE_PREFIX = "Je vais ";
export const GIG_TITLE_MIN = 15;
export const GIG_TITLE_MAX = 80;
export const GIG_DESCRIPTION_MIN = 120;
export const GIG_DESCRIPTION_MAX = 1200;
export const GIG_TAGS_MIN = 1;
export const GIG_TAGS_MAX = 5;
export const GIG_TAG_MAX_LENGTH = 30;
export const GIG_PACKAGE_DESCRIPTION_MAX = 300;
export const GIG_REVISIONS_MAX = 10;
export const GIG_DELAI_MAX = 365;
export const GIG_PRICE_MAX = 100_000_000;
/** Photos par service : la première sert de couverture, toutes défilent en carrousel. */
export const GIG_IMAGES_MAX = 3;
export const GIG_IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export const GIG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** « je vais créer… » → « Je vais créer… » ; espaces normalisés. */
export function normalizeGigTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  return /^je vais /i.test(t) ? GIG_TITLE_PREFIX + t.slice(GIG_TITLE_PREFIX.length) : t;
}

/** Mots-clés : minuscules, sans « # », sans doublon, dans l'ordre de saisie. */
export function normalizeGigTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tag = t.replace(/^#+/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Lien vidéo accepté : YouTube ou Vimeo uniquement, converti en adresse de lecteur intégré.
 * Toute autre adresse → null (refusée) : on n'intègre pas une page arbitraire dans la nôtre.
 */
export function videoEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : null);
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.pathname === "/watch" ? id(url.searchParams.get("v")) : id(url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]);
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtu.be") {
    const v = id(url.pathname.slice(1));
    return v ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = url.pathname.match(/(\d{6,12})/)?.[1];
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  return null;
}

const packageSchema = z.object({
  tier: z.enum(GIG_TIERS),
  titre: z.string().trim().min(3, "Nommez la formule (ex. « Logo simple »).").max(40),
  description: z
    .string()
    .trim()
    .min(10, "Décrivez ce qui est inclus dans la formule.")
    .max(GIG_PACKAGE_DESCRIPTION_MAX),
  prix: z.number().positive("Le prix doit être positif.").max(GIG_PRICE_MAX),
  delaiJours: z.number().int().min(1, "Délai d'au moins 1 jour.").max(GIG_DELAI_MAX),
  revisions: z.number().int().min(0).max(GIG_REVISIONS_MAX),
});
export type GigPackageInput = z.infer<typeof packageSchema>;

export const gigInputSchema = z
  .object({
    titre: z
      .string()
      .transform(normalizeGigTitle)
      .pipe(
        z
          .string()
          .min(GIG_TITLE_MIN, `Titre trop court (${GIG_TITLE_MIN} caractères minimum).`)
          .max(GIG_TITLE_MAX, `Titre trop long (${GIG_TITLE_MAX} caractères maximum).`)
          .refine((t) => t.startsWith(GIG_TITLE_PREFIX) && t.length > GIG_TITLE_PREFIX.length + 3, {
            message: "Le titre commence par « Je vais » suivi du bénéfice pour le client.",
          }),
      ),
    description: z
      .string()
      .trim()
      .min(GIG_DESCRIPTION_MIN, `Description trop courte (${GIG_DESCRIPTION_MIN} caractères minimum).`)
      .max(GIG_DESCRIPTION_MAX),
    domaine: z.string().trim().min(2).max(80),
    tags: z
      .array(z.string().max(GIG_TAG_MAX_LENGTH * 2))
      .transform(normalizeGigTags)
      .pipe(
        z
          .array(z.string().max(GIG_TAG_MAX_LENGTH, `Mot-clé trop long (${GIG_TAG_MAX_LENGTH} caractères maximum).`))
          .min(GIG_TAGS_MIN, "Ajoutez au moins un mot-clé.")
          .max(GIG_TAGS_MAX, `${GIG_TAGS_MAX} mots-clés maximum.`),
      ),
    packages: z.array(packageSchema).length(3, "Trois formules sont attendues : Basique, Standard, Premium."),
    videoUrl: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .refine((v) => !v || videoEmbedUrl(v) !== null, { message: "Vidéo : lien YouTube ou Vimeo uniquement." }),
    status: z.enum(["brouillon", "publie", "cloture"]).optional(),
  })
  .superRefine((g, ctx) => {
    const byTier = new Map(g.packages.map((p) => [p.tier, p]));
    if (byTier.size !== 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packages"], message: "Une formule de chaque niveau : Basique, Standard, Premium." });
      return;
    }
    const [b, s, p] = GIG_TIERS.map((t) => byTier.get(t)!);
    if (!(b.prix < s.prix && s.prix < p.prix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packages"],
        message: "Prix progressifs attendus : Basique < Standard < Premium.",
      });
    }
  });
export type GigInput = z.infer<typeof gigInputSchema>;

/** Publier exige un visuel : au moins une photo, ou une vidéo. */
export function missingVisual(g: { imagePaths: string[]; videoUrl: string | null }): boolean {
  return g.imagePaths.length === 0 && !g.videoUrl;
}

/** Formules dans l'ordre Basique → Premium. */
export function sortPackages<T extends { tier: string }>(packages: T[]): T[] {
  return [...packages].sort((a, b) => GIG_TIERS.indexOf(a.tier as GigTier) - GIG_TIERS.indexOf(b.tier as GigTier));
}

/**
 * Ce qu'il manque pour PUBLIER (le brouillon, lui, peut être incomplet côté visuel) : la
 * checklist affichée dans l'éditeur. Le visuel est exigé à la publication — une image de
 * couverture OU une vidéo.
 */
export function publishChecklist(g: {
  titre: string;
  description: string;
  tags: string[];
  packagesValid: boolean;
  hasImage: boolean;
  hasVideo: boolean;
}): { key: string; label: string; done: boolean }[] {
  const titre = normalizeGigTitle(g.titre);
  return [
    {
      key: "titre",
      label: "Titre « Je vais + bénéfice »",
      done: titre.startsWith(GIG_TITLE_PREFIX) && titre.length >= GIG_TITLE_MIN && titre.length <= GIG_TITLE_MAX,
    },
    { key: "formules", label: "3 formules à prix progressifs", done: g.packagesValid },
    {
      key: "description",
      label: `Description claire (${GIG_DESCRIPTION_MIN} caractères minimum)`,
      done: g.description.trim().length >= GIG_DESCRIPTION_MIN,
    },
    { key: "visuel", label: `Visuel : 1 à ${GIG_IMAGES_MAX} photos ou une vidéo`, done: g.hasImage || g.hasVideo },
    { key: "tags", label: `Mots-clés (1 à ${GIG_TAGS_MAX})`, done: normalizeGigTags(g.tags).length >= GIG_TAGS_MIN },
  ];
}
