import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, seedOtp, typeOtp } from "./support/auth";
import { waitForOtp } from "./support/mailpit";
import { publishMission } from "./support/missions";
import { prisma } from "./support/db";
import type { Page } from "@playwright/test";

// Inscription réelle depuis /signin (lien « Créer un compte »), code lu dans Mailpit. La
// destination d'origine doit survivre à chaque écran : c'est ce que les cas E-08/E-09 vérifient.
async function signupFromSignin(page: Page, label: string): Promise<string> {
  const n = `${Date.now()}`.slice(-8);
  const email = `pw-${label}-${n}@e2e.flexwork.test`;
  await page.getByRole("link", { name: "Créer un compte" }).click();
  await expect(page).toHaveURL(/\/signup\?callbackUrl=/);
  await page.getByRole("button", { name: "Créer un compte" }).click();
  await page.locator("#firstname").fill("Nouveau");
  await page.locator("#lastname").fill("Visiteur");
  await page.locator("#city").fill("Cotonou");
  await page.locator("#phone").fill(`9${n}`.slice(0, 8));
  await page.locator("#email").fill(email);
  await page.locator("input[name=cgvAccepted]").check();
  const envoi = new Date(Date.now() - 1000);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/verify-otp.*callbackUrl=/);
  await typeOtp(page, await waitForOtp(email, envoi));
  await expect(page).toHaveURL(/\/bienvenue\?callbackUrl=/, { timeout: 30_000 });
  return email;
}

// E — Recherche et découverte (PLAN_TESTS_GLOBAL.md).

test.describe("E — découverte", () => {
  test("E-02 l'accueil ne met en avant que des prestataires vérifiés", async ({ page }) => {
    // Un prestataire NON vérifié, récent et complet : le candidat idéal à une fuite.
    const nonVerifie = await createUser({ label: "nonverif", role: "artisan", kycStatus: "en_attente", firstname: "Zorobabel", lastname: "Nonverifie" });
    await prisma.profile.create({ data: { userId: nonVerifie.id, label: "Principal", isDefault: true, mainDomain: "Peinture", indicativeRate: 5000 } });

    await page.goto("/");
    await expect(page.getByText("Zorobabel")).toHaveCount(0);

    const ids = await page
      .locator("a[href^='/profil/']")
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("/")[2].split("?")[0]))]);
    expect(ids).not.toContain(nonVerifie.id);
    for (const id of ids) {
      const u = await prisma.user.findUnique({ where: { id }, select: { kycStatus: true } });
      expect(u?.kycStatus, `profil ${id} mis en avant`).toBe("verifie");
    }
  });

  test("E-04 l'accueil affiche les dernières missions publiées ; la carte ouvre la fiche publique, « Candidater » ramène à la mission après connexion", async ({ page }) => {
    const client = await createUser({ label: "clilanding", kycStatus: "en_attente", firstname: "Ignace", lastname: "Confidentiel" });
    await login(page, client);
    const mission = await publishMission(page, { titre: `Mission vitrine accueil — pw ${Date.now()}` });
    await page.context().clearCookies();

    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Dernières missions publiées" }) });
    const carte = section.getByRole("listitem").filter({ hasText: mission.titre });
    await expect(carte).toBeVisible();
    // « Candidater » à la même place que « Commander » sur les services (2026-11-08) : en bas
    // de la carte, sur la ligne du montant, à sa droite.
    const montant = carte.getByText("150 000 XOF");
    const candidater = carte.getByRole("link", { name: /^Candidater/ });
    const [bm, bc] = [await montant.boundingBox(), await candidater.boundingBox()];
    expect(Math.abs(bm!.y + bm!.height / 2 - (bc!.y + bc!.height / 2))).toBeLessThan(4);
    expect(bc!.x).toBeGreaterThan(bm!.x + bm!.width);
    // Drapeau du pays du client (BJ pour les comptes de test), jamais son nom.
    await expect(carte.getByRole("img", { name: "Client : Bénin" })).toHaveText("🇧🇯");
    // Client en attente de vérification : signalé comme sur la fiche (F-08), jamais nommé.
    await expect(carte).toContainText("Identité non vérifiée");
    await expect(carte).toContainText("150 000 XOF");
    await expect(section).not.toContainText("Confidentiel");

    // Les brouillons ne sortent pas.
    const brouillon = await prisma.mission.create({
      data: { clientId: client.id, titre: `Brouillon caché — pw ${Date.now()}`, description: "Brouillon.", domaine: "design", budget: 1000, currency: "XOF", delaiJours: 5, status: "brouillon" },
    });
    await page.reload();
    await expect(section.getByText(brouillon.titre)).toHaveCount(0);

    // Visiteur : fiche PUBLIQUE de la mission (2026-11-09), client jamais nommé ; « Candidater »
    // → connexion → retour sur la mission, formulaire ouvert — pas sur le tableau de bord.
    const presta = await createUser({ label: "prelanding", role: "expert_digital" });
    await carte.getByRole("link", { name: mission.titre, exact: true }).click();
    await expect(page.getByRole("heading", { name: mission.titre })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Description du besoin" })).toBeVisible();
    await expect(page.getByText("Identité non vérifiée")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Confidentiel");
    await page.getByRole("link", { name: "Candidater", exact: true }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await page.getByLabel("Adresse email").fill(presta.email);
    await page.getByRole("button", { name: "Recevoir un code de connexion" }).click();
    await expect(page).toHaveURL(/verify-otp.*callbackUrl=/);
    await typeOtp(page, await seedOtp(presta));
    await expect(page).toHaveURL(new RegExp(`/missions/${mission.id}\\?candidater=1$`), { timeout: 30_000 });
    await expect(page.getByText(mission.titre).first()).toBeVisible();
  });

  test("E-06 l'accueil affiche les derniers services publiés, badge « Vérifié » en tête ; la carte ouvre le Gig après connexion", async ({ page }) => {
    // Services BADGÉS laissés par une campagne précédente d'E-06 / E-09 : retirés d'abord, ils
    // occuperaient les places de tête de la vitrine.
    await prisma.gig.deleteMany({
      where: { provider: { OR: [{ email: { startsWith: "pw-prebadge-" } }, { email: { startsWith: "pw-pregig2-" } }] } },
    });
    const RUN = Date.now();
    const gig = (providerId: string, titre: string, minutesAgo: number) =>
      prisma.gig.create({
        data: { providerId, titre, description: "Prestation à prix fixe.", domaine: "Design", prix: 45_000, delaiJours: 5, status: "publie", createdAt: new Date(Date.now() - minutesAgo * 60_000) },
      });
    const badge = await createUser({ label: "prebadge", role: "expert_digital", firstname: "Badgé" });
    await prisma.profile.create({ data: { userId: badge.id, label: "Principal", isDefault: true, mainDomain: "Design", badgeStatus: "accorde" } });
    const simple = await createUser({ label: "presimple", role: "expert_digital", firstname: "Simple" });
    const nonListable = await createUser({ label: "prekycko", role: "expert_digital", kycStatus: "en_attente" });
    // Le badgé publie AVANT les autres : il doit pourtant passer devant.
    // Écarts de quelques MINUTES seulement (et non 30) : la vitrine affiche six services, badgés
    // d'abord. Daté d'une demi-heure, le service badgé d'E-06 était évincé par n'importe quel
    // service badgé publié entre-temps par un autre test — échec selon l'ordre des campagnes.
    const gBadge = await gig(badge.id, `Logo badgé — pw ${RUN}`, 3);
    const gSimple = await gig(simple.id, `Logo simple — pw ${RUN}`, 2);
    const gCache = await gig(nonListable.id, `Logo non listable — pw ${RUN}`, 1);

    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Nouveaux services publiés" }) });
    const cartes = section.getByRole("listitem");
    await expect(section.getByText(gBadge.titre)).toBeVisible();
    await expect(section.getByText(gCache.titre)).toHaveCount(0);

    // Aucun service sans badge ne précède un service badgé.
    const badges = await cartes.evaluateAll((lis) => lis.map((li) => li.textContent?.includes("✓ Vérifié") ?? false));
    expect(badges.indexOf(false) === -1 || badges.lastIndexOf(true) < badges.indexOf(false), JSON.stringify(badges)).toBe(true);
    const titres = await cartes.allTextContents();
    const iSimple = titres.findIndex((t) => t.includes(gSimple.titre));
    if (iSimple !== -1) expect(titres.findIndex((t) => t.includes(gBadge.titre))).toBeLessThan(iSimple);

    // Visiteur → connexion → le Gig ouvert dans le catalogue client.
    const client = await createUser({ label: "cligig" });
    // Drapeau du pays du prestataire à côté de son nom (BJ pour les comptes de test).
    await expect(section.getByRole("listitem").filter({ hasText: gBadge.titre }).getByRole("img", { name: "Bénin" })).toHaveText("🇧🇯");
    await section.getByRole("listitem").filter({ hasText: gBadge.titre }).getByRole("link", { name: /^Commander/ }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await page.getByLabel("Adresse email").fill(client.email);
    await page.getByRole("button", { name: "Recevoir un code de connexion" }).click();
    // Attendre l'écran de saisie : le code envoyé par ce clic remplacerait un code posé avant.
    await expect(page).toHaveURL(/verify-otp.*callbackUrl=/);
    await typeOtp(page, await seedOtp(client));
    await expect(page).toHaveURL(new RegExp(`/client/offres\\?gig=${gBadge.id}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: gBadge.titre })).toBeVisible();
    await expect(page.getByRole("button", { name: /Retour au catalogue/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Commander — 45/ })).toBeVisible();
    await prisma.gig.deleteMany({ where: { id: { in: [gBadge.id, gSimple.id, gCache.id] } } });
  });

  test("E-07 « Candidater » : le prestataire se connecte et retrouve le formulaire de candidature ouvert", async ({ page }) => {
    const client = await createUser({ label: "clicand" });
    await login(page, client);
    const mission = await publishMission(page, { titre: `Mission à candidater — pw ${Date.now()}` });
    await page.context().clearCookies();
    const presta = await createUser({ label: "precand", role: "expert_digital" });

    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Dernières missions publiées" }) });
    await section.getByRole("listitem").filter({ hasText: mission.titre }).getByRole("link", { name: /^Candidater/ }).click();
    // Directement la connexion, sans écran « Connectez-vous » intermédiaire.
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await page.getByLabel("Adresse email").fill(presta.email);
    await page.getByRole("button", { name: "Recevoir un code de connexion" }).click();
    await expect(page).toHaveURL(/verify-otp.*callbackUrl=/);
    await typeOtp(page, await seedOtp(presta));

    await expect(page).toHaveURL(new RegExp(`/missions/${mission.id}\\?candidater=1$`), { timeout: 30_000 });
    // Formulaire déjà ouvert et amené à l'écran (il dépasse la hauteur de l'écran : on vérifie son titre).
    await expect(page.getByRole("button", { name: "Envoyer ma candidature" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Candidater à cette mission" })).toBeInViewport();
    await page.getByRole("button", { name: /^Prix fixe/ }).click();
    await page.getByPlaceholder("150000").fill("140000");
    await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
    await expect(page.getByText(/Candidature envoyée/)).toBeVisible();
    expect(await prisma.missionProposal.count({ where: { missionId: mission.id, providerId: presta.id } })).toBe(1);
  });

  test("E-08 « Candidater » sans compte : inscription, espace prestataire, retour sur la mission", async ({ page }) => {
    const client = await createUser({ label: "clicand2" });
    await login(page, client);
    const mission = await publishMission(page, { titre: `Mission nouvel inscrit — pw ${Date.now()}` });
    await page.context().clearCookies();

    await page.goto(`/missions/${mission.id}?candidater=1`);
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await signupFromSignin(page, "candnew");

    // Venu d'une mission : la carte prestataire est déjà choisie.
    await expect(page.getByRole("radio", { name: /Je propose mes services/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/devenir-prestataire\?returnTo=/);
    await page.locator("input[name=providerType][value=expert_digital]").check();
    await page.getByRole("button", { name: "Activer l'espace prestataire" }).click();

    await expect(page).toHaveURL(new RegExp(`/missions/${mission.id}\\?candidater=1$`), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Envoyer ma candidature" })).toBeVisible();
    // Identité pas encore vérifiée : refus explicite, avec le chemin pour s'en sortir.
    await page.getByRole("button", { name: /^Prix fixe/ }).click();
    await page.getByPlaceholder("150000").fill("140000");
    await page.getByRole("button", { name: "Envoyer ma candidature" }).click();
    await expect(page.getByText("Votre identité doit être vérifiée avant de candidater.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Vérifier mon identité" })).toHaveAttribute("href", "/kyc");
  });

  test("E-09 « Commander » sans compte : inscription en client, puis la fiche du service", async ({ page }) => {
    const presta = await createUser({ label: "pregig2", role: "expert_digital" });
    // Badgé : les services badgés passent devant (E-06), et la base des tests navigateur garde
    // ceux des campagnes précédentes — sans badge, ce service sortirait des six affichés.
    await prisma.profile.create({ data: { userId: presta.id, label: "Principal", isDefault: true, mainDomain: "Design", badgeStatus: "accorde" } });
    const gig = await prisma.gig.create({
      data: { providerId: presta.id, titre: `Logo à commander — pw ${Date.now()}`, description: "Prestation à prix fixe.", domaine: "Design", prix: 30_000, delaiJours: 3, status: "publie" },
    });

    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Nouveaux services publiés" }) });
    await section.getByRole("listitem").filter({ hasText: gig.titre }).getByRole("link", { name: /^Commander/ }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
    await signupFromSignin(page, "gignew");

    await page.getByRole("radio", { name: /Je cherche un prestataire/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(new RegExp(`/client/offres\\?gig=${gig.id}$`), { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Commander — 30/ })).toBeVisible();
    // Service badgé : retiré pour ne pas évincer ceux d'E-06 de la vitrine.
    await prisma.gig.deleteMany({ where: { id: gig.id } });
  });
  test("E-10 fiche publique : coordonnées masquées ; une mission non publiée reste réservée aux connectés", async ({ page }) => {
    const client = await createUser({ label: "clipub", firstname: "Ignace", lastname: "Confidentiel" });
    const base = { clientId: client.id, domaine: "design", budget: 80_000, currency: "XOF", delaiJours: 4, ville: "Cotonou" };
    const ouverte = await prisma.mission.create({
      data: { ...base, status: "publiee", titre: `Fiche publique — pw ${Date.now()}`, description: "Joignez-moi au +229 97 12 34 56 pour les détails." },
    });
    const engagee = await prisma.mission.create({
      data: { ...base, status: "en_cours", titre: `Mission engagée — pw ${Date.now()}`, description: "Déjà attribuée." },
    });
    try {
      await page.goto(`/missions/${ouverte.id}`);
      await expect(page.getByRole("heading", { name: ouverte.titre })).toBeVisible();
      await expect(page.getByText("[coordonnées masquées]")).toBeVisible();
      await expect(page.locator("main")).not.toContainText("97 12 34 56");
      await expect(page.locator("main")).not.toContainText("Confidentiel");

      await page.goto(`/missions/${engagee.id}`);
      await expect(page.getByText("Connectez-vous pour consulter cette mission.")).toBeVisible();
      await expect(page.getByText(engagee.titre)).toHaveCount(0);
    } finally {
      await prisma.mission.deleteMany({ where: { id: { in: [ouverte.id, engagee.id] } } });
    }
  });
});
