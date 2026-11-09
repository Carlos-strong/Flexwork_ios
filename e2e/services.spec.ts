import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createUser } from "./support/accounts";
import { login, logout, seedOtp, typeOtp } from "./support/auth";
import { prisma } from "./support/db";
import { png } from "./support/files";
import { seedProviderWithServices } from "./support/services-seed";
import type { Page } from "@playwright/test";

/** Choisit une formule (bouton radio : fonctionne même avant l'hydratation de la page). */
async function selectTab(page: Page, name: string) {
  const formule = page.getByRole("radio", { name });
  await formule.check();
  await expect(formule).toBeChecked();
}

// Services (Gigs) à trois formules, 2026-11-08 : création depuis le profil, vitrine du profil
// public (langues, compétence confirmée, avis sans nom du client), commande de la formule Premium.
test("S-01 services : création depuis le profil, profil public, commande d'une formule", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createUser({
    label: "gigpro",
    role: "expert_digital",
    kycStatus: "verifie",
    firstname: "Awa",
    lastname: "Designer",
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { avatarPath: "avatars/test.png" },
  });
  const RUN = Date.now();
  const profile = await prisma.profile.create({
    data: {
      userId: user.id,
      label: "Principal",
      isDefault: true,
      mainDomain: "Design graphique",
      tags: [
        "Logo",
        "Identité visuelle",
        "Illustration",
        "Affiche",
        "Flyer",
        "Packaging",
        "Typographie",
      ],
      providerKind: "independant",
      title: "Designer graphique · identités de marque",
      description:
        "Designer graphique depuis 8 ans, je crée des identités visuelles qui font vendre.",
      overview:
        "Je travaille avec des PME et des créateurs en Afrique de l'Ouest. ".repeat(
          12,
        ),
      declaredLevel: "senior",
      declaredExperienceYears: 8,
      zonePays: "BJ",
      zoneVille: "Cotonou",
      zoneRayonKm: 30,
      availability: "temps_plein",
      tarifUnite: "jour",
      indicativeRate: 25000,
      languages: [
        { code: "fr", niveau: "natif" },
        { code: "en", niveau: "courant" },
        { code: "fon", niveau: "natif" },
      ],
    },
  });
  await prisma.professionalDeclaration.create({
    data: {
      profileId: profile.id,
      declarationType: "experience",
      declarationTextSnapshot: "x" + RUN,
      currentHash: "xh" + RUN,
      experiences: {
        create: {
          clientType: "COMPANY",
          clientName: "Agence Wax",
          role: "Directrice artistique",
          startDate: "2019-01",
        },
      },
    },
  });
  await prisma.professionalDeclaration.create({
    data: {
      profileId: profile.id,
      declarationType: "qualification",
      declarationTextSnapshot: "q" + RUN,
      currentHash: "qh" + RUN,
      diplomas: {
        create: {
          qualificationName: "BTS Design graphique",
          year: 2016,
          isStateIssued: true,
        },
      },
    },
  });
  // Un avis réel, sur une mission terminée qui a mobilisé la compétence « Logo ».
  const reviewer = await createUser({
    label: "revgig",
    firstname: "Kofi",
    lastname: "Mensah",
  });
  const mission = await prisma.mission.create({
    data: {
      clientId: reviewer.id,
      titre: "Logo restaurant " + RUN,
      description: "Logo",
      domaine: "Design graphique",
      budget: 50000,
      currency: "XOF",
      delaiJours: 5,
      status: "cloturee",
      tags: ["Logo"],
    },
  });
  await prisma.missionProposal.create({
    data: {
      missionId: mission.id,
      providerId: user.id,
      montant: 50000,
      status: "acceptee",
    },
  });
  await prisma.review.create({
    data: {
      missionId: mission.id,
      authorId: reviewer.id,
      targetId: user.id,
      note: 5,
      commentaire: "Travail soigné, rendu en avance. Je recommande !",
    },
  });

  await login(page, user);
  await page.goto("/profile?tab=services");
  const rubrique = page.locator("#rubrique-services");
  await rubrique.getByRole("button", { name: "+ Nouveau service" }).click();
  await rubrique
    .getByLabel("Titre du service")
    .fill("créer un logo professionnel qui fait vendre");
  const tiers = [
    [
      "Basique",
      "Logo simple",
      "1 proposition de logo, fichier PNG haute définition.",
      "25000",
      "3",
    ],
    [
      "Standard",
      "Logo + charte",
      "2 propositions, charte couleurs, fichiers PNG et SVG.",
      "50000",
      "5",
    ],
    [
      "Premium",
      "Identité complète",
      "3 propositions, charte, cartes de visite et kit réseaux sociaux.",
      "90000",
      "7",
    ],
  ];
  for (const [t, nom, inclus, prix, delai] of tiers) {
    await rubrique.getByLabel("Nom de la formule " + t).fill(nom);
    await rubrique.getByLabel("Ce qui est inclus — " + t).fill(inclus);
    await rubrique.getByLabel("Prix — " + t).fill(prix);
    await rubrique.getByLabel("Délai en jours — " + t).fill(delai);
  }
  await rubrique
    .getByLabel("Description")
    .fill(
      "Je crée votre logo à partir d'un court questionnaire sur votre activité, vos clients et vos goûts. Vous recevez des propositions originales, des fichiers prêts à l'emploi et des conseils d'utilisation.",
    );
  await rubrique
    .locator('input[type="file"]')
    .setInputFiles(png("couverture.png"));
  await rubrique.getByLabel("Mots-clés").fill("logo, identité visuelle");
  await rubrique.getByRole("button", { name: "Ajouter", exact: true }).click();
  await rubrique.getByRole("button", { name: "Publier le service" }).click();
  await expect(rubrique.getByText("Service enregistré.")).toBeVisible({
    timeout: 20000,
  });
  await expect(rubrique.getByText("En ligne", { exact: true })).toBeVisible();
  const gig = await prisma.gig.findFirstOrThrow({
    where: { providerId: user.id },
    include: { packages: true },
  });
  expect(gig.status).toBe("publie");
  expect(gig.packages).toHaveLength(3);
  expect(gig.imagePaths).toHaveLength(1);
  await rubrique.getByRole("button", { name: "Terminer" }).click();

  await logout(page);
  const client = await createUser({ label: "cligig", kycStatus: "verifie" });
  await login(page, client);
  await page.goto("/profil/" + user.id);
  await expect(page.getByText(/Fon \(langue maternelle\)/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mes services" }),
  ).toBeVisible();
  await expect(
    page.getByText("Travail soigné, rendu en avance."),
  ).toBeVisible();
  await expect(page.getByText("✓ Logo")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Mensah");

  // La carte ouvre la page publique du service ; « Commander » la Premium mène à Offres, Premium ouverte.
  await page.getByRole("heading", { name: /Je vais créer un logo professionnel/ }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp("/services/" + gig.id));
  await selectTab(page, "Premium");
  await page.getByRole("link", { name: /^Commander — 90/ }).click();
  await expect(page).toHaveURL(
    new RegExp("/client/offres\\?gig=" + gig.id + "&tier=premium"),
  );
  await expect(page.getByRole("radio", { name: "Premium" })).toBeChecked();
  await page.getByRole("button", { name: /^Commander — 90/ }).click();
  await expect
    .poll(
      async () =>
        (
          await prisma.gigOrder.findFirst({
            where: { gigId: gig.id, clientId: client.id },
          })
        )?.montant ?? 0,
      { timeout: 15000 },
    )
    .toBe(90000);
});

// Gestion « Mes services » (2026-11-08) : ordre, ce qui manque pour publier, filtres,
// suppression confirmée (refusée pour un service commandé), modification d'un service en ligne.
test("S-02 Mes services : liste, modifier, supprimer", async ({ page }) => {
  test.setTimeout(150_000);
  const { user, online, draft, legacy } =
    await seedProviderWithServices("svcafter");
  await login(page, user);
  await page.goto("/profile?tab=services");
  const r = page.locator("#rubrique-services");
  await expect(
    r.getByRole("listitem").filter({ hasText: online.titre }),
  ).toBeVisible();
  // Ordre : en ligne d'abord, puis brouillons.
  const titres = await r.locator("ul.divide-y > li").allInnerTexts();
  expect(titres.findIndex((t) => t.includes(draft.titre))).toBeGreaterThan(
    titres.findIndex((t) => t.includes(online.titre)),
  );
  // Le brouillon dit ce qui manque.
  const rowDraft = r.getByRole("listitem").filter({ hasText: draft.titre });
  await expect(rowDraft).toContainText("Pour publier : visuel");

  // Filtre
  await r.getByRole("button", { name: /^Brouillons/ }).click();
  await expect(
    r.getByRole("listitem").filter({ hasText: online.titre }),
  ).toHaveCount(0);
  await r.getByRole("button", { name: /^Tous/ }).click();

  // Supprimer : bloqué pour le service commandé.
  await r
    .getByRole("button", { name: "Plus d'actions — " + legacy.titre })
    .click();
  await expect(r.getByRole("menuitem", { name: /Supprimer/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Supprimer le brouillon, avec confirmation.
  await r
    .getByRole("button", { name: "Plus d'actions — " + draft.titre })
    .click();
  await r.getByRole("menuitem", { name: /Supprimer/ }).click();
  await expect(r.getByRole("alertdialog")).toContainText("irréversible");
  await r.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(r.getByRole("status")).toContainText("a été supprimé");
  expect(await prisma.gig.findUnique({ where: { id: draft.id } })).toBeNull();

  // Modifier le service en ligne.
  await r
    .getByRole("listitem")
    .filter({ hasText: online.titre })
    .getByRole("button", { name: "Modifier", exact: true })
    .click();
  await r
    .getByLabel("Titre du service")
    .fill("créer un logo mémorable pour votre marque");
  await r
    .getByRole("button", { name: "Enregistrer et garder en ligne" })
    .click();
  await expect(r.getByRole("status")).toContainText("Service enregistré");
  await expect(
    r.getByText("Je vais créer un logo mémorable pour votre marque"),
  ).toBeVisible();
  expect(
    (await prisma.gig.findUniqueOrThrow({ where: { id: online.id } })).status,
  ).toBe("publie");
});

// Déconnexion RÉELLE depuis le tableau de bord (c'était un simple lien vers /signin, la session
// restait ouverte) ; la carte d'un service de l'accueil ouvre sa page PUBLIQUE (et non le tableau
// de bord du compte connecté) ; « Commander » passe par la connexion et ouvre la formule choisie.
test("S-03 déconnexion réelle ; la carte d'un service ouvre sa page publique", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Ce test met un service BADGÉ et récent en tête de l'accueil : il le retire en fin de test
  // (et ceux d'exécutions interrompues), sinon il évincerait des six cartes ceux d'E-06.
  const cleanup = () =>
    prisma.gig.deleteMany({
      where: { provider: { email: { startsWith: "pw-svcpub-" } } },
    });
  await cleanup();
  const { online, user: presta } = await seedProviderWithServices("svcpub");
  await prisma.gig.update({
    where: { id: online.id },
    data: { createdAt: new Date() },
  });
  await prisma.profile.updateMany({
    where: { userId: presta.id },
    data: { badgeStatus: "accorde" },
  });
  const canon = await createUser({
    label: "canon",
    kycStatus: "verifie",
    firstname: "Canon",
  });
  try {
    // 1. Le bouton « Déconnexion » du tableau de bord ferme VRAIMENT la session.
    await login(page, canon);
    await page.goto("/client/dashboard");
    // Session JWT : une requête /api/auth/session encore en vol au moment du clic peut
    // réécrire le cookie après la déconnexion (serveur de dev lent sous charge). On attend que
    // le tableau de bord ait fini de charger, comme le ferait un utilisateur.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Déconnexion" }).first().click();
    await expect(page).toHaveURL(/localhost:\d+\/$/, { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).some((c) =>
            c.name.endsWith("authjs.session-token"),
          ),
        { timeout: 15_000 },
      )
      .toBe(false);

    // 2. Déconnecté : la carte d'un service ouvre sa page publique, pas un tableau de bord.
    const section = page.locator("section", {
      has: page.getByRole("heading", { name: "Nouveaux services publiés" }),
    });
    await section.locator(`a[href^="/services/${online.id}"]`).click();
    await expect(page).toHaveURL(new RegExp("/services/" + online.id), {
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      online.titre,
    );
    await expect(page.getByText("Déconnexion")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Comparer les formules" }),
    ).toBeVisible();

    // 3. « Commander » la Premium : connexion, puis la formule Premium ouverte dans Offres.
    await selectTab(page, "Premium");
    await page.getByRole("link", { name: /^Commander — 75/ }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=/, { timeout: 30_000 });
    await page.getByLabel("Adresse email").fill(canon.email);
    await page
      .getByRole("button", { name: "Recevoir un code de connexion" })
      .click();
    await expect(page).toHaveURL(/verify-otp.*callbackUrl=/);
    await typeOtp(page, await seedOtp(canon));
    await expect(page).toHaveURL(
      new RegExp("/client/offres\\?gig=" + online.id + "&tier=premium"),
      { timeout: 30_000 },
    );
    // (Première compilation de /api/gigs/[id] en dev : peut dépasser le délai par défaut.)
    await expect(page.getByRole("radio", { name: "Premium" })).toBeChecked({ timeout: 45_000 });

    // 4. Connecté, /signin le dit au lieu d'afficher un formulaire vide.
    await page.goto("/signin");
    await expect(page.getByRole("status")).toContainText(
      "Vous êtes déjà connecté(e)",
    );
  } finally {
    await cleanup();
  }
});

// Jusqu'à 3 photos par service (2026-11-08) : ajout groupé, choix de la couverture, carrousel sur
// la carte du profil public (flèches et points font défiler sans ouvrir), la photo ouvre le service.
const photo = (f: string) => ({ name: f, mimeType: "image/webp", buffer: readFileSync(path.join("public/images/services", f)) });

test("S-04 trois photos par service, en carrousel sur la carte", async ({ page }) => {
  test.setTimeout(180_000);
  const { user, draft } = await seedProviderWithServices("svcphotos");
  await login(page, user);
  await page.goto("/profile?tab=services");
  const r = page.locator("#rubrique-services");
  await r.getByRole("listitem").filter({ hasText: draft.titre }).getByRole("button", { name: "Modifier", exact: true }).click();

  await r.getByLabel("Ajouter des photos").setInputFiles([photo("plomberie.webp"), photo("electricite.webp"), photo("carrelage.webp")]);
  const slots = r.getByRole("list", { name: "Photos du service" });
  await expect(slots.getByRole("img")).toHaveCount(3, { timeout: 20_000 });
  await expect(r.getByText("3/3 photos")).toBeVisible();
  await r.getByRole("button", { name: "Mettre la photo 3 en couverture" }).click();
  await expect.poll(async () => (await prisma.gig.findUniqueOrThrow({ where: { id: draft.id } })).imagePaths[0], { timeout: 10_000 }).toContain("photo");
  const paths = (await prisma.gig.findUniqueOrThrow({ where: { id: draft.id } })).imagePaths;
  expect(paths).toHaveLength(3);
  await r.getByRole("button", { name: "Publier le service" }).click();
  await expect(r.getByRole("status")).toContainText("Service enregistré", { timeout: 20_000 });
  expect((await prisma.gig.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("publie");

  // Profil public : carrousel sur la carte.
  await page.goto("/profil/" + user.id);
  const carte = page.getByRole("listitem").filter({ hasText: draft.titre });
  const carrousel = carte.getByRole("region", { name: "Photos — " + draft.titre });
  await expect(carrousel.getByText("1/3")).toBeVisible();
  await carrousel.hover();
  await carrousel.getByRole("button", { name: "Photo suivante" }).click();
  await expect(carrousel.getByText("2/3")).toBeVisible();
  await expect(page).toHaveURL(new RegExp("/profil/" + user.id));
  await carrousel.getByRole("button", { name: "Photo 3 sur 3" }).click();
  await expect(carrousel.getByText("3/3")).toBeVisible();
  // La photo mène au service.
  await carrousel.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp("/services/" + draft.id));
  await expect(page.getByRole("region", { name: "Photos — " + draft.titre }).getByText("1/3")).toBeVisible();

  // Page du service (2026-11-09) : les photos défilent seules, s'arrêtent au survol et sur
  // « Pause », et jamais quand l'utilisateur a demandé à réduire les animations.
  const galerie = page.getByRole("region", { name: "Photos — " + draft.titre });
  await page.mouse.move(0, 0);
  await expect(galerie.getByText("2/3")).toBeVisible({ timeout: 10_000 });
  await galerie.hover();
  const pendantSurvol = await galerie.getByText(/^\d\/3$/).innerText();
  await page.waitForTimeout(5_000);
  await expect(galerie.getByText(/^\d\/3$/)).toHaveText(pendantSurvol);
  await galerie.getByRole("button", { name: "Mettre en pause le défilement des photos" }).click();
  await page.mouse.move(0, 0);
  const enPause = await galerie.getByText(/^\d\/3$/).innerText();
  await page.waitForTimeout(5_000);
  await expect(galerie.getByText(/^\d\/3$/)).toHaveText(enPause);
  await expect(galerie.getByRole("button", { name: "Relancer le défilement des photos" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.mouse.move(0, 0);
  await expect(galerie.getByText("1/3")).toBeVisible();
  await page.waitForTimeout(5_500);
  await expect(galerie.getByText("1/3")).toBeVisible();
  await expect(galerie.getByRole("button", { name: /défilement des photos/ })).toHaveCount(0);
});

// Page publique d'un service SANS JavaScript (2026-11-08) : le choix de la formule (boutons
// radio + CSS) et « Commander » (lien) marchent avant l'hydratation — un clic donné pendant le
// chargement, sur un réseau lent, n'est plus perdu.
test("S-05 formules et « Commander » fonctionnent sans JavaScript", async ({ browser }) => {
  test.setTimeout(120_000);
  const { online } = await seedProviderWithServices("svcnojs");
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto("/services/" + online.id);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(online.titre);
    // Standard cochée par défaut, son panneau seul visible.
    await expect(page.getByRole("radio", { name: "Standard" })).toBeChecked();
    await expect(page.getByRole("link", { name: /^Commander — 50/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Commander — 75/ })).toBeHidden();
    // Premium : le panneau change, et le lien de commande vise la Premium.
    await page.getByRole("radio", { name: "Premium" }).check();
    const commander = page.getByRole("link", { name: /^Commander — 75/ });
    await expect(commander).toBeVisible();
    await expect(page.getByRole("link", { name: /^Commander — 50/ })).toBeHidden();
    await expect(commander).toHaveAttribute("href", `/client/offres?gig=${online.id}&tier=premium`);
  } finally {
    await context.close();
  }
});

test("S-06 « Commander » sur son propre service : connexion, puis refus clair — jamais de commande", async ({ page }) => {
  const { user, online } = await seedProviderWithServices("selforder");
  // Déconnecté, sur la page publique de SON service.
  await page.goto(`/services/${online.id}?returnTo=%2F`);
  await page.getByRole("link", { name: /^Commander/ }).first().click();
  await expect(page).toHaveURL(/\/signin\?callbackUrl=/);
  await page.getByLabel("Adresse email").fill(user.email);
  await page.getByRole("button", { name: "Recevoir un code de connexion" }).click();
  await expect(page).toHaveURL(/verify-otp/);
  await typeOtp(page, await seedOtp(user));

  await expect(page).toHaveURL(/\/client\/offres\?gig=/, { timeout: 30_000 });
  await expect(page.getByText("Vous ne pouvez pas commander votre propre service.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gérer mes services" })).toHaveAttribute("href", "/profile?tab=services");
  await expect(page.getByRole("button", { name: /^Commander/ })).toHaveCount(0);

  // Ni dans le catalogue, ni par l'API.
  // (Le titre du service de démonstration est commun à tous les comptes de test : on vérifie
  // l'absence par identifiant, dans la liste que reçoit le catalogue.)
  const catalogue = (await (await page.request.get("/api/gigs")).json()) as { items: { id: string }[] };
  expect(catalogue.items.length).toBeGreaterThan(0);
  expect(catalogue.items.map((g) => g.id)).not.toContain(online.id);
  const res = await page.request.post(`/api/gigs/${online.id}/purchase`, { data: { tier: "basique" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("self_dealing_forbidden");
  expect(await prisma.gigOrder.count({ where: { gigId: online.id } })).toBe(0);
});
