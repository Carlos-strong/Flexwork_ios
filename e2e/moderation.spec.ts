import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";

// O — Signalements ; Q-03 — Admin modération (PLAN_TESTS_GLOBAL.md).

async function signaler(page: import("@playwright/test").Page, targetType: string, targetId: string, reason: string) {
  await page.goto("/signalement");
  await page.locator("select").first().selectOption(targetType);
  await page.getByPlaceholder("ID de la déclaration, du profil ou de la mission").fill(targetId);
  await page.getByPlaceholder(/Décrivez précisément/).fill(reason);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Signalement envoyé" })).toBeVisible();
}

test.describe("O — signalements", () => {
  test("O-03 signaler un profil : entrée en file modération, aucune sanction automatique", async ({ page }) => {
    const cible = await createUser({ label: "signale", role: "artisan" });
    const profil = await prisma.profile.create({ data: { userId: cible.id, label: "Principal", isDefault: true, mainDomain: "Menuiserie" } });
    const auteur = await createUser({ label: "signaleur" });
    const motif = `Photos de chantier copiées d'un autre site (${Date.now()})`;

    await login(page, auteur);
    await signaler(page, "profile", profil.id, motif);

    const report = await prisma.report.findFirstOrThrow({ where: { reason: motif } });
    expect(report).toMatchObject({ targetType: "profile", targetId: profil.id, status: "ouvert", reporterId: auteur.id });
    // Rien n'a bougé côté cible : le signalement n'est qu'une demande de revue.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: cible.id } })).toMatchObject({ status: "active" });

    await logout(page);
    await login(page, await createUser({ label: "admmod", adminRole: "moderation" }));
    await page.goto("/admin/reports");
    await expect(page.locator("tr", { hasText: motif })).toBeVisible();
  });

  test("O-04 l'Admin modération retient un signalement : décision journalisée", async ({ page }) => {
    const auteur = await createUser({ label: "signaleur" });
    const motif = `Avis rédigé par le prestataire lui-même (${Date.now()})`;
    await login(page, auteur);
    await signaler(page, "review", "avis-inexistant", motif);
    const report = await prisma.report.findFirstOrThrow({ where: { reason: motif } });
    await logout(page);

    const admin = await createUser({ label: "admmod", adminRole: "moderation" });
    await login(page, admin);
    await page.goto("/admin/reports");
    await page.locator("tr", { hasText: motif }).getByRole("button", { name: "Retenir" }).click();
    const enregistrer = page.getByRole("button", { name: "Enregistrer" });
    await page.getByPlaceholder(/Motif \(10 caractères au moins\)/).fill("court");
    await expect(enregistrer).toBeDisabled();
    await page.getByPlaceholder(/Motif \(10 caractères au moins\)/).fill("Avis suspendu le temps de l'enquête");
    await enregistrer.click();

    await expect.poll(async () => (await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe("retenu");
    expect(await prisma.adminAuditLog.findFirst({ where: { targetId: report.id, adminId: admin.id } })).toMatchObject({
      action: "report_upheld",
      justification: "Avis suspendu le temps de l'enquête",
    });
  });

  test("O-04 classer sans suite", async ({ page }) => {
    const motif = `Signalement infondé pour test (${Date.now()})`;
    const report = await prisma.report.create({ data: { targetType: "mission", reason: motif } });
    const admin = await createUser({ label: "admmod", adminRole: "moderation" });
    await login(page, admin);
    await page.goto("/admin/reports");
    await page.locator("tr", { hasText: motif }).getByRole("button", { name: "Classer" }).click();
    await page.getByPlaceholder(/Motif \(10 caractères au moins\)/).fill("Contenu conforme après vérification");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(async () => (await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe("classe");
  });
});

test.describe("Q-03 — Admin modération", () => {
  test("retirer une déclaration publiée, avec justification journalisée", async ({ page }) => {
    const presta = await createUser({ label: "declmod", role: "artisan" });
    await prisma.profile.create({ data: { userId: presta.id, label: "Principal", isDefault: true, mainDomain: "Plomberie" } });
    await login(page, presta);
    const res = await page.request.post("/api/declarations", {
      data: { declarationType: "qualification", diplomes: [{ qualificationName: "CAP Plomberie", year: 2015, isStateIssued: true }] },
    });
    expect(res.ok()).toBe(true);
    const declarationId = (await res.json()).id as string;
    await logout(page);

    const admin = await createUser({ label: "admmod", adminRole: "moderation" });
    await login(page, admin);
    await page.goto("/admin/reports/declarations");
    await page.locator("tr", { hasText: presta.email }).getByRole("button", { name: /Retirer/ }).click();
    const confirmer = page.getByRole("button", { name: "Retirer la déclaration" });
    await expect(confirmer).toBeDisabled();
    await page.locator("#mod-justification").fill("Diplôme non reconnu par le ministère");
    await confirmer.click();
    await expect(page.locator("tr", { hasText: presta.email })).toContainText("Déjà retirée");

    expect((await prisma.professionalDeclaration.findUniqueOrThrow({ where: { id: declarationId } })).removedAt).not.toBeNull();
    expect(await prisma.adminAuditLog.findFirst({ where: { targetId: declarationId, adminId: admin.id } })).toMatchObject({
      action: "declaration_removed",
    });
  });

  test("un Admin KYC consulte les signalements sans pouvoir décider", async ({ page }) => {
    const motif = `Lecture seule (${Date.now()})`;
    await prisma.report.create({ data: { targetType: "mission", reason: motif } });
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    const res = await page.goto("/admin/reports");
    // Le module n'est pas ouvert au rôle KYC : soit refusé, soit sans aucun bouton de décision.
    if (res && res.status() < 400 && /\/admin\/reports/.test(page.url())) {
      await expect(page.getByRole("button", { name: "Retenir" })).toHaveCount(0);
    }
    const api = await page.request.post(`/api/admin/reports/${(await prisma.report.findFirstOrThrow({ where: { reason: motif } })).id}/decision`, {
      data: { status: "classe", note: "Tentative hors de mon rôle" },
    });
    expect(api.status()).toBeGreaterThanOrEqual(401);
    expect(api.status()).toBeLessThan(500);
  });
});
