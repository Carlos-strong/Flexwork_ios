import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { typeOtp } from "./support/auth";
import { prisma } from "./support/db";
import { waitForOtp } from "./support/mailpit";

// P — Publication d'une mission par un visiteur NON connecté (2026-11-09) : depuis le profil
// public d'un prestataire (« Publier une mission »), on vérifie d'abord s'il a un compte —
// connexion s'il en a un, inscription sinon — puis il revient au tunnel, métier pré-rempli et
// prestataire invité, et peut publier avant même la vérification de son identité.

const uniq = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 10);

async function invitationUrl() {
  const metier = await prisma.metier.findFirstOrThrow({ select: { id: true } });
  const provider = await createUser({ label: "invite", role: "expert_digital", firstname: "Awa" });
  return `/missions/new?metierId=${metier.id}&pour=${provider.id}&nom=Awa`;
}

test.describe("P — publier une mission sans être connecté", () => {
  test("P-01 compte existant : connexion par code puis retour au tunnel, prestataire invité", async ({ page }) => {
    const url = await invitationUrl();
    const client = await createUser({ label: "pubexist" });

    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Publier une mission" })).toBeVisible();
    await expect(page.getByText("Pour proposer votre mission à")).toContainText("Awa");

    const envoi = new Date(Date.now() - 1000);
    await page.getByLabel("Email ou numéro de téléphone").fill(client.email);
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/verify-otp.*purpose=login/);

    await typeOtp(page, await waitForOtp(client.email, envoi));
    await expect(page).toHaveURL((u) => u.pathname === "/missions/new" && u.searchParams.get("pour") !== null, { timeout: 30_000 });
    await expect(page.getByText("sera invité(e) à candidater directement")).toBeVisible();
  });

  test("P-02 aucun compte : inscription pré-remplie, /bienvenue, tunnel ouvert avant le KYC", async ({ page }) => {
    const url = await invitationUrl();
    const n = uniq();
    const email = `pw-pubnew-${n}@e2e.flexwork.test`;

    await page.goto(url);
    await page.getByLabel("Email ou numéro de téléphone").fill(email);
    await page.getByRole("button", { name: "Continuer" }).click();

    // Formulaire d'inscription direct, email repris.
    await expect(page).toHaveURL(/\/signup\?.*callbackUrl=/);
    await expect(page.getByText("Aucun compte n'existe encore avec")).toContainText(email);
    await expect(page.locator("#email")).toHaveValue(email);

    await page.locator("#firstname").fill("Nouveau");
    await page.locator("#lastname").fill("Client");
    await page.locator("#city").fill("Cotonou");
    await page.locator("#phone").fill(`9${n}`.slice(0, 8));
    await page.locator("input[name=cgvAccepted]").check();
    const envoi = new Date(Date.now() - 1000);
    // Adresse non grand public : un seul clic suffit.
    await page.locator("form button[type=submit]").click();

    await expect(page).toHaveURL(/verify-otp.*purpose=signup/);
    await typeOtp(page, await waitForOtp(email, envoi));

    // /bienvenue : publier une mission = usage client, présélectionné.
    await expect(page).toHaveURL(/\/bienvenue/);
    await expect(page.getByRole("radio", { checked: true })).toContainText("client", { ignoreCase: true });
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page).toHaveURL((u) => u.pathname === "/missions/new" && u.searchParams.get("pour") !== null, { timeout: 30_000 });
    await expect(page.getByText("sera invité(e) à candidater directement")).toBeVisible();
    await expect(page.getByText("Votre identité n'est pas encore vérifiée")).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.kycStatus).not.toBe("verifie");
  });

  test("P-04 sur son propre profil : après connexion, le prestataire ne peut pas publier pour lui-même", async ({ page }) => {
    const metier = await prisma.metier.findFirstOrThrow({ select: { id: true } });
    const provider = await createUser({ label: "selfpub", role: "expert_digital", firstname: "Awa" });

    // Déconnecté, depuis le bouton « Publier une mission » de SA page publique.
    await page.goto(`/missions/new?metierId=${metier.id}&pour=${provider.id}&nom=Awa`);
    const envoi = new Date(Date.now() - 1000);
    await page.getByLabel("Email ou numéro de téléphone").fill(provider.email);
    await page.getByRole("button", { name: "Continuer" }).click();
    await typeOtp(page, await waitForOtp(provider.email, envoi));

    await expect(page.getByRole("heading", { name: "Vous ne pouvez pas publier une mission sur votre propre profil" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("sera invité(e) à candidater directement")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Voir mon profil" })).toHaveAttribute("href", `/profil/${provider.id}`);

    // L'API refuse aussi, indépendamment de l'écran.
    const res = await page.request.post("/api/missions", {
      data: {
        titre: "Mission adressée à moi-même",
        description: "Description suffisamment longue pour passer la validation du schéma de publication.",
        delaiJours: 5,
        metierId: metier.id,
        budgetType: "FIXED",
        budget: 100000,
        mode: "distance",
        status: "publiee",
        invitedProviderId: provider.id,
      },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe("self_invitation");
  });

  test("P-03 un visiteur ne voit jamais le tunnel sans s'identifier", async ({ page }) => {
    await page.goto("/missions/new");
    await expect(page.getByLabel("Email ou numéro de téléphone")).toBeVisible();
    await expect(page.getByText("Pour publier votre mission, identifiez-vous.")).toBeVisible();
  });
});
