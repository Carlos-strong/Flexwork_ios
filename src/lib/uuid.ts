// UUID v4 côté NAVIGATEUR. `crypto.randomUUID` n'existe que dans un contexte sécurisé (HTTPS ou
// localhost) : ouverte depuis un mobile sur le réseau local (http://192.168.x.x:3000), la page
// plantait (« crypto.randomUUID is not a function »). `crypto.getRandomValues`, lui, est disponible
// partout ; on en tire le même format v4 (RFC 9562). Côté serveur, `randomUUID` de `crypto` reste
// la bonne source.
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
