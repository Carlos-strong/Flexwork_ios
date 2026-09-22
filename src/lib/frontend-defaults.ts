// Socle de repli du contenu public — et SOURCE UNIQUE des valeurs de départ.
//
// Chaque constante ci-dessous reprend, à l'identique, ce qui était écrit en dur dans un
// composant de src/components/afrilance/ avant le 2026-09-21. Elle sert deux fois :
//
//   · au SEED, pour que l'administration démarre sur le contenu réellement en ligne plutôt
//     que sur une page vide qu'il faudrait ressaisir ;
//   · au RENDU, quand rien n'a encore été publié, quand la base ne répond pas, ou quand une
//     publication ne porte pas la section demandée. Le visiteur voit alors la page
//     d'aujourd'hui, pas un trou.
//
// Le second usage est le plus important : il garantit que brancher la page d'accueil sur une
// base de données n'introduit pas un point de panne là où il n'y en avait aucun. Un composant
// qui lit ce module ne peut pas échouer faute de contenu.
//
// Ces valeurs ne sont donc PAS de la donnée de démonstration. Les modifier change ce que voit
// un visiteur sur une installation neuve.

export type DefaultSectionItem = {
  label: string;
  sublabel?: string;
  href?: string;
  icon?: string;
  color?: string;
  imageUrl?: string;
};

export type DefaultSection = {
  key: string;
  label: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  items: DefaultSectionItem[];
};

// Convention d'écriture du titre de héros : les sauts de ligne sont des sauts de ligne, et le
// segment encadré de `**` reçoit le dégradé orange. Une seule chaîne éditable plutôt que trois
// champs de schéma pour une mise en forme qui n'existe qu'à cet endroit ; un titre sans `**`
// s'affiche simplement sans segment coloré.
export const HERO_TITLE = "Trouve le bon\n**talent africain,**\ntout de suite ✨";

export const DEFAULT_SECTIONS: DefaultSection[] = [
  {
    key: "hero",
    label: "Héros (accueil)",
    title: HERO_TITLE,
    subtitle:
      "Experts digitaux, artisans et professionnels du bâtiment. Identité vérifiée, contrat signé, paiement sous séquestre en FCFA.",
    items: [],
  },
  {
    key: "categories_bar",
    label: "Barre de catégories",
    ctaText: "+ Voir plus →",
    ctaLink: "/recherche",
    items: [
      { label: "Design Graphique", color: "bg-[#FF6B35]" },
      { label: "Programmation", color: "bg-[#0A1931]" },
      { label: "Marketing Digital", color: "bg-[#1B9C6A]" },
      { label: "Vidéo & Animation", color: "bg-[#8B2E86]" },
      { label: "Rédaction", color: "bg-[#FF3E6C]" },
      { label: "Maçonnerie", color: "bg-[#F7C948] text-black" },
      { label: "Plomberie", color: "bg-[#FF6B35]" },
      { label: "Électricité", color: "bg-[#1B9C6A]" },
      { label: "Menuiserie", color: "bg-gradient-to-r from-[#FF6B35] to-[#8B2E86]" },
    ],
  },
  {
    key: "guarantees",
    label: "Bandeau de garanties",
    title: "Vos garanties :",
    ctaText: "En savoir plus →",
    ctaLink: "/confiance",
    items: [
      { label: "Identité vérifiée", sublabel: "KYC obligatoire avant toute mise en relation" },
      { label: "Paiement sous séquestre", sublabel: "Fonds bloqués jusqu’à validation du livrable" },
      { label: "Médiation intégrée", sublabel: "Litige arbitré par la plateforme" },
      { label: "Contrat signé", sublabel: "Signature électronique et certificat horodaté" },
    ],
  },
  {
    key: "popular_services",
    label: "Services populaires",
    title: "Services 🔥",
    ctaText: "Voir tout →",
    ctaLink: "/recherche",
    items: [
      { label: "Développement Web", sublabel: "Développement web", color: "from-[#FF6B35] to-[#FF8A5B]", imageUrl: "/images/african_designer_studio.webp" },
      { label: "Design & Identité", sublabel: "Design", color: "from-[#F7C948] to-[#FF6B35]", imageUrl: "/images/ankara_video_editor.webp" },
      { label: "Montage Vidéo", sublabel: "Vidéo", color: "from-[#8B2E86] to-[#FF3E6C]", imageUrl: "/images/lagos_developer_coworking.webp" },
      { label: "Marketing Digital", sublabel: "Marketing", color: "from-[#1B9C6A] to-[#0A1931]", imageUrl: "/images/african_designer_studio.webp" },
      { label: "Maçonnerie", sublabel: "Maçonnerie", color: "from-[#0A1931] to-[#8B2E86]", imageUrl: "/images/ankara_video_editor.webp" },
      { label: "Plomberie", sublabel: "Plomberie", color: "from-[#FF3E6C] to-[#FF6B35]", imageUrl: "/images/lagos_developer_coworking.webp" },
      { label: "Électricité", sublabel: "Électricité", color: "from-[#1B9C6A] to-[#F7C948]", imageUrl: "/images/african_designer_studio.webp" },
      { label: "Carrelage & Finitions", sublabel: "Carrelage", color: "from-[#FF6B35] to-[#8B2E86]", imageUrl: "/images/ankara_video_editor.webp" },
    ],
  },
  {
    key: "category_grid",
    label: "Grille d’icônes de domaines",
    items: [
      { label: "Design", icon: "🎨", color: "bg-orange-100" },
      { label: "Code", icon: "💻", color: "bg-blue-100" },
      { label: "Marketing", icon: "📱", color: "bg-green-100" },
      { label: "Vidéo", icon: "🎬", color: "bg-purple-100" },
      { label: "Rédaction", icon: "✍️", color: "bg-pink-100" },
      { label: "Maçonnerie", icon: "🧱", color: "bg-yellow-100" },
      { label: "Plomberie", icon: "🚰", color: "bg-orange-100" },
      { label: "Électricité", icon: "⚡", color: "bg-indigo-100" },
      { label: "Menuiserie", icon: "🪚", color: "bg-emerald-100" },
    ],
  },
  {
    key: "featured_talents",
    label: "Talents à la une",
    // `subtitle` porte le sur-titre affiché AU-DESSUS du titre (« Made in Africa »), pas une
    // ligne de sous-titre : c'est ainsi que la section est composée depuis l'origine.
    subtitle: "Made in Africa",
    title: "Talents d’Afrique 🌍",
    ctaText: "Voir tous les prestataires →",
    ctaLink: "/recherche",
    items: [],
  },
];

export type DefaultMenuItem = { label: string; href: string; description?: string };

// Les clés de menu sont techniques et immuables : un composant les cite nommément.
export const DEFAULT_MENUS: Record<string, { label: string; items: DefaultMenuItem[] }> = {
  header_explore: {
    label: "En-tête — menu « Explorer »",
    items: [
      { href: "/recherche", label: "Trouver un prestataire", description: "Annuaire des profils à identité vérifiée" },
      { href: "/comment-ca-marche", label: "Comment ça marche", description: "Du dépôt de mission au paiement" },
      { href: "/confiance", label: "Confiance & Sécurité", description: "Vérification, séquestre, médiation" },
      { href: "/tarifs", label: "Tarifs", description: "Commissions et frais de la plateforme" },
      { href: "/faq", label: "FAQ", description: "Les questions les plus fréquentes" },
      { href: "/a-propos", label: "À propos", description: "Qui nous sommes" },
      { href: "/contact", label: "Contact", description: "Écrire à l’équipe" },
    ],
  },
  footer_prestataires: {
    label: "Pied de page — Prestataires",
    items: [
      { href: "/recherche", label: "Trouver un prestataire" },
      { href: "/signup", label: "Devenir prestataire" },
      { href: "/missions/new", label: "Publier une mission" },
    ],
  },
  footer_apropos: {
    label: "Pied de page — À propos",
    items: [
      { href: "/a-propos", label: "Qui sommes-nous" },
      { href: "/comment-ca-marche", label: "Comment ça marche" },
      { href: "/tarifs", label: "Tarifs" },
    ],
  },
  footer_support: {
    label: "Pied de page — Support",
    items: [
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
      { href: "/confiance", label: "Confiance & Sécurité" },
    ],
  },
  footer_legal: {
    label: "Pied de page — Légal",
    items: [
      { href: "/cgu", label: "Conditions générales" },
      { href: "/confidentialite", label: "Confidentialité" },
      { href: "/signalement", label: "Signaler un contenu" },
    ],
  },
};

// Ordre d'affichage des colonnes du pied de page. Le titre de colonne rendu est celui du menu,
// amputé du préfixe « Pied de page — ».
export const FOOTER_MENU_KEYS = [
  "footer_prestataires",
  "footer_apropos",
  "footer_support",
  "footer_legal",
] as const;

export type DefaultSetting = { key: string; value: string; group: string; label: string };

export const DEFAULT_SETTINGS: DefaultSetting[] = [
  { key: "seo.title", group: "seo", label: "Titre du site (onglet)", value: "FlexWork — Talents vérifiés, zéro arnaque" },
  {
    key: "seo.description",
    group: "seo",
    label: "Description de référencement",
    value:
      "FlexWork met en relation clients et prestataires en Afrique de l'Ouest. Identité vérifiée, paiement sécurisé.",
  },
  { key: "site.name", group: "identite", label: "Nom affiché", value: "FlexWork" },
  {
    key: "site.baseline",
    group: "identite",
    label: "Baseline du pied de page",
    value:
      "La plateforme des talents africains : identité vérifiée, contrat signé, paiement sous séquestre en FCFA et Mobile Money.",
  },
  { key: "site.footerNote", group: "identite", label: "Mention du bas de page", value: "Made with ❤️ à Cotonou 🇧🇯" },
];

// Pages publiques réellement servies par src/app. La liste sert de référence à l'écran
// « Pages » : une entrée en base absente d'ici est signalée comme orpheline (la route a été
// supprimée), une route présente ici et absente de la base est proposée à l'ajout.
// `title` est le TITRE D'ONGLET de la page, composé en « <titre> — <nom du site> » par
// frontendPageMetadata. Les valeurs ci-dessous reproduisent donc à l'identique les titres
// servis avant que ces pages ne consomment la configuration.
export const PUBLIC_ROUTES: { path: string; title: string }[] = [
  { path: "/", title: "Accueil" },
  { path: "/recherche", title: "Rechercher un prestataire" },
  { path: "/a-propos", title: "À propos" },
  { path: "/comment-ca-marche", title: "Comment ça marche" },
  { path: "/confiance", title: "Confiance & sécurité" },
  { path: "/tarifs", title: "Tarifs" },
  { path: "/faq", title: "FAQ" },
  { path: "/contact", title: "Contact" },
  { path: "/cgu", title: "Conditions générales" },
  { path: "/confidentialite", title: "Confidentialité" },
  { path: "/signalement", title: "Signaler un contenu" },
  { path: "/chronologie", title: "Chronologie d’une mission" },
];

/**
 * Destinations internes qu'un menu éditable a le droit de viser.
 *
 * Le pied de page a déjà porté quatre liens morts (« Carrières », « Presse », « Blog
 * AfroTech », « Événements Dakar »), retirés à la main le 2026-09-09. Rendre les menus
 * éditables sans garde rouvrirait cette porte — et cette fois sans déploiement pour s'en
 * apercevoir. Une route absente de cette liste est refusée à l'écriture.
 *
 * Sont volontairement exclus : les routes d'administration, les espaces authentifiés
 * (/dashboard, /client), le bac à sable PSP, les routes transitoires (/verify-otp) et toutes
 * les routes à segment dynamique — un menu public ne peut pas pointer vers /missions/[id].
 *
 * La liste est vérifiée contre le disque par src/lib/frontend-routes.test.ts : une route
 * supprimée de src/app casse le test au lieu de devenir un lien mort en production.
 */
export const LINKABLE_ROUTES: string[] = [
  "/",
  "/a-propos",
  "/cgu",
  "/chronologie",
  "/comment-ca-marche",
  "/confiance",
  "/confidentialite",
  "/contact",
  "/declarations",
  "/faq",
  "/kyc",
  "/missions/new",
  "/profile",
  "/recherche",
  "/signalement",
  "/signin",
  "/signup",
  "/tarifs",
];

/**
 * Une cible de lien est-elle acceptable ? Les URL absolues en https sont admises (un menu
 * peut légitimement pointer vers un site partenaire) ; les ancres aussi. Tout le reste doit
 * être une route interne réellement servie.
 */
export function isLinkableHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("https://")) return true;
  if (value.startsWith("#")) return true;
  const [path] = value.split(/[?#]/);
  return LINKABLE_ROUTES.includes(path);
}

/**
 * Pages dont les métadonnées sont réellement composées depuis la configuration publiée
 * (via `frontendPageMetadata`). Éditer leur titre ou leur description dans la console change
 * ce que servent les moteurs de recherche.
 *
 * Les autres routes publiques en sont absentes pour une raison technique et non par oubli :
 * /recherche, /signalement et /chronologie sont des composants CLIENT, et un composant client
 * ne peut pas exporter `generateMetadata`. Les y rattacher demanderait un `layout.tsx` par
 * route. Quant à « / », son titre relève du réglage global `seo.title`, pas d'une entrée de
 * page — deux endroits pour le même titre s'écraseraient l'un l'autre.
 *
 * L'écran « Pages » s'appuie sur cette liste pour distinguer ce qu'il pilote de ce qu'il ne
 * fait qu'inventorier. Sans elle, il proposerait d'éditer un référencement sans effet.
 *
 * Vérifiée contre le disque par src/lib/frontend-routes.test.ts.
 */
export const CONFIG_DRIVEN_PAGES: string[] = [
  "/a-propos",
  "/cgu",
  "/comment-ca-marche",
  "/confiance",
  "/confidentialite",
  "/contact",
  "/faq",
  "/tarifs",
];
