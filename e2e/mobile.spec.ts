import { expect, test, type Page } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { signedFixedContract } from "./support/contracts";
import { publishMission } from "./support/missions";

// V-01 — Parcours client et prestataire sur mobile, 375 px (PLAN_TESTS_GLOBAL.md). Joué par le
// projet `mobile` de playwright.config.ts (Pixel 7 ramené à 375 × 812).
//
// Deux critères, page par page :
// - aucun débordement horizontal : la page ne défile pas de côté ;
// - boutons accessibles : chaque bouton visible tient dans la largeur de l'écran et offre une
//   cible tactile d'au moins 24 × 24 px (WCAG 2.2, critère 2.5.8).

type Fautif = { el: string; left: number; right: number; width?: number; height?: number };

/** Éléments qui dépassent du bord droit (ou gauche) de l'écran — pour un message d'échec lisible. */
async function debordements(page: Page): Promise<{ scrollWidth: number; clientWidth: number; fautifs: Fautif[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const decrire = (e: Element) => {
      const id = e.id ? `#${e.id}` : "";
      const cls = typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${e.tagName.toLowerCase()}${id}${cls}`;
    };
    // Un élément dont un ancêtre coupe ou fait défiler son contenu (overflow ≠ visible) ne
    // déborde pas de la page : c'est le cas voulu des carrousels et des tableaux défilants.
    const contenu = (e: Element) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.position === "fixed") return true;
      }
      return false;
    };
    const fautifs = [...document.body.querySelectorAll("*")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (getComputedStyle(e).visibility === "hidden") return false;
        return (r.right > vw + 1 || r.left < -1) && !contenu(e);
      })
      .slice(0, 8)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { el: decrire(e), left: Math.round(r.left), right: Math.round(r.right) };
      });
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, fautifs };
  });
}

/** Boutons visibles hors de l'écran ou trop petits pour un doigt. */
async function boutonsInaccessibles(page: Page): Promise<Fautif[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("button, [role='button'], input[type='submit']")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(e);
        if (s.visibility === "hidden" || s.display === "none") return false;
        // Cible dans une phrase (« Commencez par l'onglet Domaines… ») : exemptée de la taille
        // minimale par WCAG 2.5.8, sa hauteur est celle de la ligne de texte.
        const enLigne = [...(e.parentElement?.childNodes ?? [])].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
        const tropPetit = !enLigne && (r.width < 24 || r.height < 24);
        // Bouton dans une zone qui défile de côté : atteignable par défilement. Une zone qui
        // COUPE (overflow hidden) ne l'exempte pas : le bouton coupé est perdu.
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return tropPetit;
        }
        return r.left < -1 || r.right > vw + 1 || tropPetit;
      })
      .slice(0, 8)
      .map((e) => {
        const r = e.getBoundingClientRect();
        const nom = (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40);
        return { el: `${e.tagName.toLowerCase()} « ${nom} »`, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      });
  });
}

async function verifierPage(page: Page, path: string, pret?: () => Promise<void>) {
  await test.step(path, async () => {
    const res = await page.goto(path);
    expect(res?.status() ?? 200, path).toBeLessThan(400);
    if (pret) await pret();
    else await expect(page.locator("main, h1, h2").first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    const d = await debordements(page);
    expect.soft(d.scrollWidth, `${path} défile de côté — ${JSON.stringify(d.fautifs)}`).toBeLessThanOrEqual(d.clientWidth);
    const b = await boutonsInaccessibles(page);
    expect.soft(b, `${path} — boutons hors écran ou trop petits`).toEqual([]);
  });
}

test.describe("V-01 — mobile 375 px", () => {
  test("visiteur : accueil, inscription, connexion", async ({ page }) => {
    for (const path of ["/", "/signup", "/signin", "/recherche"]) await verifierPage(page, path);
  });

  test("client : tableau de bord, publication, mission, paiement", async ({ page }) => {
    const client = await createUser({ label: "climobile" });
    const presta = await createUser({ label: "premobile", role: "expert_digital", payout: "verifie" });
    const { mission } = await signedFixedContract(client.id, presta.id);

    await login(page, client);
    await verifierPage(page, "/client/dashboard");
    await test.step("menu latéral : s'ouvre, tient dans l'écran, se referme", async () => {
      const fermer = page.getByRole("button", { name: "Fermer le menu" });
      await expect(fermer).toBeHidden();
      await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      await expect(fermer).toBeVisible();
      await expect(fermer).toBeInViewport();
      // Le tiroir glisse en 300 ms : la mesure attend la fin du mouvement.
      await expect.poll(() => boutonsInaccessibles(page)).toEqual([]);
      await fermer.click();
      await expect(fermer).toBeHidden();
    });
    await verifierPage(page, "/missions/new");
    await verifierPage(page, `/missions/${mission.id}`);
    await verifierPage(page, `/missions/${mission.id}/escrow`, () =>
      expect(page.getByRole("button", { name: "Payer et séquestrer les fonds" })).toBeVisible()
    );
    await verifierPage(page, "/profile/client");
  });

  test("prestataire : tableau de bord, missions, fiche mission, KYC, profil", async ({ page }) => {
    const client = await createUser({ label: "climob2" });
    const presta = await createUser({ label: "premob2", role: "expert_digital", payout: "verifie" });
    await login(page, client);
    const mission = await publishMission(page);

    await page.context().clearCookies();
    await login(page, presta);
    await verifierPage(page, "/dashboard/expert-digital");
    await verifierPage(page, "/dashboard/expert-digital/missions");
    await verifierPage(page, `/missions/${mission.id}`);
    await verifierPage(page, "/kyc");
    await verifierPage(page, "/kyc/financier");
    await verifierPage(page, "/profile");
  });
});
