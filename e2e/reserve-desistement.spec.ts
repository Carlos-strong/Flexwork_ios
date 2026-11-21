// Réserve et désistement (2026-11-11) — src/lib/engagement-withdrawal.ts, src/lib/mission-expiry.ts.
// Les favoris (candidats shortlistés) survivent à la clôture de l'annonce et forment la réserve ;
// un prestataire retenu qui se désiste (ou que le client retire) libère sa place, que le client
// pourvoit depuis la réserve sans republier ; la réserve est libérée à son expiration.
import { expect, test } from "@playwright/test";
import { createUser } from "./support/accounts";
import { login } from "./support/auth";
import { prisma } from "./support/db";
import { applyTo } from "./support/missions";
import { closeExpiredAnnonces, releaseReserves } from "../src/lib/scheduled-tasks";

const DAY = 86_400_000;

test.describe("R — réserve et désistement", () => {
  test("R-01 désistement, remplacement depuis la réserve sans republier, retrait par le client, expiration", async ({ browser }) => {
  test.setTimeout(600_000);
  const client = await createUser({ label: "resclient", firstname: "Rubens", lastname: "Florès" });
  const cp = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
  await login(cp, client);
  const res = await cp.request.post("/api/missions", { data: { titre: "Climatisation de ma maison", description: "Installation de trois climatiseurs split dans la maison, pose et mise en service.", domaine: "batiment", mode: "presentiel", budgetType: "FIXED", budget: 300_000, currency: "XOF", delaiJours: 10, professionalType: "ARTISAN", maxCandidatures: 1, status: "publiee" } });
  const body = await res.json();
  const annonceId = body.id ?? body.mission?.id;
  const people: Record<string, { userId: string; pid: string; email: string }> = {};
  for (const [fn, ln] of [["Kofi", "Mensah"], ["Ama", "Dossa"], ["Yao", "Agbo"], ["Awa", "Sossou"]] as const) {
    const u = await createUser({ label: `res${ln.toLowerCase()}`, role: "artisan", firstname: fn, lastname: ln });
    const pp = await (await browser.newContext()).newPage();
    await login(pp, u);
    people[fn] = { userId: u.id, email: u.email, pid: await applyTo(pp, annonceId, 280_000) };
    await pp.context().close();
  }
  // Favoris : Ama et Yao ; Kofi retenu
  for (const fn of ["Ama", "Yao"]) {
    expect((await cp.request.post(`/api/missions/${annonceId}/proposals/${people[fn].pid}/shortlist`, { data: { shortlisted: true } })).ok()).toBe(true);
  }
  expect((await cp.request.post(`/api/missions/${annonceId}/proposals/${people.Kofi.pid}/accept`)).ok()).toBe(true);
  const eng1 = await prisma.mission.findFirstOrThrow({ where: { parentMissionId: annonceId } });

  // Clôture : réserve gardée, les autres refusés
  await prisma.mission.update({ where: { id: annonceId }, data: { dateExpiration: new Date(Date.now() - 1000) } });
  await closeExpiredAnnonces();
  const st = async (fn: string) => (await prisma.missionProposal.findUniqueOrThrow({ where: { id: people[fn].pid } })).status;
  expect(await st("Ama")).toBe("preselectionnee");
  expect(await st("Yao")).toBe("preselectionnee");
  expect(await st("Awa")).toBe("refusee");

  // Kofi se désiste
  const kp = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const kofi = await prisma.user.findUniqueOrThrow({ where: { id: people.Kofi.userId } });
  await login(kp, { id: kofi.id, email: kofi.email, tel: kofi.tel ?? "" });
  await kp.goto(`/missions/${eng1.id}/proposals`);
  await kp.getByRole("button", { name: "Me désister de cette mission" }).click();
  await kp.getByLabel(/Motif de votre désistement/).fill("Indisponible pour raisons familiales");
  await kp.getByRole("button", { name: "Confirmer le retrait" }).click();
  await expect.poll(async () => (await prisma.mission.findUniqueOrThrow({ where: { id: eng1.id } })).status, { timeout: 30_000 }).toBe("annulee");
  expect((await prisma.mission.findUniqueOrThrow({ where: { id: eng1.id } })).annuleePar).toBe("prestataire");
  expect(await st("Kofi")).toBe("annulee_definitive");

  // Client : Ama en réserve, la retenir
  await cp.goto(`/missions/${annonceId}/proposals`);
  const carte = (name: string) => cp.locator("article", { has: cp.getByRole("heading", { name }) });
  await expect(carte("Ama Dossa").getByText("En réserve", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(cp.getByText(/Votre réserve \(candidats shortlistés\) reste mobilisable/)).toBeVisible();
  // Filtre « Favoris » : les deux candidats de la réserve.
  await cp.getByRole("button", { name: "⭐ Favoris (2)" }).click();
  await expect(cp.locator("article")).toHaveCount(2);
  await cp.getByRole("button", { name: /^Toutes/ }).click();
  await carte("Ama Dossa").getByRole("button", { name: "Choisir ce prestataire" }).click();
  await cp.getByRole("button", { name: /Passer au contrat/ }).click();
  await expect(cp).toHaveURL(/\/missions\/[^/]+\/contract$/, { timeout: 30_000 });
  const eng2 = await prisma.mission.findFirstOrThrow({ where: { parentMissionId: annonceId, status: { not: "annulee" } } });
  expect(eng2.id).not.toBe(eng1.id);
  expect(await st("Ama")).toBe("acceptee");

  // Le client retire Ama
  await cp.goto(`/missions/${annonceId}/proposals`);
  await carte("Ama Dossa").getByRole("button", { name: "Changer ce prestataire" }).click();
  await cp.getByLabel(/Pourquoi changer Ama Dossa/).fill("Ne répond plus depuis 5 jours");
  await cp.getByRole("button", { name: "Confirmer le changement" }).click();
  await expect.poll(async () => (await prisma.mission.findUniqueOrThrow({ where: { id: eng2.id } })).status, { timeout: 30_000 }).toBe("annulee");
  expect((await prisma.mission.findUniqueOrThrow({ where: { id: eng2.id } })).annuleePar).toBe("client");

  // Réserve expirée : Yao libéré
  await prisma.mission.update({ where: { id: annonceId }, data: { dateExpiration: new Date(Date.now() - 31 * DAY) } });
  const { released } = await releaseReserves();
  expect(released).toBeGreaterThanOrEqual(1);
  expect(await st("Yao")).toBe("refusee");
});

  test("R-02 sans favori disponible, le client ne peut pas changer de prestataire", async ({ browser }) => {
    test.setTimeout(300_000);
    const client = await createUser({ label: "nofavcli", firstname: "Rubens", lastname: "Florès" });
    const cp = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
    await login(cp, client);
    const res = await cp.request.post("/api/missions", { data: { titre: "Peinture du salon", description: "Peinture complète du salon, murs et plafond, fournitures comprises.", domaine: "batiment", mode: "presentiel", budgetType: "FIXED", budget: 120_000, currency: "XOF", delaiJours: 5, professionalType: "ARTISAN", maxCandidatures: 1, status: "publiee" } });
    const body = await res.json();
    const annonceId = body.id ?? body.mission?.id;
    const u = await createUser({ label: "nofavpro", role: "artisan", firstname: "Kofi", lastname: "Mensah" });
    const pp = await (await browser.newContext()).newPage();
    await login(pp, u);
    const pid = await applyTo(pp, annonceId, 110_000);
    await pp.context().close();
    expect((await cp.request.post(`/api/missions/${annonceId}/proposals/${pid}/accept`)).ok()).toBe(true);
    const eng = await prisma.mission.findFirstOrThrow({ where: { parentMissionId: annonceId } });

    await cp.goto(`/missions/${annonceId}/proposals`);
    const carte = cp.locator("article", { has: cp.getByRole("heading", { name: "Kofi Mensah" }) });
    await expect(carte.getByRole("link", { name: "Signature du contrat" })).toBeVisible({ timeout: 30_000 });
    await expect(carte.getByRole("button", { name: "Changer ce prestataire" })).toHaveCount(0);
    await expect(carte.getByText("Shortlistez un favori pour pouvoir changer de prestataire.")).toBeVisible();

    // Le serveur applique la même règle.
    const r = await cp.request.post(`/api/missions/${eng.id}/withdraw`, { data: { reason: "Test sans favori" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe("no_favorites");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: eng.id } })).status).not.toBe("annulee");
  });
});
