import { expect, test, type Page } from "@playwright/test";
import { createUser, type TestUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";
import { png, uniqueIdNumber, uploadIdentityDocs } from "./support/files";

// D — Vérification d'identité (KYC) et compte de versement (PLAN_TESTS_GLOBAL.md).

const kycStatus = async (u: TestUser) => (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).kycStatus;

/** Compte à l'identité vérifiée PAR un admin, avec ses quatre pièces réellement déposées. */
async function verifiedWithDocs(page: Page, user: TestUser, reviewerId: string) {
  await login(page, user);
  await uploadIdentityDocs(page);
  await logout(page);
  await prisma.kycDocument.updateMany({ where: { userId: user.id }, data: { status: "verifie", reviewedById: reviewerId, reviewedAt: new Date() } });
  await prisma.user.update({ where: { id: user.id }, data: { kycStatus: "verifie", dateNaissance: new Date("1990-05-12") } });
}

/** Ouvre, dans la file Admin KYC, la modale des pièces du compte donné. */
async function openDossier(page: Page, user: TestUser) {
  await page.goto("/admin/kyc");
  const row = page.locator("tr", { hasText: user.email });
  await row.getByRole("button", { name: "Voir les documents" }).click();
  await expect(page.getByText("Chargement des documents…")).toBeHidden();
}

/** Carte d'une pièce dans la modale, par son libellé (« Recto », « Selfie »…). */
const docCard = (page: Page, type: string) =>
  page.locator("div.border.rounded-xl").filter({ has: page.locator("strong", { hasText: new RegExp(`^${type}`) }) });

test.describe("D — KYC", () => {
  test("D-01 /kyc : les quatre pièces déposées mettent le dossier en file Admin KYC", async ({ page }) => {
    const user = await createUser({ label: "kycdepot", role: "artisan", kycStatus: "en_attente" });
    await login(page, user);
    await page.goto("/kyc");

    await page.getByRole("button", { name: "CNI" }).click();
    await page.getByPlaceholder("B12345678").fill(uniqueIdNumber());
    await page.getByRole("button", { name: /Suivant/ }).click();

    await page.locator("input[name=file]").setInputFiles(png("recto.png"));
    await page.getByRole("button", { name: /Suivant/ }).click();
    await expect(page.getByText("Étape 3 — Téléversez le verso")).toBeVisible();
    await page.locator("input[name=file]").setInputFiles(png("verso.png"));
    await page.getByRole("button", { name: /Suivant/ }).click();

    await page.locator("input[name=selfie]").setInputFiles(png("selfie.png"));
    await page.locator("input[name=selfie_avec_piece]").setInputFiles(png("selfie-piece.png"));
    await page.getByRole("button", { name: "Soumettre pour vérification" }).click();
    await expect(page).not.toHaveURL(/\/kyc$/);

    const docs = await prisma.kycDocument.findMany({ where: { userId: user.id } });
    expect(docs.map((d) => d.type).sort()).toEqual(["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"]);
    expect(docs.every((d) => d.status === "en_attente")).toBe(true);
    expect(await kycStatus(user)).toBe("en_attente");

    // Le dossier apparaît dans la file de l'Admin KYC.
    await logout(page);
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await page.goto("/admin/kyc");
    await expect(page.locator("tr", { hasText: user.email })).toBeVisible();
  });

  test("D-02 chaque pièce validée par l'Admin KYC rend le compte vérifié", async ({ page }) => {
    const user = await createUser({ label: "kycok", role: "artisan", kycStatus: "en_attente" });
    await login(page, user);
    await uploadIdentityDocs(page);
    await logout(page);

    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await openDossier(page, user);
    // A13 : la date de naissance lue sur la pièce accompagne la validation, sans elle le compte
    // reste en file.
    await page.locator("input[type=date]").last().fill("1990-05-12");
    for (const label of ["Recto", "Verso", "Selfie", "Selfie+pièce"]) {
      const carte = docCard(page, label.replace("+", "\\+") + "$");
      await carte.getByRole("button", { name: "Valider" }).click();
      await expect(carte.getByText("Validé", { exact: true })).toBeVisible();
    }
    await expect.poll(() => kycStatus(user)).toBe("verifie");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).dateNaissance?.toISOString()).toMatch(/^1990-05-12/);
  });

  test("D-03 une pièce rejetée puis renvoyée ramène le dossier en attente", async ({ page }) => {
    const user = await createUser({ label: "kycrej", role: "artisan", kycStatus: "en_attente" });
    await login(page, user);
    await uploadIdentityDocs(page);
    await logout(page);

    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await openDossier(page, user);
    const verso = docCard(page, "Verso");
    await verso.getByPlaceholder("Motif de rejet").fill("Verso illisible");
    await verso.getByRole("button", { name: "Rejeter" }).click();
    await expect.poll(() => kycStatus(user)).toBe("rejete");
    await logout(page);

    await login(page, user);
    await page.goto("/kyc");
    await expect(page.getByText("Dossier rejeté")).toBeVisible();
    await expect(page.getByText("Étape 3 — Téléversez le verso")).toBeVisible();
    await page.locator("input[name=file]").setInputFiles(png("verso-net.png"));
    await page.getByRole("button", { name: /Suivant/ }).click();
    await expect.poll(() => kycStatus(user)).toBe("en_attente");
  });

  test("D-04 révoquer une pièce d'un compte vérifié lui retire le statut vérifié", async ({ page }) => {
    const user = await createUser({ label: "kycrevoc", role: "artisan", kycStatus: "en_attente" });
    const admin = await createUser({ label: "admkyc", adminRole: "kyc" });
    await verifiedWithDocs(page, user, admin.id);

    await login(page, admin);
    await page.goto("/admin/kyc/historique");
    const ligne = page.locator("tr", { hasText: user.email }).filter({ has: page.locator("td", { hasText: /^Selfie$/ }) });
    await ligne.getByPlaceholder("Justification").fill("Selfie ne correspond pas à la pièce");
    page.once("dialog", (d) => void d.accept());
    await ligne.getByRole("button", { name: "Révoquer" }).click();
    await expect(page.getByText("Validation révoquée — le dossier repasse en attente de revue.")).toBeVisible();
    await expect.poll(() => kycStatus(user)).toBe("en_attente");
  });

  test("D-05 /kyc/financier : compte Mobile Money + justificatif → en attente, en file Admin KYC", async ({ page }) => {
    const user = await createUser({ label: "payout", role: "manoeuvre", kycStatus: "en_attente" });
    await verifiedWithDocs(page, user, (await createUser({ label: "admkyc", adminRole: "kyc" })).id);
    await login(page, user);
    await page.goto("/kyc/financier");
    await expect(page.getByText("Chargement...")).toBeHidden();
    await page.locator("#operator").selectOption("mtn");
    await page.locator("#number").fill("+22996123456");
    await page.locator("#holder").fill("Test PAYOUT");
    await page.locator("input[type=file]").setInputFiles(png("domicile.png"));
    await expect(page.getByText("Justificatif téléversé.")).toBeVisible();
    await page.getByRole("button", { name: "Vérifier mon compte" }).click();
    await expect(page.getByText(/Dossier envoyé/)).toBeVisible();
    expect(await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ status: "en_attente" });

    await logout(page);
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await page.goto("/admin/kyc/versements");
    await expect(page.locator("tr", { hasText: user.email })).toBeVisible();
  });

  test("D-06 l'Admin KYC vérifie le compte de versement", async ({ page }) => {
    const user = await createUser({ label: "payoutok", role: "manoeuvre", payout: "en_attente" });
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await page.goto("/admin/kyc/versements");
    await page.locator("tr", { hasText: user.email }).getByRole("button", { name: "Vérifier" }).click();
    await expect.poll(async () => (await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe("verifie");
  });

  test("D-07 rejeter un compte de versement sans motif est impossible", async ({ page }) => {
    const user = await createUser({ label: "payoutrej", role: "manoeuvre", payout: "en_attente" });
    await login(page, await createUser({ label: "admkyc", adminRole: "kyc" }));
    await page.goto("/admin/kyc/versements");
    const row = page.locator("tr", { hasText: user.email });
    // Écran : le bouton reste inactif tant qu'aucun motif n'est saisi.
    await expect(row.getByRole("button", { name: "Rejeter" })).toBeDisabled();
    // Serveur : la même décision envoyée sans motif est refusée.
    const res = await page.request.post(`/api/admin/kyc/payouts/${user.id}/decision`, { data: { decision: "rejete" } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: "refusal_reason_required" });

    await row.getByPlaceholder("Motif du rejet").fill("Titulaire différent du compte");
    await row.getByRole("button", { name: "Rejeter" }).click();
    await expect.poll(async () => (await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe("rejete");
  });
});

// Candidature d'un prestataire NON vérifié (2026-11-09) : enregistrée, modifiable tant qu'elle
// n'est pas partie, puis envoyée D'ELLE-MÊME au client à la validation du KYC — le prestataire
// ne la valide qu'une fois.
test.describe("D — candidature en attente de vérification", () => {
  test("D-08 non vérifié : enregistrée, modifiable ; KYC validé → envoyée seule, sans second clic", async ({ page }) => {
    test.setTimeout(240_000);
    const client = await createUser({ label: "kycdcli" });
    const mission = await prisma.mission.create({
      data: { clientId: client.id, titre: `Logo restaurant — pw ${Date.now()}`, description: "Création d'un logo.", domaine: "design", budget: 150000, currency: "XOF", delaiJours: 10, mode: "distance", status: "publiee" },
    });
    const presta = await createUser({ label: "kycdpre", role: "expert_digital", kycStatus: "en_attente" });
    const drafts = new RegExp(`/dashboard/expert-digital/devis-contrats\\?tab=devis&f=brouillons&envoi=en-attente&mission=${mission.id}$`);
    const warning = page.getByRole("alert").filter({ hasText: `Votre candidature à « ${mission.titre} » n'a pas été envoyée au client.` });

    // 1. Non vérifié : direction la page des brouillons, avec l'avertissement de non-envoi.
    await login(page, presta);
    await page.goto(`/missions/${mission.id}?candidater=1`);
    await page.getByRole("button", { name: /^Prix fixe/ }).click();
    await page.getByPlaceholder("150000").fill("140000");
    await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
    await expect(page).toHaveURL(drafts, { timeout: 30_000 });
    await expect(warning).toBeVisible({ timeout: 30_000 });
    await expect(warning).toContainText("partira automatiquement");
    const row = page.locator("div.bg-white", { hasText: mission.titre }).filter({ hasText: "Non envoyée" }).first();
    await expect(row).toContainText("140 000 XOF");
    await expect(row).toContainText("Pas encore envoyée au client");

    // 2. Modifiable depuis l'avertissement : formulaire repris, l'envoi devient une mise à jour.
    await warning.getByRole("link", { name: "Modifier la candidature" }).click();
    await expect(page).toHaveURL(new RegExp(`/missions/${mission.id}\\?candidater=1`));
    await expect(page.getByPlaceholder("150000")).toHaveValue("140000", { timeout: 30_000 });
    await page.getByPlaceholder("150000").fill("135000");
    await page.getByRole("button", { name: "Mettre à jour ma candidature" }).click();
    await expect(page).toHaveURL(drafts, { timeout: 30_000 });
    await expect(row).toContainText("135 000 XOF", { timeout: 30_000 });
    expect(await prisma.missionProposal.count({ where: { missionId: mission.id } })).toBe(0);

    // 3. Tableau de bord : en attente d'envoi, « Modifier » — et aucun bouton « Envoyer ».
    await page.goto("/dashboard/expert-digital");
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Candidatures en attente d'envoi" }) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("135 000 XOF");
    await expect(card).toContainText("partiront automatiquement");
    await expect(card.getByRole("button", { name: "Envoyer" })).toHaveCount(0);
    await card.getByRole("link", { name: "Modifier" }).click();

    // 4. Le formulaire est repris tel quel, toujours en mise à jour.
    await expect(page).toHaveURL(new RegExp(`/missions/${mission.id}\\?candidater=1`));
    await expect(page.getByPlaceholder("150000")).toHaveValue("135000", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Mettre à jour ma candidature" })).toBeVisible();

    // 5. L'Admin KYC valide l'identité : la candidature part seule, dans sa dernière version.
    await logout(page);
    await login(page, await createUser({ label: "kycdadm", adminRole: "kyc" }));
    const res = await page.request.post(`/api/admin/kyc/${presta.id}/decision`, { data: { status: "verifie", dateNaissance: "1990-05-12" } });
    expect(res.ok(), await res.text()).toBe(true);
    const sent = await prisma.missionProposal.findUniqueOrThrow({ where: { missionId_providerId: { missionId: mission.id, providerId: presta.id } } });
    expect(sent).toMatchObject({ montant: 135000, status: "envoyee" });
    expect(await prisma.proposalDraft.count({ where: { providerId: presta.id } })).toBe(0);
    // Le client la reçoit, le prestataire en est informé.
    expect(await prisma.missionNotification.count({ where: { userId: client.id, missionId: mission.id, type: "candidature_recue" } })).toBe(1);

    // 6. Côté prestataire : plus rien en attente, la candidature est suivie normalement.
    await logout(page);
    await login(page, presta);
    await page.goto("/dashboard/expert-digital");
    const tracking = page.locator("section", { has: page.getByRole("heading", { name: "Suivi de mes candidatures" }) });
    await expect(tracking).toContainText(mission.titre, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Candidatures en attente d'envoi" })).toHaveCount(0);
  });
});
