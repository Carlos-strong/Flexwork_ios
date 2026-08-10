// US-1301 — détecte dans le chat les numéros de téléphone et mentions de paiement direct,
// pour prévenir la fuite hors plateforme. Le message est bloqué à l'envoi (pas seulement loggé),
// car une fois transmis l'information a déjà fuité.
const PHONE_REGEX = /(\+?\d[\d\s.-]{7,}\d)/;
const PAYMENT_KEYWORDS = [
  "mobile money",
  "orange money",
  "wave",
  "mtn money",
  "moov money",
  "whatsapp",
  "virement",
  "paypal",
  "western union",
];

export function containsLeakageAttempt(content: string): boolean {
  const lower = content.toLowerCase();
  if (PHONE_REGEX.test(content)) return true;
  return PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}
