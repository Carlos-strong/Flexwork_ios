import { describe, expect, it } from "vitest";
import { safeCallbackUrl, withCallbackUrl } from "@/lib/safe-callback";
import { publishedAgo } from "@/lib/latest-missions";

describe("destination après connexion (callbackUrl)", () => {
  it("accepte un chemin interne, requête comprise", () => {
    expect(safeCallbackUrl("/missions/abc")).toBe("/missions/abc");
    expect(safeCallbackUrl("/recherche?metier=m1")).toBe("/recherche?metier=m1");
  });

  it("refuse toute destination hors du site : redirection ouverte", () => {
    for (const v of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com"]) {
      expect(safeCallbackUrl(v), v).toBeNull();
    }
  });

  it("refuse les pages d'authentification (boucle) et l'absence de valeur", () => {
    for (const v of ["/signin", "/signin?callbackUrl=/x", "/verify-otp?identifier=a", "/signup", "", null, undefined]) {
      expect(safeCallbackUrl(v), String(v)).toBeNull();
    }
  });
});

describe("relais de la destination d'un écran d'authentification au suivant", () => {
  it("ajoute la destination encodée, en ? ou en &", () => {
    expect(withCallbackUrl("/signup", "/missions/m1?candidater=1")).toBe("/signup?callbackUrl=%2Fmissions%2Fm1%3Fcandidater%3D1");
    expect(withCallbackUrl("/verify-otp?purpose=signup", "/client/offres?gig=g1")).toBe("/verify-otp?purpose=signup&callbackUrl=%2Fclient%2Foffres%3Fgig%3Dg1");
    expect(withCallbackUrl("/devenir-prestataire", "/missions/m1", "returnTo")).toBe("/devenir-prestataire?returnTo=%2Fmissions%2Fm1");
  });

  it("laisse le chemin intact si la destination est absente ou hors du site", () => {
    expect(withCallbackUrl("/signup", null)).toBe("/signup");
    expect(withCallbackUrl("/signup", "//evil.com")).toBe("/signup");
  });
});

describe("ancienneté d'une mission publiée", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const ago = (ms: number) => publishedAgo(new Date(now.getTime() - ms), now);

  it("se lit en français, à l'unité la plus parlante", () => {
    expect(ago(10_000)).toBe("à l'instant");
    expect(ago(5 * 60_000)).toBe("il y a 5 minutes");
    expect(ago(3 * 3_600_000)).toBe("il y a 3 heures");
    expect(ago(24 * 3_600_000)).toBe("hier");
    expect(ago(14 * 86_400_000)).toBe("il y a 2 semaines");
    expect(ago(60 * 86_400_000)).toBe("il y a 2 mois");
  });
});
