import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { prisma } from "./support/db";
import { signedFixedContract } from "./support/contracts";

// V — Non fonctionnel (PLAN_TESTS_GLOBAL.md). V-01 (mobile) est dans mobile.spec.ts, V-04 (clavier) dans accessibilite.spec.ts.

test.describe("V-03 — coupure réseau pendant un paiement", () => {
  test("hors ligne : message clair, et le paiement repart une seule fois au retour du réseau", async ({ page, context }) => {
    const client = await createUser({ label: "clireseau" });
    const presta = await createUser({ label: "preseau", role: "expert_digital", payout: "verifie" });
    const { mission, contract } = await signedFixedContract(client.id, presta.id);

    await login(page, client);
    await page.goto(`/missions/${mission.id}/escrow`);
    const payer = page.getByRole("button", { name: "Payer et séquestrer les fonds" });
    await expect(payer).toBeEnabled();

    await context.setOffline(true);
    await payer.click();
    await expect(page.getByText(/^Connexion interrompue : vérifiez votre réseau/)).toBeVisible();
    await expect(payer).toBeEnabled();
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "hold" } })).toBe(0);

    await context.setOffline(false);
    await payer.click();
    await expect(page).toHaveURL(/\/psp-sandbox\/payer/);
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "hold" } })).toBe(1);
  });

  test("réponse perdue après transmission : la reprise n'émet pas un second paiement", async ({ page }) => {
    const client = await createUser({ label: "cliperdu" });
    const presta = await createUser({ label: "preperdu", role: "expert_digital", payout: "verifie" });
    const { mission, contract } = await signedFixedContract(client.id, presta.id);

    await login(page, client);
    await page.goto(`/missions/${mission.id}/escrow`);
    const payer = page.getByRole("button", { name: "Payer et séquestrer les fonds" });

    // Le serveur reçoit et traite la demande, mais la réponse n'arrive jamais au navigateur.
    await page.route("**/escrow/hold", async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    }, { times: 1 });
    await payer.click();
    await expect(page.getByText(/^Connexion interrompue : vérifiez votre réseau/)).toBeVisible();
    await expect(payer).toBeEnabled();
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "hold" } })).toBe(1);

    await payer.click();
    await expect(page.getByText(/^Un paiement est déjà en cours d'autorisation/)).toBeVisible();
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "hold" } })).toBe(1);
  });
});

test.describe("V-02 — volume", () => {
  test("tableau de bord client avec 55 missions : affiché en moins de 2 s", async ({ page }) => {
    const client = await createUser({ label: "clivolume" });
    const RUN = Date.now();
    await prisma.mission.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        clientId: client.id,
        titre: `Mission volume ${RUN} n°${String(i + 1).padStart(2, "0")}`,
        description: "Mission de volume pour la mesure du tableau de bord.",
        domaine: "design",
        budget: 50_000 + i * 1_000,
        currency: "XOF",
        delaiJours: 10,
        status: i % 3 === 0 ? "brouillon" : "publiee",
        createdAt: new Date(Date.now() - (55 - i) * 60_000),
      })),
    });

    await login(page, client);
    // Premier passage : `next dev` compile la page. La mesure porte sur le passage suivant, celui
    // que vit un utilisateur.
    await page.goto("/client/dashboard");
    await expect(page.getByText(`Mission volume ${RUN} n°55`)).toBeVisible({ timeout: 60_000 });

    const t0 = Date.now();
    await page.goto("/client/dashboard");
    await expect(page.getByText(`Mission volume ${RUN} n°55`)).toBeVisible();
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "durée", description: `${ms} ms` });
    console.log(`V-02 tableau de bord client (55 missions) : ${ms} ms`);
    expect(ms).toBeLessThan(2_000);
  });
});
