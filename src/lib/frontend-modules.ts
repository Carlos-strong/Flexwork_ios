// Registre des modules d'administration du frontend.
//
// Les maquettes Flexwork-Admin-Complet.html et Flexwork-Taxonomie.html décrivent vingt-deux
// modules. Neuf pilotent une surface qui existe réellement dans ce dépôt. Les treize autres
// n'ont aucune contrepartie : ni table, ni composant, ni route.
//
// Ce fichier les liste TOUS, chacun avec son état réel et, pour ceux qui manquent, le motif.
// Livrer ces treize-là en coquilles vides aurait donné une console qui paraît complète et ne
// pilote rien — un administrateur y modifierait une couleur de thème sans effet, et mettrait
// des semaines à comprendre pourquoi. Les nommer en disant ce qu'ils exigeraient est plus
// utile que les simuler, et c'est la carte de ce qu'il reste à construire.
//
// `drives` cite les fichiers réellement commandés par le module : c'est ce qui rend l'écran
// vérifiable. Un module actif dont le fichier cité ne lit pas la configuration serait un
// mensonge détectable — src/lib/frontend-modules.test.ts le détecte.

export type FrontendModuleState = "actif" | "absent";

export type FrontendModule = {
  id: string;
  group: string;
  label: string;
  icon: string;
  state: FrontendModuleState;
  /** Ce que le module commande, en clair. */
  summary: string;
  /** Fichiers du dépôt que ce module pilote — vide pour un module absent. */
  drives: string[];
  /** Pour un module absent : ce qui manque, et pourquoi il n'a pas été simulé. */
  missing?: string;
};

export const FRONTEND_MODULES: FrontendModule[] = [
  {
    id: "vue-ensemble",
    group: "Vue d’ensemble",
    label: "Vue d’ensemble",
    icon: "◫",
    state: "actif",
    summary: "Couverture des modules, état de publication, écart entre le brouillon et la ligne.",
    drives: ["src/app/backoffice/content/page.tsx"],
  },
  {
    id: "analytics",
    group: "Vue d’ensemble",
    label: "Analytics",
    icon: "◧",
    state: "absent",
    summary: "Audience des pages publiques, taux de clic des sections.",
    drives: [],
    missing:
      "Aucune mesure d’audience n’est collectée : ni table d’événements, ni traceur côté client. Le module exigerait d’abord de décider ce qu’on mesure et ce qu’on conserve — une question de vie privée avant d’être une question d’écran.",
  },
  {
    id: "taxonomie",
    group: "Référentiel métier",
    label: "Taxonomie",
    icon: "◐",
    state: "actif",
    summary: "Catégorie → Métier → Service, hiérarchie reprise de flexwork_job ; édition en direct.",
    drives: [
      "src/app/api/categories/route.ts",
      "src/app/api/services/route.ts",
      "src/app/backoffice/catalog/page.tsx",
    ],
  },
  {
    id: "certifications",
    group: "Référentiel métier",
    label: "Certifications",
    icon: "✦",
    state: "absent",
    summary: "Organismes agréés et certifications délivrées.",
    drives: [],
    missing:
      "Le modèle v3 délègue la certification à des organismes agréés (A5) et la plateforme ne vérifie plus les qualifications (A11). Les compétences portent un drapeau « pièce attendue », rien de plus. Un module de certification supposerait un référentiel d’organismes qui n’existe ni en base ni dans les arbitrages.",
  },
  {
    id: "grilles-tarifaires",
    group: "Référentiel métier",
    label: "Grilles tarifaires",
    icon: "₣",
    state: "absent",
    summary: "Fourchettes de prix par domaine.",
    drives: [],
    missing:
      "Les tarifs sont saisis par chaque prestataire (Profile.indicativeRate) et négociés devis par devis. Imposer une grille depuis la plateforme heurterait la règle de conformité n°4 : la plateforme n’impose ni tarif, ni disponibilité, ni exclusivité.",
  },
  {
    id: "accueil",
    group: "Contenu du site",
    label: "Sections d’accueil",
    icon: "⊞",
    state: "actif",
    summary: "Héros, barre de catégories, garanties, services, grille d’icônes, talents à la une.",
    drives: [
      "src/components/afrilance/Hero.tsx",
      "src/components/afrilance/CategoriesBar.tsx",
      "src/components/afrilance/TrustedBy.tsx",
      "src/components/afrilance/PopularServices.tsx",
      "src/components/afrilance/CategoryGrid.tsx",
      "src/components/afrilance/TalentsAfrique.tsx",
    ],
  },
  {
    id: "menus",
    group: "Contenu du site",
    label: "Menus & pied de page",
    icon: "☰",
    state: "actif",
    summary: "Menu « Explorer » de l’en-tête et les quatre colonnes du pied de page.",
    drives: ["src/components/afrilance/Header.tsx", "src/components/afrilance/Footer.tsx"],
  },
  {
    id: "pages",
    group: "Contenu du site",
    label: "Pages",
    icon: "◩",
    state: "actif",
    summary: "Titre et référencement des pages publiques ; détection des entrées orphelines.",
    drives: ["src/app/api/admin/frontend/pages/route.ts"],
  },
  {
    id: "mediatheque",
    group: "Contenu du site",
    label: "Médiathèque",
    icon: "◫",
    state: "absent",
    summary: "Téléversement et catalogue des images du site.",
    drives: [],
    missing:
      "Les images publiques sont des fichiers de public/images/, servis par le déploiement. Le stockage objet (src/lib/storage.ts) existe mais sert les pièces KYC et les livrables — des documents privés, sous contrôle d’accès. Mélanger un catalogue public dans ce bucket demanderait une séparation explicite des visibilités.",
  },
  {
    id: "temoignages",
    group: "Contenu du site",
    label: "Témoignages",
    icon: "❞",
    state: "absent",
    summary: "Sélection d’avis mis en avant sur l’accueil.",
    drives: [],
    missing:
      "Les avis réels existent (modèle Review), mais en choisir quelques-uns pour la vitrine est une sélection éditoriale sur des paroles de clients. La page d’accueil a déjà été purgée de quatre profils fictifs et de six faux partenaires le 2026-09-09 ; rouvrir une vitrine d’avis triés demande d’abord une règle de sélection publiable.",
  },
  {
    id: "partenaires",
    group: "Contenu du site",
    label: "Partenaires",
    icon: "◍",
    state: "absent",
    summary: "Logos de partenaires sur l’accueil.",
    drives: [],
    missing:
      "Le bandeau de partenaires a été retiré le 2026-09-09 : il affichait Flutterwave, Paystack, Andela, MTN, Wave et Jumia sans qu’aucun partenariat n’existe. Le module reviendra avec de vrais partenariats, pas avant.",
  },
  {
    id: "faq",
    group: "Contenu du site",
    label: "FAQ",
    icon: "?",
    state: "absent",
    summary: "Questions et réponses éditables.",
    drives: [],
    missing:
      "La page /faq existe, mais son contenu est du JSX. Le module supposerait un modèle question/réponse et la réécriture de la page pour le consommer — faisable, non fait : seuls le titre et le référencement de la page sont éditables aujourd’hui.",
  },
  {
    id: "bannieres",
    group: "Contenu du site",
    label: "Bannières",
    icon: "⚑",
    state: "absent",
    summary: "Bandeaux d’annonce temporaires.",
    drives: [],
    missing: "Aucun emplacement de bannière n’existe dans les gabarits publics.",
  },
  {
    id: "theme",
    group: "Apparence",
    label: "Thème & couleurs",
    icon: "◐",
    state: "absent",
    summary: "Palette, rayons, styles globaux.",
    drives: [],
    missing:
      "Les couleurs sont des valeurs littérales dans les classes Tailwind de chaque composant (bg-[#FF6B35] et consorts), compilées au build. Les rendre éditables exige de les extraire d’abord en variables CSS — un chantier de refonte, pas un écran d’administration.",
  },
  {
    id: "logos",
    group: "Apparence",
    label: "Logos",
    icon: "⬔",
    state: "absent",
    summary: "Logo, favicon, icônes d’application.",
    drives: [],
    missing:
      "Le logo est composé en texte dans l’en-tête et le pied de page ; la favicon et les icônes sont des fichiers servis depuis src/app et public/. Dépend de la médiathèque.",
  },
  {
    id: "typographie",
    group: "Apparence",
    label: "Typographie",
    icon: "T",
    state: "absent",
    summary: "Familles et graisses de caractères.",
    drives: [],
    missing:
      "Inter et Fraunces sont chargées par next/font au BUILD, précisément pour éviter un appel réseau tiers au chargement de la page. Changer de police depuis une console reviendrait à renoncer à cette optimisation.",
  },
  {
    id: "seo",
    group: "Apparence",
    label: "Référencement global",
    icon: "◑",
    state: "actif",
    summary: "Titre et description du site, repris par les métadonnées du gabarit racine.",
    drives: ["src/app/layout.tsx"],
  },
  {
    id: "parametres",
    group: "Système",
    label: "Paramètres",
    icon: "⚙",
    state: "actif",
    summary: "Nom affiché, baseline du pied de page, mention de bas de page.",
    drives: ["src/app/api/admin/frontend/settings/route.ts"],
  },
  {
    id: "traductions",
    group: "Système",
    label: "Traductions",
    icon: "Aa",
    state: "absent",
    summary: "Contenu multilingue.",
    drives: [],
    missing:
      "L’application est monolingue : aucune couche d’internationalisation, et les libellés sont écrits en français dans les composants. Le pied de page affiche « FR » comme une mention, pas comme un sélecteur.",
  },
  {
    id: "versions",
    group: "Système",
    label: "Versions",
    icon: "↺",
    state: "actif",
    summary: "Historique des publications et retour arrière.",
    drives: ["src/lib/frontend-config.ts", "src/app/api/admin/frontend/releases/route.ts"],
  },
  {
    id: "logs",
    group: "Système",
    label: "Journal",
    icon: "≡",
    state: "actif",
    summary: "Gestes d’édition tracés dans le journal d’audit administrateur.",
    drives: ["src/lib/admin-audit.ts", "src/app/backoffice/audit/page.tsx"],
  },
  {
    id: "utilisateurs-admin",
    group: "Système",
    label: "Utilisateurs admin",
    icon: "◍",
    state: "absent",
    summary: "Attribution des rôles d’administration.",
    drives: [],
    missing:
      "Les rôles se posent en base (User.adminRole) et aucun écran ne les attribue. C’est volontaire : un administrateur qui peut s’octroyer un rôle supprime la séparation des pouvoirs que ces rôles instituent (§13). Si l’écran est fait un jour, il ne devra pas vivre sous le rôle `frontend`.",
  },
];

export const FRONTEND_MODULE_GROUPS = [
  "Vue d’ensemble",
  "Référentiel métier",
  "Contenu du site",
  "Apparence",
  "Système",
] as const;

export function activeModules(): FrontendModule[] {
  return FRONTEND_MODULES.filter((m) => m.state === "actif");
}
