// Messages de l'écran /verify-otp (2026-11-09) — un par motif d'échec, chacun avec l'action
// qui débloque l'utilisateur. Le code vient de `authorize` (src/auth.ts, OtpSigninError) via
// signIn(...).code ; « network » et « server » sont produits par l'écran lui-même.

export type OtpScreenError =
  | "invalid_code"
  | "expired"
  | "too_many_attempts"
  | "no_pending_otp"
  | "account_not_found"
  | "account_inactive"
  | "invalid_request"
  | "network"
  | "server";

export type OtpErrorView = {
  message: string;
  /** Le renvoi d'un code est la seule issue : on le rend disponible tout de suite. */
  resendNow: boolean;
  /** Proposer « Créer un compte » (aucun compte pour cet identifiant, en connexion). */
  offerSignup: boolean;
};

const KNOWN = new Set<OtpScreenError>([
  "invalid_code",
  "expired",
  "too_many_attempts",
  "no_pending_otp",
  "account_not_found",
  "account_inactive",
  "invalid_request",
  "network",
  "server",
]);

/**
 * Traduit le résultat de signIn("otp") en motif d'écran. Auth.js renvoie `error` =
 * "CredentialsSignin" et `code` = notre motif pour un refus ; toute autre `error`
 * (ex. « Configuration ») est une panne serveur.
 */
export function otpScreenError(result: { error?: string | null; code?: string | null } | undefined | null): OtpScreenError {
  if (!result) return "server";
  if (result.error === "CredentialsSignin" && result.code && KNOWN.has(result.code as OtpScreenError)) {
    return result.code as OtpScreenError;
  }
  return result.error === "CredentialsSignin" ? "invalid_code" : "server";
}

export function otpErrorView(error: OtpScreenError, purpose: "login" | "signup"): OtpErrorView {
  switch (error) {
    case "invalid_code":
      return {
        message: "Code incorrect. Vérifiez les six chiffres reçus par email. Au bout de 5 essais, il faudra demander un nouveau code.",
        resendNow: false,
        offerSignup: false,
      };
    case "expired":
      return { message: "Ce code a expiré (validité : 5 minutes). Demandez-en un nouveau.", resendNow: true, offerSignup: false };
    case "too_many_attempts":
      return {
        message: "Trop d'essais avec ce code : il est bloqué. Demandez un nouveau code.",
        resendNow: true,
        offerSignup: false,
      };
    case "no_pending_otp":
      return { message: "Aucun code en attente pour ce compte. Demandez un nouveau code.", resendNow: true, offerSignup: false };
    case "account_not_found":
      return {
        message: "Aucun compte n'est associé à cet identifiant.",
        resendNow: false,
        offerSignup: purpose === "login",
      };
    case "account_inactive":
      return { message: "Ce compte est désactivé. Contactez le support.", resendNow: false, offerSignup: false };
    case "invalid_request":
      return { message: "Saisissez les six chiffres du code reçu.", resendNow: false, offerSignup: false };
    case "network":
      return {
        message: "Connexion au serveur impossible. Vérifiez votre réseau, puis réessayez.",
        resendNow: false,
        offerSignup: false,
      };
    case "server":
      return { message: "Une erreur est survenue. Réessayez dans un instant.", resendNow: false, offerSignup: false };
  }
}

/** Message du renvoi de code (bouton « Renvoyer par email »), succès ou échec. */
export function resendMessage(outcome: { ok: true } | { ok: false; error?: string | null }): { text: string; ok: boolean } {
  if (outcome.ok) return { text: "Un nouveau code a été envoyé.", ok: true };
  switch (outcome.error) {
    case "too_many_requests":
      return { text: "Trop de demandes — réessayez dans quelques minutes.", ok: false };
    case "account_not_found":
      return { text: "Aucun compte n'est associé à cet identifiant.", ok: false };
    case "account_inactive":
      return { text: "Ce compte est désactivé. Contactez le support.", ok: false };
    case "network":
      return { text: "Connexion au serveur impossible. Vérifiez votre réseau, puis réessayez.", ok: false };
    default:
      return { text: "Le code n'a pas pu être envoyé. Réessayez.", ok: false };
  }
}
