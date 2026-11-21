"use client";

// Déconnexion (2026-11-09) — un seul chemin pour tous les boutons « Déconnexion ».
//
// Constaté : depuis /profil/[id], l'utilisateur croyait rester sur la page après
// « Déconnexion ». `signOut()` de next-auth/react enchaîne trois allers-retours (jeton CSRF,
// POST /signout, puis la navigation), et diffuse la fin de session AVANT de naviguer : la page
// courante se redessinait aussitôt en mode visiteur — la fiche publique d'un profil reste
// lisible déconnecté —, sans rien dire, pendant que l'accueil se chargeait. Plusieurs secondes
// en développement : la redirection paraissait ne jamais venir.
//
// Ici :
//   - un voile « Déconnexion en cours… » s'affiche dès le clic (posé sur <body>, hors de
//     React : il survit à la fermeture du menu qui l'a déclenché) ;
//   - la session est fermée côté serveur (révocation, src/lib/session-revocation.ts), sans
//     relecture de session inutile avant de partir ;
//   - la navigation est un `location.replace` : « Précédent » ne ramène pas sur une page
//     de l'espace connecté ;
//   - en cas d'échec réseau, le voile le dit au lieu de rediriger comme si de rien n'était
//     (la session serait restée ouverte).

const OVERLAY_ID = "logout-overlay";

function overlay(text: string, isError = false): HTMLElement {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = OVERLAY_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "assertive");
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(255,255,255,0.85);backdrop-filter:blur(2px);font:600 15px/1.4 var(--font-body),system-ui,sans-serif;";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.color = isError ? "#B91C1C" : "#0A1931";
  return el;
}

export async function logout(redirectTo = "/"): Promise<void> {
  if (document.getElementById(OVERLAY_ID)) return; // déjà en cours (double clic)
  const el = overlay("Déconnexion en cours…");
  try {
    const csrf = await fetch("/api/auth/csrf", { cache: "no-store" });
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const res = await fetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: new URLSearchParams({ csrfToken, callbackUrl: redirectTo }),
    });
    if (!res.ok) throw new Error(`signout ${res.status}`);
  } catch {
    overlay("Déconnexion impossible : vérifiez votre connexion, puis réessayez.", true);
    setTimeout(() => el.remove(), 4000);
    return;
  }
  window.location.replace(redirectTo);
}
