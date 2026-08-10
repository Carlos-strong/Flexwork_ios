// US-1312 : alerte sur les transactions anormales entre deux mêmes comptes (même device,
// montants ronds répétés), pour prévenir la collusion/blanchiment. Pas d'IP trackée en
// local (pas d'infra edge) — l'empreinte device (US-1308) sert de proxy.
const MIN_ROUND_TRANSACTIONS = 3;

export function isRoundAmount(montant: number): boolean {
  return montant % 1000 === 0;
}

export function detectCollusionSuspicion(
  transactions: { montant: number; payerDeviceFingerprint: string | null; payeeDeviceFingerprint: string | null }[]
): boolean {
  const roundCount = transactions.filter((t) => isRoundAmount(t.montant)).length;
  const sameDevice =
    transactions.length > 0 &&
    transactions.every(
      (t) =>
        t.payerDeviceFingerprint !== null &&
        t.payerDeviceFingerprint === t.payeeDeviceFingerprint
    );

  return sameDevice && roundCount >= MIN_ROUND_TRANSACTIONS;
}
