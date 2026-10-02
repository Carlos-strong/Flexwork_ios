// Bornes de saisie d'une mission — SOURCE UNIQUE (2026-09-23).
//
// Trois endroits écriyaient la même règle sans se concerter : les attributs `maxLength` du
// formulaire, les contrôles JavaScript de `MissionWizard.stepErrors`, et le schéma Zod de la
// route. Résultat : le titre était plafonné à 100 caractères dans un `<input>`, mais AUCUNE
// limite ne l'attendait côté serveur — un POST direct pouvait stocker un titre de plusieurs
// mégaoctets. Et le minimum variait de 3 (Zod) à 10 (JavaScript) sans que rien ne dise lequel
// faisait foi.
//
// Ce fichier ne dépend de RIEN (pas même de Zod, qui resterait dans le bundle navigateur s'il
// était importé par le composant client). Les bornes vivent ici, les deux côtés les lisent.
//
// ── Minima : une barre d'ÉCRAN, pas une règle serveur ────────────────────────────────────
// `MISSION_TITRE_MIN` et `MISSION_DESCRIPTION_MIN` sont ce que `MissionWizard.stepErrors`
// exige pour laisser passer le client à l'étape suivante. Ils ne sont PAS revérifiés par la
// route, et c'est délibéré.
//
// Un temps, ces deux valeurs ont été contrôlées à la PUBLICATION, au même titre que le KYC ou
// le budget. Le contrôle a été retiré : plusieurs parcours de bout en bout du dépôt publient
// des missions dont la description fait 49 caractères — un cran sous la barre de 50 — et se
// sont retrouvés bloqués. La leçon vaut d'être écrite : une règle qu'aucun appelant réel ne
// respecte n'est pas une règle de sécurité, c'est une régression déguisée.
//
// Le serveur garantit donc ce qui est réellement un défaut quand ça manque : les planchers de
// saisie (`MISSION_*_SAISIE_MIN`, qui empêchent un enregistrement vide) et les bornes HAUTES
// (qui empêchent une chaîne ou un entier hors de ce que la base accepte). L'écran, lui, vise
// plus haut pour la qualité de l'annonce.
//
// Le document de spécification, de son côté, annonce 10 et 30. Si les trois doivent s'aligner
// un jour, c'est ici — et nulle part ailleurs.

// ── Titre ────────────────────────────────────────────────────────────────────────────────
/** Barre d'ÉCRAN : un titre doit dire quel est le travail, pas le nommer en trois lettres. */
export const MISSION_TITRE_MIN = 10;
export const MISSION_TITRE_MAX = 100;
/** Plancher du SCHÉMA : ce qu'on tolère dans un brouillon commencé. */
export const MISSION_TITRE_SAISIE_MIN = 3;

// ── Description ──────────────────────────────────────────────────────────────────────────
/** Barre d'ÉCRAN : en dessous, le prestataire ne peut pas chiffrer sérieusement. */
export const MISSION_DESCRIPTION_MIN = 50;
export const MISSION_DESCRIPTION_MAX = 2000;
/** Plancher du SCHÉMA, pour la même raison que le titre. */
export const MISSION_DESCRIPTION_SAISIE_MIN = 10;

// ── Cahier des charges (complément libre à la description) ───────────────────────────────
export const MISSION_CAHIER_MAX = 5000;

// ── Durée estimée ────────────────────────────────────────────────────────────────────────
export const MISSION_DELAI_MIN = 1;
// Dix ans. Bien au-delà de toute mission réelle, mais surtout TRÈS en dessous du plafond de
// la colonne (`delaiJours` est un INTEGER Postgres : 2 147 483 647). Sans borne haute, une
// saisie à 5 milliards passait Zod, puis faisait lever Prisma — un 500 là où un 400 était dû.
export const MISSION_DELAI_MAX = 3650;

// ── Montants ─────────────────────────────────────────────────────────────────────────────
// Plafond commun aux budgets et aux tarifs. `budgetMin` et `budgetMax` sont des INTEGER
// Postgres : au-delà de 2 147 483 647, l'insertion échoue. On s'arrête à deux milliards, ce
// qui laisse la marge nécessaire pour constater l'erreur (400) au lieu de la provoquer (500).
export const MISSION_MONTANT_MAX = 2_000_000_000;

// ── Contrat au temps (modes S2) ──────────────────────────────────────────────────────────
// Quantité maximale d'heures/jours/semaines/mois couverte par le plafond séquestré.
export const MISSION_TIME_QUANTITY_MAX = 100_000;

// ── Divers ───────────────────────────────────────────────────────────────────────────────
// Plafond de candidatures acceptées par la mission (`null` = illimité côté colonne). L'écran
// ne propose que 3, 5, 10 et 20 : cette borne n'existe que pour arrêter un appel direct.
export const MISSION_MAX_CANDIDATURES_MAX = 100;
// Rounds de négociation du mode devis (budgetType = "QUOTE").
export const MISSION_MAX_REVISION_ROUNDS_MAX = 20;
