import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { prisma } from "./support/db";

// État et suivi des candidatures au tableau de bord (2026-11-09) : côté prestataire (les
// candidatures envoyées) et côté client (les candidatures reçues), avec la répartition par
// état, les actions attendues, l'étape de chaque candidature et la suite.
test.describe("T — tableau de bord : suivi des candidatures", () => {
  test("T-01 prestataire et client voient chacun l'état, l'étape et la prochaine action", async ({ browser }) => {
    test.setTimeout(180_000);
    const client = await createUser({ label: "tdbclient", firstname: "Awa", lastname: "Client" });
    const presta = await createUser({ label: "tdbpresta", role: "expert_digital", firstname: "Kofi", lastname: "Presta" });
    const stamp = Date.now();
    const base = { clientId: client.id, description: "Mission de test.", domaine: "design", budget: 100_000, currency: "XOF", delaiJours: 10 };
    const mk = async (titre: string, missionStatus: string, proposal: { status: string; revisionRequestedAt?: Date; roundActuel?: number }) => {
      const m = await prisma.mission.create({ data: { ...base, titre: `${titre} — pw ${stamp}`, status: missionStatus as never } });
      await prisma.missionProposal.create({
        data: { missionId: m.id, providerId: presta.id, montant: 90_000, status: proposal.status as never, revisionRequestedAt: proposal.revisionRequestedAt, roundActuel: proposal.roundActuel ?? 0 },
      });
      return m;
    };
    const envoyee = await mk("Logo boutique", "publiee", { status: "envoyee" });
    const revision = await mk("Site vitrine", "publiee", { status: "en_negociation", revisionRequestedAt: new Date(), roundActuel: 1 });
    const contrat = await mk("Charte graphique", "contrat_genere", { status: "acceptee" });
    await mk("Flyers", "publiee", { status: "refusee" });

    // ── Prestataire ────────────────────────────────────────────────────────────────────────
    const pp = await (await browser.newContext()).newPage();
    await login(pp, presta);
    await pp.goto("/dashboard/expert-digital");
    const card = pp.locator("section", { has: pp.getByRole("heading", { name: "Suivi de mes candidatures" }) });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Répartition : 1 en attente, 1 en discussion, 1 retenue, 1 non retenue.
    for (const [label, value] of [["En attente", "1"], ["En discussion", "1"], ["Retenues", "1"], ["Non retenues", "1"]]) {
      await expect(card.locator("dl > div", { hasText: new RegExp(`^${label}`) }).locator("dd")).toHaveText(value);
    }
    // Révision demandée + contrat à signer.
    await expect(card.getByRole("status")).toHaveText("2 candidatures attendent votre action.");
    const rowOf = (c: typeof card, titre: string) => c.getByRole("listitem").filter({ hasText: titre }).first();
    await expect(rowOf(card, revision.titre)).toContainText("Révision demandée");
    await expect(rowOf(card, revision.titre)).toContainText("Le client demande une nouvelle version : à vous de la soumettre.");
    await expect(rowOf(card, contrat.titre)).toContainText("Contrat généré");
    await expect(rowOf(card, contrat.titre)).toContainText("Contrat à signer par les deux parties.");
    await expect(rowOf(card, contrat.titre).getByRole("list", { name: /Étape 4 sur 5/ })).toBeVisible();
    await expect(rowOf(card, envoyee.titre)).toContainText("En attente de la réponse du client.");
    // Les actions attendues sont en tête de liste.
    const titles = await card.locator("ul > li a div.truncate").first().textContent();
    expect([revision.titre, contrat.titre]).toContain(titles?.trim());
    // « Voir tout » mène à la rubrique complète ; une ligne mène à la candidature.
    await expect(card.getByRole("link", { name: "Voir tout →" })).toHaveAttribute("href", "/dashboard/expert-digital/candidatures");
    await expect(rowOf(card, envoyee.titre).getByRole("link")).toHaveAttribute("href", `/missions/${envoyee.id}/proposals`);

    // ── Client ─────────────────────────────────────────────────────────────────────────────
    const cp = await (await browser.newContext()).newPage();
    await login(cp, client);
    // Carte déplacée du tableau de bord vers la page Propositions (2026-11-11).
    await cp.goto("/client/propositions");
    const ccard = cp.locator("section", { has: cp.getByRole("heading", { name: "Candidatures reçues" }) });
    await expect(ccard).toBeVisible({ timeout: 30_000 });
    await expect(ccard.locator("dl > div", { hasText: /^À examiner/ }).locator("dd")).toHaveText("1");
    await expect(ccard.locator("dl > div", { hasText: /^Écartées/ }).locator("dd")).toHaveText("1");
    // Nouvelle candidature à examiner + contrat à signer.
    await expect(ccard.getByRole("status")).toHaveText("2 candidatures attendent votre action.");
    await expect(rowOf(ccard, envoyee.titre)).toContainText("Reçue");
    await expect(rowOf(ccard, envoyee.titre)).toContainText("Kofi Presta");
    await expect(rowOf(ccard, envoyee.titre)).toContainText("Nouvelle candidature : à examiner.");
    await expect(rowOf(ccard, revision.titre)).toContainText("En attente de la nouvelle version du prestataire.");
    await expect(ccard.getByRole("link", { name: "Voir tout →" })).toHaveAttribute("href", "#propositions-liste");
  });

  test("T-02 aucune candidature : la carte le dit au lieu d'une liste vide", async ({ page }) => {
    const presta = await createUser({ label: "tdbvide", role: "expert_digital" });
    await login(page, presta);
    await page.goto("/dashboard/expert-digital");
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Suivi de mes candidatures" }) });
    await expect(card).toContainText("Vous n'avez encore envoyé aucune candidature.", { timeout: 30_000 });
  });
});
