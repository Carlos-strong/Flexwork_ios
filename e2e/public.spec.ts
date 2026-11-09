import { expect, test } from "@playwright/test";

// A — Visiteur et pages publiques (PLAN_TESTS_GLOBAL.md).

const PAGES_PUBLIQUES = ["/a-propos", "/comment-ca-marche", "/confiance", "/tarifs", "/faq", "/contact", "/cgu", "/confidentialite"];

test.describe("A — visiteur", () => {
  test("A-02 chaque page publique s'affiche", async ({ page }) => {
    for (const path of PAGES_PUBLIQUES) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator("h1").first(), path).toBeVisible();
    }
  });

  test("A-02 aucun lien interne mort dans le pied de page", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("footer a[href^='/']")
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });

  test("A-06 une page protégée renvoie vers /signin sans session", async ({ page }) => {
    await page.goto("/client/dashboard");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("A-07 /api/health répond 200, base joignable", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ db: "ok" });
  });
});
