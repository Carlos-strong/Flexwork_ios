import { expect, test, type Page } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";

// Barre de navigation globale et menu du compte (2026-11-09).
//
// La barre est la même sur toutes les pages — y compris celles qui n'en avaient aucune — et
// le sidebar des tableaux de bord est devenu le menu du profil : ses rubriques, selon le rôle,
// « Devis & Contrats », le compte et la déconnexion.
const logo = (page: Page) => page.getByRole("banner").getByRole("link", { name: /Flex\s*Work/ });
const openMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Menu du compte" }).click();
  const menu = page.getByRole("menu", { name: "Menu du compte" });
  await expect(menu).toBeVisible();
  return menu;
};

test.describe("N — barre de navigation et menu du compte", () => {
  test("N-01 la barre est sur toutes les pages, sauf l'authentification", async ({ page }) => {
    for (const path of ["/", "/recherche", "/faq", "/tarifs", "/comment-ca-marche"]) {
      await page.goto(path);
      await expect(logo(page), path).toBeVisible();
      await expect(page.getByRole("banner"), path).toHaveCount(1);
    }
    for (const path of ["/signin", "/signup"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Menu du compte" }), path).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Comment ça marche" }), path).toHaveCount(0);
    }
  });

  test("N-02 prestataire : le menu porte les rubriques de son espace, et y mène", async ({ page }) => {
    test.setTimeout(180_000);
    const presta = await createUser({ label: "navpresta", role: "expert_digital", firstname: "Kofi" });
    await login(page, presta);

    // Pages connectées sans barre avant : profil, KYC, nouvelle mission.
    for (const path of ["/profile", "/kyc", "/missions/new"]) {
      await page.goto(path);
      await expect(logo(page), path).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Menu du compte" }), path).toBeVisible();
    }

    await page.goto("/dashboard/expert-digital");
    // Plus de sidebar : une seule barre, et pas de second bouton « Déconnexion » visible.
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Déconnexion" })).toHaveCount(0);

    const menu = await openMenu(page);
    await expect(menu).toContainText(presta.email);
    for (const name of ["Tableau de bord", "Missions disponibles", "Messages", "Mes candidatures", "Offres", "Wallet", "Mon profil", "Mes devis", "Contrats signés", "Mon profil public", "Déconnexion"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}\\s*(\\d+|99\\+)?$`) }), name).toBeVisible();
    }
    await expect(menu.getByRole("menuitem", { name: /^Tableau de bord/ })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("menuitem", { name: "Administration" })).toHaveCount(0);

    // Échap referme et rend le focus au bouton.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu du compte" })).toBeFocused();

    // Une rubrique s'ouvre depuis le menu, qui se referme et la marque comme active.
    await (await openMenu(page)).getByRole("menuitem", { name: /^Mes candidatures/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/expert-digital\/candidatures$/, { timeout: 30_000 });
    await expect(page.getByRole("menu", { name: "Menu du compte" })).toBeHidden();
    await expect((await openMenu(page)).getByRole("menuitem", { name: /^Mes candidatures/ })).toHaveAttribute("aria-current", "page");
  });

  test("N-03 client et administrateur : les rubriques de leur rôle", async ({ page }) => {
    test.setTimeout(180_000);
    const client = await createUser({ label: "navclient" });
    await login(page, client);
    await page.goto("/client/dashboard");
    let menu = await openMenu(page);
    for (const name of ["Mes Missions", "Propositions", "Paiements", "Espace prestataire"]) {
      await expect(menu.getByRole("menuitem", { name: new RegExp(`^${name}\\s*(\\d+|99\\+)?$`) }), name).toBeVisible();
    }
    await expect(menu.getByRole("menuitem", { name: /^Missions disponibles/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Mes devis" })).toHaveAttribute("href", "/client/devis-contrats?tab=devis&f=tous");

    await page.context().clearCookies();
    const admin = await createUser({ label: "navadmin", adminRole: "superviseur" });
    await login(page, admin);
    await page.goto("/faq");
    menu = await openMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Administration" })).toHaveAttribute("href", "/admin");
  });

  test("N-04 déconnexion depuis une page publique (profil) : message immédiat, puis l'accueil", async ({ page }) => {
    test.setTimeout(180_000);
    const user = await createUser({ label: "navlogout", role: "expert_digital", firstname: "Kofi" });
    await login(page, user);
    await page.goto(`/profil/${user.id}`);
    await page.waitForLoadState("networkidle");

    // Réseau coupé sur la déconnexion : le dire, rester connecté, sur la même page.
    await page.route("**/api/auth/signout", (route) => route.abort("internetdisconnected"));
    await (await openMenu(page)).getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByText("Déconnexion impossible : vérifiez votre connexion, puis réessayez.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/profil/${user.id}$`));
    await expect(page.getByText("Déconnexion impossible")).toBeHidden({ timeout: 10_000 });
    await page.unroute("**/api/auth/signout");

    // Réseau rétabli : voile immédiat, puis l'accueil, déconnecté.
    await (await openMenu(page)).getByRole("menuitem", { name: "Déconnexion" }).click();
    await expect(page.getByText("Déconnexion en cours…")).toBeVisible();
    await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 30_000 });
    await expect(page.getByRole("banner").getByRole("link", { name: "Connexion" })).toBeVisible({ timeout: 30_000 });
    expect(((await (await page.request.get("/api/auth/session")).json()) ?? {}).user ?? null).toBeNull();
  });
});
