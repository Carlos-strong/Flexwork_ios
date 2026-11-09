// Devises de la plateforme — source unique (2026-09-23).
//
// La même liste de quatre devises était recopiée à l'identique dans `MissionWizard.tsx` et
// `client-profile-form.tsx`, et le profil prestataire a besoin de la même. Trois copies, ce
// sont trois endroits où ajouter une devise — et deux qui l'oublieront. La liste vit donc ici,
// les écrans la lisent.
//
// XOF reste la devise par défaut partout : c'est celle de la zone couverte (BJ, TG, SN, CI,
// BF, NE). NGN pour le Nigeria, EUR/USD pour un donneur d'ordre qui facture hors zone.

export type CurrencyOption = { value: string; label: string };

export const CURRENCIES: CurrencyOption[] = [
  { value: "XOF", label: "F CFA (XOF)" },
  { value: "NGN", label: "Naira (NGN)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "Dollar (USD)" },
];

// `as const` pour que `z.enum(CURRENCY_VALUES)` produise une union littérale : une liste
// typée `string[]` donnerait un `string` que Prisma refuse là où une colonne est un enum.
export const CURRENCY_VALUES = ["XOF", "NGN", "EUR", "USD"] as const;

export const DEFAULT_CURRENCY = "XOF";

/** Libellé lisible d'une devise — replie sur le code lui-même si elle sort du catalogue. */
export function currencyLabel(value?: string | null): string {
  if (!value) return "F CFA (XOF)";
  return CURRENCIES.find((c) => c.value === value)?.label ?? value;
}
