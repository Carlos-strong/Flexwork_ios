import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login, logout } from "./support/auth";
import { prisma } from "./support/db";
import { applyTo, publishMission } from "./support/missions";

// F-08 — fiche client vue par le prestataire ; G-08 — offre formelle (PLAN_TESTS_GLOBAL.md).

test.describe("F-08 — client non vérifié", () => {
  test("le prestataire voit « Identité non vérifiée » sur la mission d'un client en attente", async ({ page }) => {
    const cliA = await createUser({ label: "clia", kycStatus: "en_attente" });
    await login(page, cliA);
    const mission = await publishMission(page);
    expect(mission.status).toBe("publiee");
    await logout(page);

    await login(page, await createUser({ label: "pred", role: "expert_digital", payout: "verifie" }));
    await page.goto(`/missions/${mission.id}/devis`);
    await expect(page.getByText("Identité non vérifiée")).toBeVisible();
    await expect(page.getByText("KYC Validé")).toHaveCount(0);
  });

  test("…et « KYC Validé » sur celle d'un client vérifié", async ({ page }) => {
    const cliV = await createUser({ label: "cliv" });
    await login(page, cliV);
    const mission = await publishMission(page);
    await logout(page);

    await login(page, await createUser({ label: "pred", role: "expert_digital", payout: "verifie" }));
    await page.goto(`/missions/${mission.id}/devis`);
    await expect(page.getByText("KYC Validé")).toBeVisible();
    await expect(page.getByText("Identité non vérifiée")).toHaveCount(0);
  });
});

test.describe("G-08 — offre formelle", () => {
  async function offreEnvoyee(page: import("@playwright/test").Page) {
    const client = await createUser({ label: "clioffre" });
    const presta = await createUser({ label: "preoffre", role: "expert_digital", payout: "verifie" });
    await login(page, client);
    const mission = await publishMission(page);
    await logout(page);

    await login(page, presta);
    const proposalId = await applyTo(page, mission.id);
    await logout(page);

    // Aucun écran client n'envoie d'offre formelle aujourd'hui : la route est appelée directement,
    // sous la session du client (voir le compte rendu de PLAN_TESTS_GLOBAL.md, G-08).
    await login(page, client);
    const res = await page.request.post(`/api/missions/${mission.id}/proposals/${proposalId}/offer`, {
      data: { titre: "Offre ferme — refonte", description: "Prix ferme, livraison en trois semaines.", montant: 135_000 },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const offerId = (await res.json()).id as string;
    await logout(page);

    await login(page, presta);
    await page.goto(`/missions/${mission.id}`);
    await expect(page.getByRole("heading", { name: "Offre reçue" })).toBeVisible();
    await expect(page.getByText("Offre ferme — refonte")).toBeVisible();
    return { mission, proposalId, offerId };
  }

  test("le prestataire accepte : même état qu'une candidature acceptée", async ({ page }) => {
    const { mission, proposalId, offerId } = await offreEnvoyee(page);
    const reponse = page.waitForResponse((r) => r.url().endsWith(`/api/offers/${offerId}/accept`));
    await page.getByRole("button", { name: "Accepter l'offre" }).click();
    expect((await reponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Accepter l'offre" })).toHaveCount(0);

    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("acceptee");
    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("acceptee");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("proposition_acceptee");
  });

  test("le prestataire refuse : l'offre est close, la mission reste ouverte", async ({ page }) => {
    const { mission, offerId } = await offreEnvoyee(page);
    const reponse = page.waitForResponse((r) => r.url().endsWith(`/api/offers/${offerId}/decline`));
    await page.getByRole("button", { name: "Refuser" }).click();
    expect((await reponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Accepter l'offre" })).toHaveCount(0);

    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("refusee");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("publiee");
  });
});
