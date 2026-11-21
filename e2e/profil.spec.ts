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

// Onglet Expérience en étapes (2026-11-09) : chaque rubrique est validée avant la suivante,
// jusqu'à la validation de la section, qui ouvre l'étape suivante du profil.
test.describe("X — onglet Expérience en étapes", () => {
  test("X-01 niveau → expériences → diplômes → portfolio → garants → validation", async ({ page }) => {
    test.setTimeout(240_000);
    const user = await createUser({ label: "xpsteps", role: "artisan" });
    const profile = await prisma.profile.create({ data: { userId: user.id, label: "Principal", isDefault: true, mainDomain: "Électricité" } });
    await login(page, user);
    await page.goto("/profile?tab=experience");

    const steps = page.getByRole("list", { name: "Étapes de l'expérience" });
    await expect(steps).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Étape 1 sur 6")).toBeVisible();
    // Les étapes après une étape obligatoire non faite sont verrouillées.
    await expect(steps.getByRole("button", { name: /Diplômes/ })).toBeDisabled();
    await expect(steps.getByRole("button", { name: /Validation/ })).toBeDisabled();

    // 1. Niveau : les années sont exigées (0 accepté).
    await page.getByLabel("Niveau professionnel").selectOption("senior");
    await page.getByRole("button", { name: /Enregistrer et continuer/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Indiquez vos années d'expérience" })).toBeVisible();
    await expect(page.getByText("Étape 1 sur 6")).toBeVisible();
    await page.getByLabel("Années d'expérience").fill("4");
    await page.getByRole("button", { name: /Enregistrer et continuer/ }).click();

    // 2. Expériences : « Continuer » bloqué tant qu'aucune n'est déclarée.
    await expect(page.getByText("Étape 2 sur 6")).toBeVisible({ timeout: 30_000 });
    const continuer = page.getByRole("button", { name: "Suivant : Diplômes →" });
    await expect(continuer).toBeDisabled();
    await expect(page.getByText("Déclarez au moins une expérience professionnelle.")).toBeVisible();
    await page.getByLabel("Poste").fill("Électricien bâtiment");
    await page.getByRole("button", { name: "Ajouter l'expérience" }).click();
    await expect(page.getByText(/Expérience déclarée et horodatée/)).toBeVisible({ timeout: 30_000 });
    await continuer.click();

    // 3. Diplômes : une certification suffit.
    await expect(page.getByText("Étape 3 sur 6")).toBeVisible();
    await expect(page.getByRole("button", { name: "Suivant : Portfolio et CV →" })).toBeDisabled();
    await page.locator("label", { hasText: "Certification" }).click();
    await page.getByLabel("Intitulé de la certification").fill("Habilitation électrique B1V");
    await page.getByRole("button", { name: "Ajouter ce titre" }).click();
    await expect(page.getByText("Diplôme déclaré et horodaté.")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Suivant : Portfolio et CV →" }).click();

    // 4–5. Portfolio et garants : facultatifs (garant non exigé pour ce compte).
    await expect(page.getByText("Étape 4 sur 6")).toBeVisible();
    await page.getByRole("button", { name: "Passer : Garants →" }).click();
    await expect(page.getByText("Étape 5 sur 6")).toBeVisible();
    await page.getByRole("button", { name: "Passer : Validation →" }).click();

    // 6. Validation : tout l'obligatoire est fait.
    await expect(page.getByText("Étape 6 sur 6")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Toutes les rubriques obligatoires sont complètes." })).toBeVisible();
    await page.getByRole("button", { name: "Valider la section Expérience" }).click();
    // Le profil passe à son étape suivante.
    await expect(page.getByText(/Expérience : enregistré\. Étape suivante/)).toBeVisible({ timeout: 30_000 });

    const saved = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(saved).toMatchObject({ declaredLevel: "senior", declaredExperienceYears: 4 });

    // Reprise : la section étant complète, l'onglet rouvre sur la validation.
    await page.goto("/profile?tab=experience");
    await expect(page.getByText("Étape 6 sur 6")).toBeVisible({ timeout: 30_000 });
  });

  test("X-02 garant exigé par l'administration : la section ne se valide pas sans lui", async ({ page }) => {
    test.setTimeout(180_000);
    const user = await createUser({ label: "xpgarant", role: "artisan" });
    await prisma.user.update({ where: { id: user.id }, data: { garantRequired: true } });
    const profile = await prisma.profile.create({
      data: { userId: user.id, label: "Principal", isDefault: true, mainDomain: "Plomberie", declaredLevel: "senior", declaredExperienceYears: 6 },
    });
    // Expérience et diplôme déjà déclarés : seule l'étape des garants manque.
    await login(page, user);
    for (const body of [
      { declarationType: "experience", profileId: profile.id, experiences: [{ id: 1, clientType: "INDIVIDUAL", role: "Plombier" }] },
      { declarationType: "qualification", profileId: profile.id, diplomes: [{ qualificationName: "CAP Plomberie", isStateIssued: true }] },
    ]) {
      const res = await page.request.post("/api/declarations", { data: body });
      expect(res.ok(), await res.text()).toBe(true);
    }
    await page.goto("/profile?tab=experience");
    // Reprise directe sur l'étape obligatoire manquante.
    await expect(page.getByText("Étape 5 sur 6")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Ajoutez un garant obligatoire : l'administration l'exige pour votre compte.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Étapes de l'expérience" }).getByRole("button", { name: /Validation/ })).toBeDisabled();
    await page.getByLabel("Nom").fill("Koffi Mensah");
    await page.getByLabel("Téléphone").fill("+22997000011");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.getByText("Koffi Mensah")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Suivant : Validation →" }).click();
    await expect(page.getByRole("button", { name: "Valider la section Expérience" })).toBeEnabled();
  });
});

