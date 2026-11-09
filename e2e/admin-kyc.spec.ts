import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";
import { uploadIdentityDocs } from "./support/files";

// Q-02 — ADM-K : files identité, clients, prestataires, badges, versements, historique
// (PLAN_TESTS_GLOBAL.md). Les décisions elles-mêmes sont jouées en D-01 → D-07 et C-07 ; ici, la
// répartition des files et la journalisation.

test.describe("Q-02 — Admin KYC", () => {
  test("chaque file s'ouvre, et un dossier n'apparaît que dans la sienne", async ({ page }) => {
    const client = await createUser({ label: "qclient", role: "client", kycStatus: "en_attente" });
    const presta = await createUser({ label: "qpresta", role: "artisan", kycStatus: "en_attente" });
    for (const u of [client, presta]) {
      await login(page, u);
      await uploadIdentityDocs(page);
      await logout(page);
    }

    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    for (const path of ["/admin/kyc", "/admin/kyc/entreprises", "/admin/kyc/freelances", "/admin/kyc/badges", "/admin/kyc/versements", "/admin/kyc/historique"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByText("Application error"), path).toHaveCount(0);
    }

    await page.goto("/admin/kyc/entreprises");
    await expect(page.locator("tr", { hasText: client.email })).toBeVisible();
    await expect(page.locator("tr", { hasText: presta.email })).toHaveCount(0);

    await page.goto("/admin/kyc/freelances");
    await expect(page.locator("tr", { hasText: presta.email })).toBeVisible();
    await expect(page.locator("tr", { hasText: client.email })).toHaveCount(0);
  });

  test("une décision sur pièce est journalisée avec son motif", async ({ page }) => {
    const presta = await createUser({ label: "qjournal", role: "artisan", kycStatus: "en_attente" });
    await login(page, presta);
    await uploadIdentityDocs(page);
    await logout(page);
    const recto = await prisma.kycDocument.findFirstOrThrow({ where: { userId: presta.id, type: "piece_identite_recto" } });

    const admin = await createUser({ label: "admkyc", adminRole: "kyc" });
    await login(page, admin);
    await page.goto("/admin/kyc");
    await page.locator("tr", { hasText: presta.email }).getByRole("button", { name: "Voir les documents" }).click();
    const carte = page.locator("div.border.rounded-xl").filter({ has: page.locator("strong", { hasText: /^Recto$/ }) });
    // Rejeter sans motif : l'écran le demande au lieu d'envoyer.
    await carte.getByRole("button", { name: "Rejeter" }).click();
    await expect(page.getByText(/⚠️ Motif de rejet obligatoire/).first()).toBeVisible();
    expect((await prisma.kycDocument.findUniqueOrThrow({ where: { id: recto.id } })).status).toBe("en_attente");
    await carte.getByPlaceholder(/Motif de rejet/).fill("Pièce expirée");
    await carte.getByRole("button", { name: "Rejeter" }).click();
    await expect(carte.getByText("Rejeté", { exact: true })).toBeVisible();

    expect(await prisma.adminAuditLog.findFirst({ where: { targetId: recto.id, adminId: admin.id } })).not.toBeNull();
    expect(await prisma.kycDocument.findUniqueOrThrow({ where: { id: recto.id } })).toMatchObject({
      status: "rejete",
      rejectionReason: "Pièce expirée",
      reviewedById: admin.id,
    });
  });
});
