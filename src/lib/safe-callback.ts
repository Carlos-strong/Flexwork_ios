// Destination après connexion (`?callbackUrl=`), 2026-11-03 : un visiteur qui ouvre une mission
// depuis l'accueil passe par /signin, puis doit revenir sur CETTE mission plutôt que sur son
// tableau de bord.
//
// Le paramètre vient de l'URL, donc de n'importe qui : seul un chemin INTERNE est accepté.
// « //evil.com » et « /\evil.com » sont lus par les navigateurs comme des adresses d'un autre
// site — la redirection ouverte classique — et sont refusés, comme toute URL absolue.
export function safeCallbackUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Les pages d'authentification elles-mêmes ne sont pas une destination : on y bouclerait.
  if (/^\/(signin|signup|verify-otp)(\/|\?|$)/.test(value)) return null;
  return value;
}

// Ajoute `?callbackUrl=` (ou `&callbackUrl=`) à un chemin, si la destination est sûre. Sert à
// relayer la destination d'origine d'un écran d'authentification au suivant — connexion →
// inscription → code → /bienvenue → /devenir-prestataire — sans la perdre en chemin.
export function withCallbackUrl(path: string, callbackUrl: string | null | undefined, param = "callbackUrl"): string {
  const safe = safeCallbackUrl(callbackUrl);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(safe)}`;
}

// Lit la destination d'origine dans l'URL courante (côté navigateur uniquement).
export function currentCallbackUrl(param = "callbackUrl"): string | null {
  if (typeof window === "undefined") return null;
  return safeCallbackUrl(new URLSearchParams(window.location.search).get(param));
}
