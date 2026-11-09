import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { prisma } from "./support/db";
import { contractWithRetention, fundedDayContract } from "./support/contracts";

// K — Versements retenus faute de compte de versement vérifié (PLAN_TESTS_GLOBAL.md).

test.describe("K — compte de versement non vérifié", () => {
  test("K-02 constater un relevé de PRE-M : approuvé, « versé dès la vérification du compte »", async ({ page }) => {
    const client = await createUser({ label: "clik02" });
    const preM = await createUser({ label: "prem", role: "manoeuvre", payout: "en_attente" });
    const { mission, attendanceId, tarif } = await fundedDayContract(client.id, preM.id);

    await login(page, client);
    await page.goto(`/missions/${mission.id}/escrow`);
    await page.getByRole("button", { name: "Constater", exact: true }).click();
    await page.getByRole("button", { name: "Constater et libérer" }).click();
    await expect(
      page.getByText("Présence constatée. La somme est due au prestataire et lui sera versée dès que son compte de versement sera vérifié.")
    ).toBeVisible();

    const releve = await prisma.attendance.findUniqueOrThrow({ where: { id: attendanceId } });
    expect(releve.status).toBe("approved");
    // Créance enregistrée, aucune instruction de versement émise.
    expect(await prisma.payable.findUniqueOrThrow({ where: { id: releve.payableId! } })).toMatchObject({
      status: "validated",
      amount: tarif,
      escrowOperationId: null,
    });
  });

  test("K-06 solder la retenue d'une mission arrêtée : refusé tant que le compte n'est pas vérifié, puis relancé", async ({ page }) => {
    const client = await createUser({ label: "clik06" });
    const preM = await createUser({ label: "premret", role: "artisan", payout: "en_attente" });
    const { mission, contract } = await contractWithRetention(client.id, preM.id);

    await login(page, await createUser({ label: "admmed", adminRole: "mediation" }));
    await page.goto("/admin/contrats");
    await page.getByPlaceholder(/Rechercher par mission/).fill(mission.titre);
    await page.locator("tr", { hasText: mission.titre }).getByRole("button", { name: "Ouvrir" }).click();
    const fiche = page.getByRole("dialog", { name: "Fiche financière du contrat" });
    await fiche.getByLabel("Justification du solde de retenue").fill("Mission arrêtée, ouvrage réceptionné sans réserve");
    await fiche.getByRole("button", { name: "Solder la retenue" }).click();
    await expect(fiche.getByRole("alert")).toContainText("Le compte de versement du prestataire n'est pas vérifié");
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "retention_release" } })).toBe(0);

    // L'Admin KYC vérifie le compte (D-06) ; le règlement relancé part.
    await prisma.payoutAccount.update({ where: { userId: preM.id }, data: { status: "verifie" } });
    await fiche.getByRole("button", { name: "Solder la retenue" }).click();
    await expect(page.getByText(/Retenue de .*5\s?000.* instruite/)).toBeVisible();
    expect(await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId: contract.id, instructionType: "retention_release" } })).toMatchObject({
      amount: 5_000,
    });
  });
});
