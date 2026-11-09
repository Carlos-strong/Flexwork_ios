// Dédoublonnage des requêtes GET identiques EN VOL.
//
// Contexte : plusieurs composants du dashboard lancent le même GET au même moment. Le cas
// le plus coûteux est `/api/dashboard/provider-summary` (≈11 requêtes Prisma par appel),
// chargé à la fois par la page du dashboard, par `useSidebarBadges` et par certaines
// sous-sections (MissionsSection, WalletSection). Mesuré en réel sur /dashboard/expert-digital
// (2026-08-30) : jusqu'à 4 appels simultanés de cet endpoint au montage — une rafale réseau
// + base qui se traduit par une latence perçue comme un « crash » du dashboard.
//
// ⚠️ Un `Response` ne peut être lu (`.json()`/`.text()`) qu'UNE SEULE fois. La première
// version partageait le même objet `Response` entre les appelants → le 2ᵉ consommateur
// levait « Body is disturbed or locked ». Ici la requête RÉSEAU est partagée (une seule en
// vol), mais CHAQUE appelant reçoit son PROPRE `Response`, reconstruit depuis le corps mis
// en mémoire tampon — jamais le même objet.
//
// Sûr car : déduplication uniquement des requêtes simultanées (aucun cache après résolution
// → pas de données périmées, le polling 30s reste intact) ; POST/PATCH/DELETE jamais
// dédupliqués (effets de bord, délégués à fetch).
type BufferedResponse = { status: number; statusText: string; headers: Headers; body: ArrayBuffer };

const inflight = new Map<string, Promise<BufferedResponse>>();

function toResponse(buf: BufferedResponse): Response {
  // Copie du tampon (slice) : chaque Response possède son propre corps, indépendant des
  // autres — lire l'un ne perturbe pas les autres.
  return new Response(buf.body.slice(0), {
    status: buf.status,
    statusText: buf.statusText,
    headers: buf.headers,
  });
}

export function fetchDedupe(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  // POST/PATCH/DELETE/… : jamais dédupliqués (effets de bord) — on délègue à fetch.
  if (method !== "GET") return fetch(input, init);

  const key = String(input);
  const existing = inflight.get(key);
  if (existing) {
    // Même requête déjà en vol : on attend sa réponse et on reconstruit un Response neuf
    // pour cet appelant (jamais l'objet partagé → pas de "Body is disturbed or locked").
    return existing.then(toResponse);
  }

  const promise = (async () => {
    const res = await fetch(input, init);
    // Le corps est mis en mémoire tampon AVANT de résoudre, pour que chaque appelant puisse
    // en faire un Response indépendant. On lit depuis un clone pour laisser `res` intact.
    const body = await res.clone().arrayBuffer();
    return { status: res.status, statusText: res.statusText, headers: res.headers, body };
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  // Le premier appelant reçoit lui aussi un Response neuf (jamais un objet partagé).
  return promise.then(toResponse);
}
