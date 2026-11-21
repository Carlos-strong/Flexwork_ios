import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createUser, type TestUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";
import { applyTo, publishMission } from "./support/missions";

// Signature du contrat côté prestataire (2026-11-10) : il accepte d'abord les termes (le bouton
// « Signer » reste inactif avant), signe en premier, puis « Terminer » — fixé en bas de la fenêtre —
// le ramène à son tableau de bord en attendant la contre-signature du client.

/** Annonce publiée, candidature retenue, contrat généré : renvoie l'engagement à signer. */
async function contractToSign(page: Page, client: TestUser, provider: TestUser): Promise<string> {
  await login(page, client);
  const mission = await publishMission(page);
  await logout(page);
  await login(page, provider);
  const proposalId = await applyTo(page, mission.id);
  await logout(page);
  await login(page, client);
  const accept = await page.request.post(`/api/missions/${mission.id}/proposals/${proposalId}/accept`);
  expect(accept.ok(), await accept.text()).toBe(true);
  const { engagementId } = await accept.json();
  const gen = await page.request.post(`/api/missions/${engagementId}/contract`, { data: {} });
  expect(gen.ok(), await gen.text()).toBe(true);
  await logout(page);
  return engagementId;
}

test("passphrase oubliée : un nouveau certificat exige le code reçu par e-mail", async ({ page }) => {
  const client = await createUser({ label: "csr-cli" });
  const provider = await createUser({ label: "csr-pre", role: "expert_digital", payout: "verifie" });
  const engagementId = await contractToSign(page, client, provider);

  await login(page, provider);
  // Certificat existant, dont la passphrase est « oubliée ».
  const cert = await page.request.post("/api/signature/certificate", {
    data: { commonName: "Test CSR-PRE", email: provider.email, passphrase: "ancienne-phrase" },
  });
  expect(cert.status()).toBe(201);

  await page.goto(`/missions/${engagementId}/contract`);
  await page.getByText("J'ai lu et j'accepte").click();
  await page.getByRole("button", { name: "Signer en tant que Prestataire" }).click();
  await page.getByPlaceholder("Saisissez votre passphrase").fill("je-ne-sais-plus");
  await page.locator("form").getByRole("button", { name: "Signer le contrat" }).click();
  await expect(page.getByText(/Passphrase incorrecte/)).toBeVisible();

  await page.getByRole("button", { name: "Générer un nouveau certificat" }).click();
  const submit = page.getByRole("button", { name: "Générer le nouveau certificat et signer" });
  await page.getByPlaceholder("Minimum 8 caractères").fill("nouvelle-phrase");
  await page.getByPlaceholder("Répéter la passphrase").fill("nouvelle-phrase");
  await expect(submit).toBeDisabled(); // pas de code : pas de remplacement

  await page.getByRole("button", { name: "Recevoir un code de vérification par e-mail" }).click();
  await expect(page.getByText(/Code envoyé à/)).toBeVisible();
  // Le code part par e-mail : le test fixe sa valeur en base, sous sa forme hachée.
  const otp = await prisma.otpCode.findFirstOrThrow({
    where: { userId: provider.id, purpose: "signature_reset", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { codeHash: crypto.createHash("sha256").update("424242").digest("hex") },
  });
  await page.getByLabel("Code de vérification").fill("424242");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText("Signature enregistrée")).toBeVisible({ timeout: 30_000 });
  const certs = await prisma.digitalCertificate.findMany({ where: { userId: provider.id }, select: { status: true } });
  expect(certs.map((c) => c.status).sort()).toEqual(["ACTIVE", "REVOKED"]);
});

test("le prestataire accepte les termes, signe, puis « Terminer » le ramène au tableau de bord", async ({ page }) => {
  const client = await createUser({ label: "csig-cli" });
  const provider = await createUser({ label: "csig-pre", role: "expert_digital", payout: "verifie" });
  const engagementId = await contractToSign(page, client, provider);

  await login(page, provider);
  await page.goto(`/missions/${engagementId}/contract`);
  const signer = page.getByRole("button", { name: "Signer en tant que Prestataire" });
  await expect(signer).toHaveCount(1);
  await expect(signer).toBeDisabled();
  await page.getByText("J'ai lu et j'accepte").click();
  await expect(signer).toBeEnabled();
  await signer.click();

  // Pas encore de certificat : il le crée avec sa passphrase et signe dans la foulée.
  await page.getByPlaceholder("Minimum 8 caractères").fill("phrase-secrete-e2e");
  await page.getByPlaceholder("Répéter la passphrase").fill("phrase-secrete-e2e");
  await page.getByRole("button", { name: "Générer le certificat et signer" }).click();

  await expect(page.getByText("Signature enregistrée")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Le client a été notifié et va contre-signer")).toBeVisible();
  const terminer = page.getByRole("button", { name: "Terminer et revenir au tableau de bord" });
  await expect(terminer).toBeInViewport();
  await terminer.click();

  await expect(page).toHaveURL(/\/dashboard\/expert-digital$/);

  // Revenu plus tard sur la page : « Terminer » en bas de page, même destination.
  await page.goto(`/missions/${engagementId}/contract`);
  await expect(page.getByText("Vous avez signé le contrat")).toBeVisible();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/expert-digital$/);

  const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { missionId: engagementId } });
  expect(contract.providerSignedAt).not.toBeNull();
  expect(contract.clientSignedAt).toBeNull();
});
