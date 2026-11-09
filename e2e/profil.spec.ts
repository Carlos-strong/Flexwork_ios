import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";

// C — Profils et badge ; P — compte à double rôle (PLAN_TESTS_GLOBAL.md).

test.describe("C — badge « Vérifié »", () => {
  test("C-07 la demande part en file Admin KYC, le badge s'affiche une fois accordé", async ({ page }) => {
    const user = await createUser({ label: "badge", role: "artisan" });
    await prisma.profile.create({ data: { userId: user.id, label: "Principal", isDefault: true, mainDomain: "Électricité" } });
    await login(page, user);
    // Diplôme d'État déclaré par l'API de /declarations : le pivot du badge.
    const decl = await page.request.post("/api/declarations", {
      data: {
        declarationType: "qualification",
        diplomes: [{ qualificationName: "BTS Électrotechnique", year: 2018, institution: "LTI Cotonou", isStateIssued: true }],
      },
    });
    expect(decl.ok()).toBe(true);

    await page.goto("/badge");
    await expect(page.getByText("— Non demandé")).toBeVisible();
    await page.getByRole("button", { name: "Demander le badge" }).click();
    await expect(page.getByText("⏳ En attente d'instruction")).toBeVisible();

    await logout(page);
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await page.goto("/admin/kyc/badges");
    const row = page.locator("tr", { hasText: user.email });
    await expect(row).toContainText("BTS Électrotechnique");
    await row.getByRole("button", { name: "Accorder" }).click();
    await expect(row).toBeHidden();

    await logout(page);
    await login(page, user);
    await page.goto("/badge");
    await expect(page.getByText("✅ Badge accordé")).toBeVisible();
  });

  test("C-07 sans diplôme d'État, la demande n'est pas recevable", async ({ page }) => {
    const user = await createUser({ label: "badgeko", role: "artisan" });
    await prisma.profile.create({ data: { userId: user.id, label: "Principal", isDefault: true, mainDomain: "Plomberie" } });
    await login(page, user);
    await page.goto("/badge");
    await expect(page.getByText(/Il manque un/)).toBeVisible();
    // Le bouton n'est pas proposé : il n'y a rien à instruire.
    await expect(page.getByRole("button", { name: "Demander le badge" })).toHaveCount(0);
  });
});

test.describe("P — double rôle", () => {
  test("P-04 un client devenu prestataire garde ses deux tableaux de bord", async ({ page }) => {
    const user = await createUser({ label: "dual", role: "artisan", isProvider: true });
    await prisma.profile.create({ data: { userId: user.id, label: "Principal", isDefault: true, mainDomain: "Maçonnerie" } });
    await login(page, user);

    for (const path of ["/client/dashboard", "/dashboard/artisan"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page, path).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expect(page.getByText("Application error"), path).toHaveCount(0);
      await expect(page.locator("main, [role=main], h1").first(), path).toBeVisible();
    }
  });
});
