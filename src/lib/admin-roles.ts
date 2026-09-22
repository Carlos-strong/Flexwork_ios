import type { AdminRole } from "@prisma/client";

/**
 * Registre unique de l'administration — architecture reprise de `flexwork_job` (2026-09-21).
 *
 * `flexwork_job` range son administration en DEUX espaces, chacun avec sa sidebar :
 *   · `/admin`      — « Admin Métier » : les gestes quotidiens sur les personnes et l'argent ;
 *   · `/backoffice` — « Back Office »  : le paramétrage et le contrôle de la plateforme.
 * Ses rubriques, leurs libellés et leurs routes sont reproduits ici tels quels.
 *
 * Ce que `flexwork_job` ne fait pas, et que ce registre ajoute : la SÉPARATION DES POUVOIRS
 * (modele-skillafrica-v3-Flexwork.md §13). Là-bas, un profil unique `ADMIN` voit et peut tout.
 * Ici, chaque rubrique déclare les rôles qui la voient (`roles`) et ceux qui la lisent sans
 * pouvoir y agir (`readOnly`, §13 : « lire n'est pas agir »). La sidebar d'un administrateur ne
 * contient que ce que son rôle peut ouvrir ; un espace entier disparaît s'il n'y a rien.
 *
 * Ce registre affiche, il ne protège pas : chaque route d'API porte sa propre garde
 * (`src/lib/adminGuard.ts`), et les deux doivent rester superposées. Une rubrique dont le
 * `href` mène à une route gardée par un rôle absent de `roles` est un mensonge d'interface —
 * `src/lib/admin-roles.test.ts` le vérifie route par route.
 *
 * Règle de non-duplication : une fonctionnalité n'existe qu'UNE fois dans cet arbre. Ce qui est
 * partagé l'est par `roles` multiple, jamais par recopie dans une seconde rubrique.
 */

export type AdminSpace = "admin" | "backoffice";

export type AdminSpaceMeta = {
  /** Libellé de l'espace, en tête de sidebar. */
  label: string;
  /** Intitulé de la section de la sidebar — repris de flexwork_job. */
  section: string;
  /** Racine de l'espace. */
  root: string;
  /** Emoji de l'espace, en tête de sidebar et sur le lien de bascule. */
  icon: string;
  /** Libellé du lien qui mène vers cet espace depuis l'autre. */
  crossLabel: string;
};

export const ADMIN_SPACES: Record<AdminSpace, AdminSpaceMeta> = {
  admin: { label: "Administration", section: "Admin Métier", root: "/admin", icon: "⚙️", crossLabel: "Admin Métier →" },
  backoffice: { label: "Back Office", section: "Opérationnel", root: "/backoffice", icon: "🔧", crossLabel: "Back Office →" },
};

export type AdminSubItem = {
  id: string;
  label: string;
  /** Route absolue, ou ancre `#rubrique` dans la page de la rubrique parente. */
  href: string;
  hint?: string;
  /** Restreint la sous-rubrique à certains rôles de la rubrique parente. */
  roles?: readonly AdminRole[];
  /** Rôles qui lisent cette sous-rubrique sans y agir, quand ils diffèrent de ceux du parent. */
  readOnly?: readonly AdminRole[];
};

export type AdminModule = {
  id: string;
  space: AdminSpace;
  label: string;
  href: string;
  /** Emoji — le parti pris visuel de flexwork_job, repris tel quel. */
  icon: string;
  /** Rôles qui voient cette rubrique dans leur sidebar. */
  roles: readonly AdminRole[];
  /** Rôles qui y accèdent en consultation seulement : aucun geste métier n'y est offert. */
  readOnly?: readonly AdminRole[];
  /** Ce que la rubrique engage, en une ligne. */
  hint: string;
  children?: readonly AdminSubItem[];
  /**
   * Rubrique de flexwork_job sans contrepartie dans ce dépôt. Elle figure dans la sidebar pour
   * que l'architecture soit complète, et son écran dit ce qui manque au lieu de simuler des
   * données — la page d'accueil de ce projet a été purgée de ses chiffres inventés le
   * 2026-09-09, l'administration ne les réintroduit pas.
   */
  unavailable?: string;
};

export type AdminRoleMeta = {
  label: string;
  tagline: string;
  /** Écran d'accueil du rôle — cible de la redirection depuis `/admin`. */
  home: string;
  accent: string;
};

export const ADMIN_ROLES: readonly AdminRole[] = ["kyc", "moderation", "mediation", "superviseur", "frontend"];

export const ADMIN_ROLE_META: Record<AdminRole, AdminRoleMeta> = {
  kyc: {
    label: "Vérification KYC",
    tagline: "Instruire les dossiers d'identité et les personnes ressources.",
    home: "/admin",
    accent: "#0F766E",
  },
  moderation: {
    label: "Modération",
    tagline: "Agir sur signalement : retirer une déclaration, suspendre un compte.",
    home: "/admin",
    accent: "#B45309",
  },
  mediation: {
    label: "Médiation",
    tagline: "Proposer une résolution aux deux parties. Vous ne tranchez pas.",
    home: "/admin",
    accent: "#2D5BE3",
  },
  superviseur: {
    label: "Superviseur",
    tagline: "Lire tout. Paramétrer la plateforme. Ne trancher aucun dossier.",
    home: "/admin",
    accent: "#1A7A4A",
  },
  frontend: {
    label: "Éditeur du site",
    tagline: "Taxonomie, contenu public, référencement.",
    home: "/backoffice",
    accent: "#7C3AED",
  },
};

/** Ordre = ordre d'affichage dans la sidebar de l'espace. */
export const ADMIN_MODULES: readonly AdminModule[] = [
  // ─────────────────────────────── Admin Métier ───────────────────────────────
  {
    id: "dashboard",
    space: "admin",
    label: "Dashboard",
    href: "/admin",
    icon: "📊",
    roles: ["kyc", "moderation", "mediation", "superviseur"],
    // Aucun geste : le tableau de bord renvoie vers la rubrique qui détient le pouvoir.
    readOnly: ["kyc", "moderation", "mediation", "superviseur"],
    hint: "Indicateurs du jour — seulement ceux que votre rôle peut lire.",
  },
  {
    id: "utilisateurs",
    space: "admin",
    label: "Utilisateurs",
    href: "/admin/utilisateurs",
    icon: "👥",
    // §13 : la suspension appartient à la Modération (« suspend pour fausse déclaration »).
    // Le KYC lit la liste pour retrouver un compte ; il n'y suspend personne.
    roles: ["moderation", "kyc", "superviseur"],
    readOnly: ["kyc", "superviseur"],
    hint: "Comptes, statut d'identité, suspension motivée.",
  },
  {
    id: "kyc",
    space: "admin",
    label: "KYC et Vérifications",
    href: "/admin/kyc",
    icon: "🪪",
    roles: ["kyc", "superviseur"],
    readOnly: ["superviseur"],
    hint: "File des dossiers d'identité, décisions, historique.",
    children: [
      { id: "kyc-file", label: "File d'attente", href: "/admin/kyc", hint: "Tous les dossiers instruisibles." },
      { id: "kyc-entreprises", label: "Clients", href: "/admin/kyc/entreprises", hint: "Dossiers des comptes client." },
      { id: "kyc-freelances", label: "Prestataires", href: "/admin/kyc/freelances", hint: "Dossiers des cinq filières prestataires." },
      { id: "kyc-historique", label: "Historique", href: "/admin/kyc/historique", hint: "Toutes les décisions rendues, révocables." },
    ],
  },
  {
    id: "validation",
    space: "admin",
    label: "Validation utilisateurs",
    href: "/admin/validation-utilisateurs",
    icon: "✅",
    roles: ["kyc", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Personnes ressources des filières chantier : appel, confirmation, exigence.",
  },
  {
    id: "missions",
    space: "admin",
    label: "Missions",
    href: "/admin/missions",
    icon: "📋",
    // Aucun geste : la plateforme n'intervient pas dans le déroulé d'une mission (§6).
    roles: ["superviseur", "mediation"],
    readOnly: ["superviseur", "mediation"],
    hint: "Les 12 statuts réels de Mission.status, et les paires à surveiller.",
    children: [
      { id: "missions-kanban", label: "Kanban", href: "/admin/missions", hint: "Missions par statut." },
      { id: "missions-antifraude", label: "Anti-collusion", href: "#antifraude", hint: "Paires client/prestataire à opérations répétées.", roles: ["superviseur"] },
    ],
  },
  {
    id: "litiges",
    space: "admin",
    label: "Litiges",
    href: "/admin/disputes",
    icon: "⚖️",
    roles: ["mediation", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Médiations ouvertes, proposition de répartition, réponse des parties.",
    children: [
      { id: "litiges-file", label: "Litiges ouverts", href: "/admin/disputes", hint: "File des médiations en cours." },
      { id: "litiges-proposer", label: "Proposer une résolution", href: "#proposer", hint: "Répartition entre les deux parties.", roles: ["mediation"] },
    ],
  },
  {
    id: "contrats",
    space: "admin",
    label: "Contrats",
    href: "/admin/contrats",
    icon: "🔄",
    roles: ["mediation", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Contrats de prestation, signatures, état du séquestre.",
  },
  {
    id: "paiements",
    space: "admin",
    label: "Paiements",
    href: "/admin/paiements",
    icon: "💳",
    roles: ["mediation", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Séquestre, payables, journal PSP, libérations et remboursements.",
  },
  {
    id: "signalements",
    space: "admin",
    label: "Signalements",
    href: "/admin/reports",
    icon: "🚩",
    roles: ["moderation", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Signalements reçus du public, déclarations retirées.",
    children: [
      { id: "signalements-recus", label: "Signalements reçus", href: "/admin/reports", hint: "Ce que le public a signalé." },
      { id: "signalements-declarations", label: "Déclarations", href: "/admin/reports/declarations", hint: "Ce qui est publié, et de quoi le retirer." },
    ],
  },
  {
    id: "uma",
    space: "admin",
    label: "IA Uma",
    href: "/admin/uma-recruiter",
    icon: "🤖",
    roles: ["superviseur"],
    readOnly: ["superviseur"],
    hint: "Recommandation de profils par embeddings.",
    unavailable:
      "flexwork_job calcule des embeddings de profils (pgvector) pour recommander des prestataires. Ce dépôt n'a ni modèle d'embedding, ni index vectoriel, ni service Uma. Et une recommandation sur critère non publié heurterait la règle de conformité n°5 : la plateforme ne recommande pas un prestataire sur un critère que le client ne peut pas lire.",
  },
  {
    id: "queues",
    space: "admin",
    label: "Queues",
    href: "/admin/queues",
    icon: "⚙️",
    roles: ["superviseur"],
    readOnly: ["superviseur"],
    hint: "Les cinq tâches automatiques et ce qu'elles ont à traiter maintenant.",
  },

  // ─────────────────────────────── Back Office ────────────────────────────────
  {
    id: "bo-dashboard",
    space: "backoffice",
    label: "Dashboard",
    href: "/backoffice",
    icon: "📊",
    roles: ["superviseur", "frontend"],
    readOnly: ["superviseur", "frontend"],
    hint: "Indicateurs de la plateforme et accès aux rubriques du Back Office.",
  },
  {
    id: "taxonomie",
    space: "backoffice",
    label: "Taxonomie",
    href: "/backoffice/catalog",
    icon: "🗂️",
    roles: ["frontend", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Domaines, spécialités, compétences — et leur couverture face aux saisies réelles.",
  },
  {
    id: "localisation",
    space: "backoffice",
    label: "Localisation",
    href: "/backoffice/locations",
    icon: "🌍",
    roles: ["superviseur"],
    hint: "Réglages par pays : paliers de risque par domaine, âge minimum des filières chantier.",
    children: [
      { id: "localisation-risques", label: "Risques par domaine", href: "/backoffice/locations", hint: "Palier et assurance exigée, par pays." },
      { id: "localisation-age", label: "Âge minimum", href: "#age", hint: "Seuil A13 par pays — jamais sous 18 ans." },
    ],
  },
  {
    id: "finance",
    space: "backoffice",
    label: "Finance",
    href: "/backoffice/finance",
    icon: "💰",
    roles: ["superviseur", "mediation"],
    readOnly: ["superviseur", "mediation"],
    hint: "Synthèse du séquestre : fonds tenus, versés, dus, gelés. Les gestes sont dans Paiements.",
  },
  {
    id: "contenu",
    space: "backoffice",
    label: "Contenu du site",
    href: "/backoffice/content",
    icon: "🖼️",
    // Absente de flexwork_job, qui n'a pas de gestion de contenu : conservée ici parce que la
    // console de publication existe et pilote la page d'accueil réelle. La retirer pour coller
    // à la maquette aurait supprimé une fonctionnalité en service.
    roles: ["frontend", "superviseur"],
    readOnly: ["superviseur"],
    hint: "Sections d'accueil, menus, pages, versions publiées.",
    children: [
      { id: "contenu-overview", label: "Vue d'ensemble", href: "/backoffice/content", hint: "État du contenu publié." },
      { id: "contenu-accueil", label: "Sections d'accueil", href: "/backoffice/content/accueil", hint: "Blocs de la page d'accueil." },
      { id: "contenu-menus", label: "Menus & pied de page", href: "/backoffice/content/menus", hint: "Navigation publique." },
      { id: "contenu-pages", label: "Pages", href: "/backoffice/content/pages", hint: "Titre et référencement des pages." },
      { id: "contenu-versions", label: "Versions", href: "/backoffice/content/versions", hint: "Historique et retour arrière." },
    ],
  },
  {
    id: "parametres",
    space: "backoffice",
    label: "Paramètres",
    href: "/backoffice/settings",
    icon: "⚙️",
    roles: ["frontend", "superviseur"],
    hint: "Réglages du site ; activation des filières par zone.",
    children: [
      {
        id: "parametres-site",
        label: "Site & référencement",
        href: "/backoffice/settings",
        hint: "Nom, baseline, titre et description.",
        readOnly: ["superviseur"],
      },
      {
        id: "parametres-filieres",
        label: "Filières & activation",
        href: "/backoffice/settings/filieres",
        hint: "FeatureFlag (clé × zone), activation manuelle après prérequis juridique.",
        roles: ["superviseur"],
      },
    ],
  },
  {
    id: "roles",
    space: "backoffice",
    label: "Rôles & Accès",
    href: "/backoffice/roles",
    icon: "🔐",
    roles: ["superviseur"],
    readOnly: ["superviseur"],
    hint: "Qui détient quel pouvoir, et ce que chaque pouvoir ouvre.",
  },
  {
    id: "audit",
    space: "backoffice",
    label: "Audit",
    href: "/backoffice/audit",
    icon: "📋",
    roles: ["superviseur"],
    readOnly: ["superviseur"],
    hint: "Journal append-only à hash chaîné : qui a fait quoi, sous quelle justification.",
  },
  {
    id: "reporting",
    space: "backoffice",
    label: "Reporting",
    href: "/backoffice/reports",
    icon: "📈",
    roles: ["superviseur"],
    readOnly: ["superviseur"],
    hint: "Indicateurs consolidés et exports CSV.",
  },
];

/** Écran d'accueil du rôle — `/admin` y redirige quand le rôle n'a pas le Dashboard métier. */
export function adminHomeForRole(role: AdminRole): string {
  return ADMIN_ROLE_META[role].home;
}

export function modulesForRole(role: AdminRole, space?: AdminSpace): AdminModule[] {
  return ADMIN_MODULES.filter((m) => m.roles.includes(role) && (!space || m.space === space));
}

/** Espaces dans lesquels le rôle a au moins une rubrique — les autres ne lui sont pas montrés. */
export function spacesForRole(role: AdminRole): AdminSpace[] {
  return (Object.keys(ADMIN_SPACES) as AdminSpace[]).filter((space) => modulesForRole(role, space).length > 0);
}

export function spaceForPath(pathname: string): AdminSpace {
  return pathname === "/backoffice" || pathname.startsWith("/backoffice/") ? "backoffice" : "admin";
}

/** Sous-rubriques visibles par ce rôle (`roles` d'une sous-rubrique est un filtre en plus). */
export function subItemsForRole(entry: AdminModule, role: AdminRole): AdminSubItem[] {
  return (entry.children ?? []).filter((child) => !child.roles || child.roles.includes(role));
}

/**
 * Rubrique active pour un chemin : le préfixe le plus long gagne, pour que `/admin/kyc` ne
 * s'allume pas en plus de sa sous-rubrique sur `/admin/kyc/historique`.
 *
 * Les Dashboards font exception : leur adresse est la RACINE de l'espace (`/admin`,
 * `/backoffice`), préfixe de toutes les autres. Laissés en correspondance par préfixe, ils
 * « possédaient » n'importe quelle page de l'espace pour tout rôle qui les voit — et
 * `canOpenPath` laissait alors un médiateur ouvrir `/admin/utilisateurs` par URL directe.
 * Ils ne correspondent donc qu'à leur adresse exacte.
 */
export function activeModuleForRole(role: AdminRole, pathname: string): AdminModule | undefined {
  return modulesForRole(role)
    .filter((m) => {
      if (pathname === m.href) return true;
      const isSpaceRoot = m.href === ADMIN_SPACES[m.space].root;
      return !isSpaceRoot && pathname.startsWith(`${m.href}/`);
    })
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Sous-rubrique active : l'ancre courante si elle est déclarée, sinon la route la plus spécifique. */
export function activeSubItemForRole(
  entry: AdminModule,
  role: AdminRole,
  pathname: string,
  hash: string,
): AdminSubItem | undefined {
  const items = subItemsForRole(entry, role);

  if (hash) {
    const anchored = items.find((i) => i.href === hash);
    if (anchored) return anchored;
  }

  return items
    .filter((i) => !i.href.startsWith("#") && (i.href === pathname || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/** Le rôle ne fait-il que consulter cette rubrique ? */
export function isReadOnlyForRole(entry: AdminModule, role: AdminRole): boolean {
  return entry.readOnly?.includes(role) ?? false;
}

/**
 * Le rôle a-t-il le geste métier de cette rubrique ? Faux = écran en consultation : les boutons
 * d'action disparaissent, ils n'échouent pas en 403 sous les yeux de l'utilisateur.
 *
 * `subId` affine au niveau d'une sous-rubrique, quand un même écran réunit deux pouvoirs
 * (« Paramètres » : le site pour l'éditeur, les filières pour le superviseur).
 */
export function canActInModule(moduleId: string, role: AdminRole, subId?: string): boolean {
  const entry = ADMIN_MODULES.find((m) => m.id === moduleId);
  if (!entry || !entry.roles.includes(role) || entry.unavailable) return false;

  if (subId) {
    const sub = entry.children?.find((c) => c.id === subId);
    if (!sub) return false;
    if (sub.roles && !sub.roles.includes(role)) return false;
    if (sub.readOnly) return !sub.readOnly.includes(role);
  }

  return !isReadOnlyForRole(entry, role);
}

/**
 * Le rôle peut-il ouvrir cette route ? Sert à refuser un accès direct par URL.
 *
 * Descend jusqu'à la sous-rubrique : « Paramètres » est ouvert à l'éditeur du site, mais sa
 * sous-rubrique « Filières & activation » est réservée au superviseur. S'arrêter à la rubrique
 * laisserait l'éditeur y entrer en tapant l'adresse.
 */
export function canOpenPath(role: AdminRole, pathname: string): boolean {
  const entry = activeModuleForRole(role, pathname);
  if (!entry) return false;

  const routeChildren = (entry.children ?? []).filter((c) => !c.href.startsWith("#"));
  const matching = routeChildren
    .filter((c) => c.href === pathname || pathname.startsWith(`${c.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return !matching || !matching.roles || matching.roles.includes(role);
}
