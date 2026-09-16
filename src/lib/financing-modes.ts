// Modes de financement d'une mission (2026-09-10) — catalogue unique des façons dont le prix
// d'une mission peut être séquestré puis libéré, choisi par le CLIENT à la PUBLICATION de la
// mission (POST /api/missions, champ `financingModeKey`) plutôt qu'au moment de générer le
// contrat.
//
// Pourquoi à la publication : le mode conditionne ce que le prestataire doit chiffrer. Un
// prestataire qui répond à une mission « jalons pondérés » découpe son devis en postes
// livrables un à un ; celui qui répond à une mission « escrow upfront » chiffre un forfait.
// Le lui annoncer seulement à la génération du contrat — après négociation, après acceptation
// — arrivait trop tard : le devis était déjà écrit sous une autre hypothèse.
//
// Ce fichier est PUR (aucun import Prisma, comme src/lib/jalons.ts et src/lib/devis.ts) :
// toute la logique de dérivation y est testable sans base. Les routes s'en servent comme
// d'une table de vérité ; elles ne décident plus rien elles-mêmes.
//
// ── Le devis EST la décomposition en jalons ────────────────────────────────────────────────
// En mode devis (Mission.budgetType = "QUOTE"), les lignes du devis (DevisData.lineItems) sont
// déjà les jalons : `# | Description | Qté | PU HT | Montant | Échéance`, une ligne = un
// livrable = une preuve = une libération. Les jalons du contrat en sont donc DÉRIVÉS, jamais
// resaisis — avant ce module, le client retapait à la main, dans un formulaire vierge, des
// montants que le prestataire avait déjà chiffrés ligne par ligne, avec la divergence
// garantie que cela suppose.

import type { DevisData } from "@/lib/devis";
import type { JalonInput } from "@/lib/jalons";

export type FinancingModeKey =
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "J1"
  | "J2"
  | "J3"
  | "J4"
  | "J5"
  | "S1"
  | "S2H"
  | "S2J"
  | "S2M";

export type FinancingModeFamily = "fixe" | "jalon" | "temps";

// Comment les jalons du contrat se déduisent du devis pour ce mode :
//   - "none"        : aucun jalon, un seul HOLD/RELEASE sur le prix total du contrat ;
//   - "devis_lines" : une ligne de devis = un jalon, à son montant réel (proratisé au TTC) ;
//   - "equal_split" : autant de jalons que de lignes, mais tous du même montant ;
//   - "halves"      : deux jalons de 50 %, quel que soit le découpage du devis.
export type JalonStrategy = "none" | "devis_lines" | "equal_split" | "halves";

// Taux de la retenue de garantie du mode J4 (2026-09-11). 5 % — borne basse de la fourchette
// « 5 à 10 % » décrite par le mode, et taux usuel de la retenue de garantie dans le BTP. Un
// seul taux au catalogue plutôt qu'un curseur au contrat : le prestataire doit pouvoir chiffrer
// en connaissant la part retenue AVANT de répondre (c'est toute la raison d'être du choix du
// mode à la publication, voir l'en-tête de ce fichier) — un taux négociable jalon par jalon
// rouvrirait exactement le décalage que ce module a supprimé.
export const RETENTION_RATE_J4 = 0.05;

// Les quatre seuls leviers que le contrat sait réellement appliquer aujourd'hui (voir
// PrestationContract.financingMode / .jalonsSequential / .retentionRate et le modèle Jalon,
// prisma/schema.prisma). Tout mode du catalogue doit se ramener à une combinaison de ces
// quatre-là : c'est ce qui garantit qu'ajouter un mode n'ajoute jamais de chemin de paiement
// parallèle.
export type FinancingPrimitives = {
  useJalons: boolean;
  financingMode: "lump_sum" | "progressive";
  jalonsSequential: boolean;
  /**
   * Par où l'argent ENTRE au séquestre (2026-09-14, §8 du cahier des charges).
   *
   * "per_jalon" : chaque jalon porte son propre financement — comportement historique.
   * "upfront"   : un financement unique, que les jalons CONSOMMENT. C'est le modèle que le §8
   *               désigne nommément : « les sous-tâches ne doivent pas créer un second
   *               séquestre ».
   *
   * Ne change rien aux LIBÉRATIONS : `availableFrom` (src/lib/escrow.ts) bornait déjà chaque
   * libération par le solde du contrat entier, jamais par le séquestre du jalon. Seule l'entrée
   * des fonds diffère — et c'est tout ce que le §8 demande.
   */
  fundingGranularity: "per_jalon" | "upfront";
  // Fraction de chaque jalon retenue jusqu'à la libération finale (0 = aucune retenue).
  // Voir PrestationContract.retentionRate et releasableBeforeRetention (src/lib/jalons.ts).
  retentionRate: number;
};

export type FinancingModeDescriptor = {
  key: FinancingModeKey;
  family: FinancingModeFamily;
  label: string;
  badge: string;
  definition: string;
  recommendation: string;
  // Un mode indisponible reste dans le catalogue (il est décrit, comparé, et son absence est
  // motivée) mais ne peut pas être choisi : la route de publication le refuse. Mieux qu'un
  // silence — le client voit que le mode existe et pourquoi il ne lui est pas proposé.
  available: boolean;
  unavailableReason?: string;
  primitives: FinancingPrimitives;
  jalonStrategy: JalonStrategy;
  /**
   * Unité tarifaire d'un mode au TEMPS (famille `temps`), absente partout ailleurs. Portée par le
   * mode et non saisie : choisir S2-J, c'est déjà dire « au jour ». La recopier dans un champ de
   * formulaire ouvrirait la seule incohérence possible — un mode journalier facturé à l'heure.
   */
  rateUnit?: "hour" | "day" | "month";
};

export const FINANCING_MODES: Record<FinancingModeKey, FinancingModeDescriptor> = {
  F1: {
    key: "F1",
    family: "fixe",
    label: "Fixe 100 % à la livraison",
    badge: "Risque prestataire élevé",
    definition:
      "Paiement intégral à la fin, après validation de toutes les preuves. Aucune sécurité intermédiaire.",
    recommendation: "Uniquement si relation de confiance établie.",
    // Refus STRUCTUREL, pas une fonctionnalité manquante : la plateforme n'autorise aucune
    // soumission de livrable tant que les fonds ne sont pas séquestrés (canSubmitJalonDeliverable
    // exige `fonds_sous_sequestre`, canSubmitDeliverable idem côté mission). Un mode où le
    // prestataire travaille sans garantie contredit le modèle de séquestre lui-même.
    available: false,
    unavailableReason:
      "Le séquestre préalable est obligatoire : aucun livrable ne peut être soumis avant que les fonds soient bloqués. Choisissez « Fixe 100 % escrow upfront » pour un paiement unique en fin de mission.",
    primitives: { useJalons: false, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "none",
  },
  F2: {
    key: "F2",
    family: "fixe",
    label: "Fixe 100 % escrow upfront",
    badge: "Recommandé petite mission",
    definition:
      "Le client bloque 100 % du montant dès la signature du contrat. Libération unique à la fin, après validation des preuves.",
    recommendation: "Idéal pour une mission courte ou un premier client.",
    available: true,
    primitives: { useJalons: false, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "none",
  },
  F3: {
    key: "F3",
    family: "fixe",
    label: "Fixe 50/50",
    badge: "Compromis équilibré",
    definition:
      "50 % au démarrage, 50 % à la livraison — deux jalons comptables, même si le prix est forfaitaire.",
    recommendation: "Bon compromis pour une mission fixe de 2 à 4 semaines.",
    // Retiré de l'offre (2026-09-11) — décision produit, PAS une limite technique : la
    // dérivation `halves` fonctionne et reste testée, le mode peut être rouvert en repassant
    // ce seul drapeau à `true`. Le catalogue proposé est volontairement réduit à F2/J1/J3/J4
    // pour que le client choisisse entre quatre régimes réellement distincts plutôt qu'entre
    // neuf variantes dont plusieurs se recouvrent — un découpage 50/50 s'obtient déjà avec J1
    // sur un devis à deux lignes.
    available: false,
    unavailableReason:
      "Non proposé actuellement. Pour un paiement en deux temps, choisissez « Jalons pondérés au coût réel » avec un devis en deux postes.",
    // Séquentiel : le solde ne se finance qu'une fois l'acompte validé — sinon les deux
    // moitiés seraient finançables dans n'importe quel ordre, ce qui viderait le « 50/50 »
    // de son sens.
    primitives: { useJalons: true, financingMode: "lump_sum", jalonsSequential: true, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "halves",
  },
  F4: {
    key: "F4",
    family: "fixe",
    label: "Fixe échelonné temporel",
    badge: "Lissage trésorerie",
    definition:
      "Paiement à échéances calendaires fixes (mensuel, hebdomadaire), indépendamment des jalons techniques.",
    recommendation: "Pour une mission longue avec équipe dédiée.",
    available: false,
    unavailableReason:
      "Nécessite une échéance datée sur le jalon (Jalon.dueDate) et un déclencheur calendaire : toute libération est aujourd'hui déclenchée par une action humaine, jamais par une date.",
    primitives: { useJalons: true, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "equal_split",
  },
  J1: {
    key: "J1",
    family: "jalon",
    label: "Jalons pondérés au coût réel",
    badge: "Recommandé",
    definition:
      "Chaque ligne du devis devient un jalon à son montant réel. Libération à la validation des preuves de chaque jalon.",
    recommendation: "Le mode le plus juste et le plus traçable pour une mission technique.",
    available: true,
    primitives: { useJalons: true, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "devis_lines",
  },
  J2: {
    key: "J2",
    family: "jalon",
    label: "Jalons égaux",
    badge: "Simple",
    definition:
      "Le prix total est réparti en parts égales entre les lignes du devis. Simple, mais ne reflète pas la charge réelle de chaque poste.",
    recommendation: "Dépannage, mission courte, découpage indicatif.",
    // Retiré de l'offre (2026-09-11) — même décision produit que F3 ci-dessus, et le motif est
    // ici dans sa propre définition : égaliser les montants « ne reflète pas la charge réelle
    // de chaque poste ». J1 dérive les mêmes jalons du même devis, au montant juste.
    available: false,
    unavailableReason:
      "Non proposé actuellement : « Jalons pondérés au coût réel » découpe le même devis, mais au montant réel de chaque poste.",
    primitives: { useJalons: true, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "equal_split",
  },
  J3: {
    key: "J3",
    family: "jalon",
    label: "Jalons + progression cumulée",
    badge: "Règle curseur",
    definition:
      "Chaque point d'étape confirmé par le client libère aussitôt la part correspondant à l'incrément validé, sans attendre la fin du jalon.",
    recommendation: "Avancement continu, anti-litige — le paiement suit le chantier.",
    available: true,
    primitives: { useJalons: true, financingMode: "progressive", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "devis_lines",
  },
  J4: {
    key: "J4",
    family: "jalon",
    label: "Jalons + retenue de garantie",
    badge: "Sécurité finition",
    definition:
      "Sur chaque jalon, 5 % sont retenus au séquestre. La retenue cumulée est libérée en une seule fois, une fois TOUS les jalons validés.",
    recommendation: "BTP, garantie de parfait achèvement, SAV.",
    available: true,
    primitives: {
      useJalons: true,
      financingMode: "lump_sum",
      jalonsSequential: false,
      retentionRate: RETENTION_RATE_J4,
      fundingGranularity: "per_jalon",
    },
    jalonStrategy: "devis_lines",
  },
  // ── S1 — forfait financé d'un coup, découpé en sous-tâches (2026-09-14) ──────────────────
  // Le seul mode qui porte `fundingGranularity: "upfront"`, et la raison pour laquelle ce levier
  // existe. Il implémente les §7 et §8 du cahier des charges : un devis découpé en sous-tâches,
  // dont le TOTAL est séquestré dès le départ, et que chaque validation vient consommer.
  //
  // Ce qui le distingue de J1 n'est PAS le découpage — les deux dérivent leurs lots des lignes
  // du devis, à l'identique. C'est l'entrée des fonds : J1 fait financer chaque jalon
  // séparément, S1 fait financer une seule fois. Le §8 isole précisément ce point (« les
  // sous-tâches ne doivent pas créer un second séquestre »), et c'est ce qui justifie un mode
  // distinct plutôt qu'un libellé différent sur J1.
  //
  // Pour le client, la différence est concrète : il paie une fois, au lieu d'être rappelé à
  // chaque jalon. Pour le prestataire, elle l'est aussi : la totalité est garantie dès le
  // départ, et non jalon par jalon au fil de la bonne volonté du client.
  S1: {
    key: "S1",
    family: "jalon",
    label: "Forfait avec sous-tâches",
    badge: "Séquestre unique",
    definition:
      "Le prix total est séquestré en une seule fois, puis chaque sous-tâche validée libère sa part. Le client ne finance qu'une fois.",
    recommendation:
      "Prestation ponctuelle découpée en étapes — installation, réparation, intervention technique.",
    available: true,
    primitives: {
      useJalons: true,
      financingMode: "lump_sum",
      jalonsSequential: false,
      retentionRate: 0,
      fundingGranularity: "upfront",
    },
    jalonStrategy: "devis_lines",
  },
  // ── S2 — rémunération au TEMPS (§9 à §13) ────────────────────────────────────────────────
  // Trois modes pour une seule mécanique, et c'est voulu : seule l'UNITÉ tarifaire change
  // (heure, jour, mois). Le cahier des charges insiste pour ne pas confondre unité tarifaire et
  // fréquence de règlement — ici l'unité est dans le mode, et le règlement suit la validation
  // de chaque relevé, jamais un calendrier.
  //
  // `useJalons: false` : un contrat au temps n'a pas de jalons. Ce qui fractionne le paiement
  // n'est pas un découpage convenu d'avance mais les RELEVÉS DE PRÉSENCE, qui n'existent pas
  // encore à la signature. Le séquestre porte le plafond (§10 : 20 jours × 7 500 = 150 000), et
  // chaque relevé validé le consomme — exactement le modèle du §8, obtenu ici sans jalon.
  //
  // Le prix du contrat EST le plafond financier. C'est ce que le client finance avant le
  // démarrage, et ce que `requestContractHold` séquestre en une fois.
  S2H: {
    key: "S2H",
    family: "temps",
    label: "Au temps — tarif horaire",
    badge: "Heures pointées",
    definition:
      "Un tarif horaire et un plafond d'heures. Le client séquestre le plafond avant le démarrage ; chaque relevé d'heures validé libère sa part.",
    recommendation: "Maintenance, interventions techniques, renfort ponctuel.",
    available: true,
    primitives: {
      useJalons: false,
      financingMode: "lump_sum",
      jalonsSequential: false,
      retentionRate: 0,
      fundingGranularity: "per_jalon",
    },
    jalonStrategy: "none",
    rateUnit: "hour",
  },
  S2J: {
    key: "S2J",
    family: "temps",
    label: "Au temps — tarif journalier",
    badge: "Journées pointées",
    definition:
      "Un tarif journalier et un plafond de jours. Le client séquestre le plafond avant le démarrage ; chaque journée validée libère sa part.",
    recommendation: "Artisans, manœuvres, personnel de chantier.",
    available: true,
    primitives: {
      useJalons: false,
      financingMode: "lump_sum",
      jalonsSequential: false,
      retentionRate: 0,
      fundingGranularity: "per_jalon",
    },
    jalonStrategy: "none",
    rateUnit: "day",
  },
  S2M: {
    key: "S2M",
    family: "temps",
    label: "Au temps — tarif mensuel",
    badge: "Périodes mensuelles",
    definition:
      "Un tarif mensuel. Le client séquestre la période avant le démarrage ; chaque mois validé libère sa part, une seule fois par période.",
    recommendation: "Équipe dédiée, mission longue avec présence régulière.",
    available: true,
    primitives: {
      useJalons: false,
      financingMode: "lump_sum",
      jalonsSequential: false,
      retentionRate: 0,
      fundingGranularity: "per_jalon",
    },
    jalonStrategy: "none",
    rateUnit: "month",
  },
  J5: {
    key: "J5",
    family: "jalon",
    label: "Jalons + bonus / malus",
    badge: "Performance",
    definition:
      "Bonus en cas de livraison en avance, malus par jour de retard, appliqués au montant du jalon.",
    recommendation: "Quand le délai est le critère critique.",
    available: false,
    unavailableReason:
      "Ferait varier un montant après signature, ce que le contrat interdit (termsSnapshot immuable, la scission ne fait que redistribuer un montant déjà engagé). Demande un mécanisme d'avenant.",
    primitives: { useJalons: true, financingMode: "lump_sum", jalonsSequential: false, retentionRate: 0, fundingGranularity: "per_jalon" },
    jalonStrategy: "devis_lines",
  },
};

export const DEFAULT_FINANCING_MODE_KEY: FinancingModeKey = "J1";

// `hasOwnProperty`, pas `in` : `in` traverse la chaîne de prototypes, si bien que "toString",
// "constructor" ou "valueOf" passaient pour des modes valides — `getFinancingMode("toString")`
// renvoyait alors une FONCTION en guise de descripteur, dont `jalonStrategy` est `undefined`
// (le switch de deriveJalons ne matche rien et retourne `undefined`, planté un cran plus loin).
export function isFinancingModeKey(value: unknown): value is FinancingModeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FINANCING_MODES, value);
}

export function getFinancingMode(key: string): FinancingModeDescriptor | null {
  return isFinancingModeKey(key) ? FINANCING_MODES[key] : null;
}

export function listFinancingModes(): FinancingModeDescriptor[] {
  return Object.values(FINANCING_MODES);
}

export function listAvailableFinancingModes(): FinancingModeDescriptor[] {
  return listFinancingModes().filter((m) => m.available);
}

// ── Répartition exacte d'un total entre des parts pondérées ────────────────────────────────
// `validateJalonsSum` exige que Σ montants == prix du contrat : arrondir chaque part
// indépendamment ne le garantit pas (3 parts d'un tiers de 100 donnent 99). La dernière part
// absorbe donc le reliquat — elle vaut `total − Σ(parts précédentes)`, ce qui rend la somme
// exacte par construction quel que soit le nombre de parts, et quelle que soit la maille
// d'arrondi.
//
// Arrondi à l'UNITÉ (2026-09-14). Ce fichier arrondissait auparavant au centime, faute de
// pouvoir faire mieux : le prix du contrat est le totalTTC du devis, et `computeDevisData`
// produisait alors des décimales — arrondir les parts à l'unité sous un total fractionnaire
// aurait brisé la somme, donc le contrat. La correction a été portée à la source
// (src/lib/devis.ts, roundAmount) : le totalTTC étant désormais entier, le découpage peut l'être
// aussi, et toute la chaîne — devis, jalons, cibles de libération progressive, retenue de
// garantie — partage enfin une seule maille monétaire.
function roundAmount(value: number): number {
  return Math.round(value);
}

export function distributeExact(weights: number[], total: number): number[] {
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  // Poids tous nuls (devis sans montant, ou lignes à 0) : on retombe sur une répartition
  // égale plutôt que de diviser par zéro.
  const effective = sumWeights > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sumWeights > 0 ? sumWeights : weights.length;

  const amounts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < effective.length - 1; i++) {
    const part = roundAmount((effective[i] / effectiveSum) * total);
    amounts.push(part);
    allocated += part;
  }
  // Dernière part : le reliquat EXACT, jamais ré-arrondi — c'est lui, et lui seul, qui garantit
  // Σ parts == total. Un `roundAmount` ici casserait la somme dès que `total` n'est PAS entier :
  // le prix d'un contrat à prix fixe est saisi librement (validation.ts, `montant`), et les
  // contrats générés avant l'arrondi entier du devis peuvent en porter un. Découper 1 234,56 en
  // parts entières donnerait alors 1 235 — et `validateJalonsSum` refuserait le contrat.
  //
  // Le nettoyage au centime ne gomme que l'erreur de représentation flottante accumulée par les
  // soustractions successives ; sur un total entier, toutes les parts précédentes l'étant aussi,
  // il est sans effet et le reliquat est entier de lui-même. L'intégralité des montants découle
  // ainsi de celle du total, au lieu d'être forcée contre lui.
  amounts.push(Math.round((total - allocated) * 100) / 100);
  return amounts;
}

// ── Dérivation des jalons ──────────────────────────────────────────────────────────────────

export type DeriveJalonsResult =
  | { ok: true; jalons: JalonInput[] | null }
  | { ok: false; error: string };

// Le devis somme à `totalTTC` = Σ(lignes) + main d'œuvre + TVA (voir computeDevisData,
// src/lib/devis.ts), alors que le prix du contrat EST ce totalTTC. Les montants des lignes ne
// somment donc PAS au prix du contrat : la main d'œuvre et la TVA sont proratisées sur les
// lignes, au poids de chacune. Un jalon porte ainsi sa part complète du prix payé — ce que
// montre le tableau de référence, où les jalons somment au TTC.
function jalonsFromDevisLines(devis: DevisData, prixContrat: number): JalonInput[] {
  const weights = devis.lineItems.map((item) => item.total);
  const amounts = distributeExact(weights, prixContrat);
  return devis.lineItems.map((item, i) => ({
    titre: item.description.trim() || `Jalon ${i + 1}`,
    montant: amounts[i],
  }));
}

/**
 * Jalons à créer au contrat pour ce mode, à partir du devis accepté.
 *
 * - `{ ok: true, jalons: null }` — le mode ne fractionne pas (F2) : contrat sans jalon.
 * - `{ ok: false, error: "devis_required" }` — le mode fractionne à partir des lignes du devis
 *   mais la proposition acceptée n'en a pas (mission à prix fixe sans devis). L'appelant
 *   retombe alors sur les jalons saisis à la main, comportement historique.
 */
export function deriveJalons(
  mode: FinancingModeDescriptor,
  devis: DevisData | null,
  prixContrat: number
): DeriveJalonsResult {
  if (prixContrat <= 0) return { ok: false, error: "prix_contrat_invalide" };

  switch (mode.jalonStrategy) {
    case "none":
      return { ok: true, jalons: null };

    case "halves": {
      // Indépendant du devis : deux moitiés comptables, quel que soit le découpage chiffré.
      const [acompte, solde] = distributeExact([1, 1], prixContrat);
      return {
        ok: true,
        jalons: [
          { titre: "Acompte au démarrage (50 %)", montant: acompte },
          { titre: "Solde à la livraison (50 %)", montant: solde },
        ],
      };
    }

    case "devis_lines": {
      if (!devis || devis.lineItems.length === 0) return { ok: false, error: "devis_required" };
      return { ok: true, jalons: jalonsFromDevisLines(devis, prixContrat) };
    }

    case "equal_split": {
      if (!devis || devis.lineItems.length === 0) return { ok: false, error: "devis_required" };
      // Mêmes intitulés que J1 (le découpage technique reste celui du devis), seuls les
      // montants sont égalisés — c'est exactement ce que décrit le mode.
      const amounts = distributeExact(devis.lineItems.map(() => 1), prixContrat);
      return {
        ok: true,
        jalons: devis.lineItems.map((item, i) => ({
          titre: item.description.trim() || `Jalon ${i + 1}`,
          montant: amounts[i],
        })),
      };
    }
  }
}

// Tout ce que la génération de contrat a besoin de savoir, en un appel : les jalons à créer et
// les deux options à figer sur PrestationContract. La route ne fait plus que persister.
export type ResolvedFinancing = {
  mode: FinancingModeDescriptor;
  jalons: JalonInput[] | null;
  financingMode: "lump_sum" | "progressive";
  jalonsSequential: boolean;
  retentionRate: number;
  fundingGranularity: "per_jalon" | "upfront";
};

export function resolveFinancing(
  mode: FinancingModeDescriptor,
  devis: DevisData | null,
  prixContrat: number
): { ok: true; resolved: ResolvedFinancing } | { ok: false; error: string } {
  const derived = deriveJalons(mode, devis, prixContrat);
  if (!derived.ok) return derived;
  return {
    ok: true,
    resolved: {
      mode,
      jalons: derived.jalons,
      financingMode: mode.primitives.financingMode,
      // `jalonsSequential` n'a aucun effet sans jalon (voir options-gestion-jalons.md §1) :
      // on ne le laisse à vrai que si le mode fractionne réellement.
      jalonsSequential: derived.jalons ? mode.primitives.jalonsSequential : false,
      // Même règle que `jalonsSequential` : une retenue de garantie n'a aucun sens sans jalon.
      // Elle vit de la différence entre « libéré au fil des jalons » et « libéré à la toute
      // fin » ; sur un contrat à libération unique il n'existe pas de « toute fin » distincte
      // à laquelle la rattacher (voir PrestationContract.retentionRate, prisma/schema.prisma).
      retentionRate: derived.jalons ? mode.primitives.retentionRate : 0,
      // Sans jalon, la granularité n'a pas d'objet : il n'y a qu'un financement et qu'une
      // libération, donc rien à « consommer ». Même règle que les deux options ci-dessus.
      fundingGranularity: derived.jalons ? mode.primitives.fundingGranularity : "per_jalon",
    },
  };
}

// ── Consigne de chiffrage adressée au PRESTATAIRE ──────────────────────────────────────────
// Pendant symétrique de `definition`/`recommendation`, qui s'adressent au CLIENT qui choisit.
// Le prestataire, lui, n'a pas besoin de savoir pourquoi le mode est recommandé : il a besoin
// de savoir COMMENT chiffrer, et ce qui déclenchera son paiement. C'est la raison même pour
// laquelle le mode est choisi à la publication (voir l'en-tête de ce fichier) — sans ce texte
// côté prestataire, le déplacement du choix en amont ne servirait à rien.
//
// Dérivé de `jalonStrategy` + `primitives`, jamais écrit à la main par mode : un mode ajouté
// au catalogue hérite automatiquement de la bonne consigne, et un texte ne peut pas se
// désynchroniser du comportement réel de `deriveJalons`.
export type FinancingModeBrief = {
  // Ce que le mode attend du devis — la seule phrase à lire avant de chiffrer.
  headline: string;
  // Ce qui déclenchera les libérations, une conséquence par levier réellement actif.
  points: string[];
};

/**
 * @param quoteMode  Mission en mode devis (`Mission.budgetType === "QUOTE"`). En prix fixe il
 *                   n'y a aucune ligne à dériver : le découpage vient du formulaire du client
 *                   à la génération du contrat (`devis_required`, voir `deriveJalons`), seul
 *                   le RÉGIME du mode s'applique. Le dire, plutôt que promettre au prestataire
 *                   un découpage dont son montant unique ne décidera pas.
 */
export function providerBrief(
  mode: FinancingModeDescriptor,
  { quoteMode }: { quoteMode: boolean }
): FinancingModeBrief {
  const derivesFromLines = mode.jalonStrategy === "devis_lines" || mode.jalonStrategy === "equal_split";

  let headline: string;
  if (derivesFromLines && !quoteMode) {
    headline =
      "Chiffrez un montant global : le client détaillera lui-même les jalons à la génération du contrat.";
  } else {
    switch (mode.jalonStrategy) {
      case "devis_lines":
        headline =
          "Découpez votre devis en postes réellement livrables un à un : chaque ligne deviendra un jalon payé séparément.";
        break;
      case "equal_split":
        headline =
          "Vos lignes fixent le nombre de jalons, pas leur montant : ils seront tous égaux, quel que soit le poids réel de chaque poste.";
        break;
      case "halves":
        headline =
          "Chiffrez un prix unique : le paiement sera découpé en deux moitiés (acompte au démarrage, solde à la livraison), quel que soit votre découpage.";
        break;
      case "none":
        headline =
          "Chiffrez un prix unique : il sera séquestré en une seule fois et libéré à la fin, après validation des preuves.";
        break;
    }
  }

  const points: string[] = [];
  // Consigne propre aux contrats au temps : ce que le prestataire doit savoir avant d'accepter
  // n'est pas « comment découper », mais que sa rémunération dépendra de relevés VALIDÉS par le
  // client — et que le plafond est séquestré d'avance, donc garanti.
  if (mode.family === "temps") {
    return {
      headline:
        "Convenez d'un tarif et d'un plafond : le client séquestre le plafond entier avant le démarrage, et chaque relevé de présence validé vous en libère la part correspondante.",
      points: [
        "Un relevé validé = une libération : vous êtes payé au fil des périodes travaillées, jamais à la fin seulement.",
        "Un relevé ne paie rien par lui-même : il doit être validé par le client. C'est sa validation, pas votre déclaration, qui déclenche le versement.",
        "Le plafond est séquestré dès le départ : vous ne travaillez jamais sur des fonds qui ne sont pas déjà bloqués.",
      ],
    };
  }

  const fractionne = mode.primitives.useJalons && !(derivesFromLines && !quoteMode);
  points.push(
    fractionne
      ? "Un jalon = une preuve = une libération : vous êtes payé au fur et à mesure des validations."
      : "Un seul séquestre et une seule libération, après validation des preuves de fin de mission."
  );
  if (mode.primitives.financingMode === "progressive") {
    points.push(
      "Chaque palier de progression confirmé par le client libère sa part : vous n'attendez pas la fin du jalon pour encaisser."
    );
  }
  if (fractionne && mode.primitives.jalonsSequential) {
    points.push(
      "Les jalons se financent dans l'ordre : le suivant n'est séquestré qu'une fois le précédent validé."
    );
  }
  // Le §8 est une garantie pour le PRESTATAIRE avant d'être une commodité pour le client : la
  // totalité est séquestrée dès le départ, et non lot par lot au fil de la bonne volonté du
  // client. C'est l'information qui change sa décision de chiffrer, donc elle a sa place ici.
  if (fractionne && mode.primitives.fundingGranularity === "upfront") {
    points.push(
      "Le client séquestre la TOTALITÉ dès le départ, en une seule fois : chaque poste validé consomme ce séquestre. Vous n'avez jamais à attendre qu'il finance le poste suivant."
    );
  }
  if (fractionne && mode.primitives.retentionRate > 0) {
    points.push(
      `Retenue de garantie : ${Math.round(mode.primitives.retentionRate * 100)} % de chaque jalon restent au séquestre et vous sont versés en une seule fois à la validation du dernier jalon. Votre devis doit comporter au moins deux postes — sur un poste unique la retenue n'aurait rien à garantir, et le contrat serait refusé.`
    );
  }
  return { headline, points };
}
