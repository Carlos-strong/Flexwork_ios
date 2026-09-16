// Contrat au TEMPS (modes S2, §9 à §13 du cahier des charges — 2026-09-14) — module FEUILLE,
// pur, sans aucun import de runtime.
//
// ── La règle qui gouverne tout le reste ────────────────────────────────────────────────────
// §9 : « on ne paie jamais directement selon le pointage. Le pointage produit seulement un
// montant exigible, qui doit être couvert par le séquestre. »
//
// Ce fichier calcule donc des MONTANTS, jamais des paiements. Il ne connaît ni le séquestre, ni
// le PSP, ni les payables : il dit ce qu'un relevé validé vaut, et ce que les plafonds
// autorisent. La chaîne qui suit — créance, contrôle de solde, instruction — est celle de tous
// les autres modes, sans rien de particulier (src/lib/spot-time-actions.ts).
//
// C'est ce découpage qui rend le §9 vérifiable : rien ici ne PEUT payer.

export type RateUnit = "hour" | "day" | "month";

export type SpotTimeTerms = {
  rateUnit: RateUnit;
  rate: number;
  /** Plafond de quantité : 20 jours, 200 heures, 1 mois… */
  maxQuantity: number;
  /** Plafond financier. Vaut normalement `rate × maxQuantity` — voir `expectedMaxAmount`. */
  maxAmount: number;
  overtimeAllowed: boolean;
  overtimeRate: number | null;
};

// Arrondi à l'unité, comme partout ailleurs dans la chaîne monétaire : le XOF n'a pas de
// sous-unité en circulation et le PSP refuse une instruction décimale (voir roundAmount,
// src/lib/devis.ts). Une quantité, elle, reste fractionnaire — 7,5 heures est une durée, pas
// de l'argent.
function roundAmount(value: number): number {
  return Math.round(value);
}

/** Plafond financier COHÉRENT avec le tarif et la quantité — celui du §10 : 20 × 7 500. */
export function expectedMaxAmount(terms: Pick<SpotTimeTerms, "rate" | "maxQuantity">): number {
  return roundAmount(terms.rate * terms.maxQuantity);
}

export const RATE_UNIT_LABEL: Record<RateUnit, { one: string; many: string; per: string }> = {
  hour: { one: "heure", many: "heures", per: "heure" },
  day: { one: "jour", many: "jours", per: "jour" },
  month: { one: "mois", many: "mois", per: "mois" },
};

export type TimeTermsResolution =
  | { ok: true; terms: SpotTimeTerms }
  | { ok: false; error: "time_terms_missing" | "invalid_time_rate" };

/**
 * Conditions à figer au contrat d'une mission au temps (2026-09-15).
 *
 * Le PLAFOND est le prix du contrat, et rien d'autre : c'est lui que `requestContractHold`
 * séquestre, et une seconde source de vérité pour le même montant finirait par le contredire.
 * Le tarif est celui proposé par le prestataire ; à défaut (candidature antérieure, ou prix
 * resoumis sans tarif), il se déduit du plafond — les arrondis qui en résultent sont soldés par
 * le dernier relevé (voir `checkCaps`).
 */
export function resolveTimeTerms(args: {
  rateUnit: RateUnit;
  maxQuantity: number | null | undefined;
  unitRate: number | null | undefined;
  contractPrice: number;
}): TimeTermsResolution {
  const maxQuantity = args.maxQuantity ?? 0;
  if (!(maxQuantity > 0)) return { ok: false, error: "time_terms_missing" };
  if (!(args.contractPrice > 0)) return { ok: false, error: "invalid_time_rate" };

  const rate = args.unitRate && args.unitRate > 0 ? args.unitRate : args.contractPrice / maxQuantity;
  return {
    ok: true,
    terms: {
      rateUnit: args.rateUnit,
      rate,
      maxQuantity,
      maxAmount: args.contractPrice,
      overtimeAllowed: false,
      overtimeRate: null,
    },
  };
}

/**
 * Montant d'un relevé VALIDÉ.
 *
 * `overtimeQuantity` est une PART de `approvedQuantity`, pas un supplément : sur 9 heures
 * validées dont 1 supplémentaire, 8 sont payées au tarif normal et 1 au tarif majoré. La compter
 * en plus paierait neuf heures et en facturerait dix.
 *
 * Les heures supplémentaires non autorisées au contrat sont ignorées — payées au tarif normal,
 * jamais refusées : refuser rétroactivement des heures réellement travaillées punirait le
 * prestataire d'une clause qu'il ne maîtrise pas. C'est le contrat qui décide du tarif, pas de
 * la réalité du travail.
 */
export function attendanceAmount(
  terms: Pick<SpotTimeTerms, "rate" | "overtimeAllowed" | "overtimeRate">,
  approvedQuantity: number,
  overtimeQuantity = 0
): number {
  if (!Number.isFinite(approvedQuantity) || approvedQuantity <= 0) return 0;

  const majorable =
    terms.overtimeAllowed && typeof terms.overtimeRate === "number" && terms.overtimeRate > 0;
  const heuresSup = majorable
    ? Math.min(Math.max(0, overtimeQuantity), approvedQuantity)
    : 0;
  const normales = approvedQuantity - heuresSup;

  return roundAmount(normales * terms.rate + heuresSup * (terms.overtimeRate ?? terms.rate));
}

export type CapCheck =
  | { ok: true; amount: number }
  | { ok: false; reason: "quantity_cap_exceeded"; allowed: number }
  | { ok: false; reason: "amount_cap_exceeded"; allowed: number };

/**
 * Le relevé tient-il dans les plafonds du contrat ?
 *
 * Deux plafonds distincts, et deux refus distincts : « vous dépassez les 20 jours convenus »
 * n'est pas « le plafond financier est atteint ». Les confondre donnerait au prestataire un
 * motif faux, et lui ferait chercher un financement là où c'est la durée qui bloque.
 *
 * Ce contrôle est CONTRACTUEL et ne dit rien du séquestre. Un relevé peut tenir dans les
 * plafonds et rester impayable faute de fonds — c'est l'invariant n°4 qui tranche ça, ailleurs
 * et après.
 *
 * @param alreadyApprovedQuantity Cumul des quantités déjà validées sur ce contrat.
 * @param alreadyApprovedAmount   Cumul des montants déjà reconnus dus sur ce contrat.
 */
export function checkCaps(
  terms: SpotTimeTerms,
  approvedQuantity: number,
  overtimeQuantity: number,
  alreadyApprovedQuantity: number,
  alreadyApprovedAmount: number
): CapCheck {
  const quantiteRestante = terms.maxQuantity - alreadyApprovedQuantity;
  if (approvedQuantity > quantiteRestante) {
    return { ok: false, reason: "quantity_cap_exceeded", allowed: Math.max(0, quantiteRestante) };
  }

  const amount = attendanceAmount(terms, approvedQuantity, overtimeQuantity);
  const montantRestant = terms.maxAmount - alreadyApprovedAmount;

  // Le relevé qui ÉPUISE exactement la quantité convenue solde le plafond (2026-09-15). Un tarif
  // dérivé d'un plafond négocié (150 001 sur 20 jours = 7 500,05) s'arrondit relevé par relevé :
  // le cumul peut alors s'écarter du plafond de quelques francs, dans un sens — la dernière
  // journée refusée pour « plafond financier atteint » alors que les 20 jours sont dus — ou dans
  // l'autre — un reliquat de centimes à rembourser. Le dernier relevé absorbe l'écart d'arrondi,
  // et lui seul : la tolérance est bornée par la quantité (au plus un franc d'arrondi par unité),
  // si bien qu'un vrai dépassement — heures supplémentaires, plafond incohérent — reste refusé.
  const epuiseLaQuantite = Math.abs(approvedQuantity - quantiteRestante) < 1e-9;
  if (epuiseLaQuantite && overtimeQuantity <= 0 && Math.abs(amount - montantRestant) <= terms.maxQuantity) {
    return { ok: true, amount: Math.max(0, montantRestant) };
  }

  if (amount > montantRestant) {
    return { ok: false, reason: "amount_cap_exceeded", allowed: Math.max(0, montantRestant) };
  }

  return { ok: true, amount };
}

// ── Seuil d'alerte (§19) ───────────────────────────────────────────────────────────────────
// « Le séquestre disponible ne couvre plus que 4 jours de présence. Veuillez recharger le
// financement. » — prévenir AVANT l'arrêt, plutôt que de laisser le chantier buter sur un refus.
export const LOW_FUNDS_THRESHOLD = 0.2;

export type FundingAlert = {
  /** Unités encore finançables avec le séquestre disponible. */
  remainingUnits: number;
  /** Le disponible passe sous le seuil d'alerte du plafond contractuel. */
  low: boolean;
};

/**
 * Combien d'unités le séquestre disponible couvre-t-il encore ?
 *
 * Arrondi vers le BAS : annoncer « 4 jours » alors que le solde n'en couvre que 3,7 promettrait
 * une journée qui sera refusée. Sur un chantier, cette journée-là est une équipe qui s'est
 * déplacée.
 */
export function fundingAlert(terms: SpotTimeTerms, availableEscrow: number): FundingAlert {
  if (terms.rate <= 0) return { remainingUnits: 0, low: true };
  return {
    remainingUnits: Math.floor(Math.max(0, availableEscrow) / terms.rate),
    low: availableEscrow < terms.maxAmount * LOW_FUNDS_THRESHOLD,
  };
}

// ── Périodes ───────────────────────────────────────────────────────────────────────────────
// Un relevé couvre une période, et deux relevés ne peuvent pas couvrir la même (contrainte
// d'unicité en base). Ces helpers normalisent les bornes pour que « le 3 septembre » désigne
// toujours le même intervalle, quelle que soit l'heure à laquelle le relevé est saisi.

export function dayPeriod(date: Date): { periodStart: Date; periodEnd: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { periodStart: start, periodEnd: end };
}

export function monthPeriod(date: Date): { periodStart: Date; periodEnd: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);
  return { periodStart: start, periodEnd: end };
}

/**
 * Deux périodes se chevauchent-elles ?
 *
 * La contrainte d'unicité en base interdit deux relevés aux bornes IDENTIQUES ; elle ne dit rien
 * de deux plages horaires qui se recouvrent partiellement (8h–12h et 10h–14h). Le §5 du prompt
 * S2 interdit explicitement le « chevauchement de présence » — c'est ce que vérifie ceci, et
 * c'est une vérification de code, pas de base : aucune contrainte SQL simple ne l'exprime.
 */
export function periodsOverlap(
  a: { periodStart: Date; periodEnd: Date },
  b: { periodStart: Date; periodEnd: Date }
): boolean {
  return a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
}
