/**
 * Le SERVEUR refuse de financer une mission close (16/09/2026).
 *
 * Pendant du test unitaire `mission-closed-funding.test.ts`, qui ne vérifie que la règle. Ici on
 * traverse les deux vrais chemins de financement — le contrat entier et le jalon — sur une
 * mission `cloturee` puis `remboursee`.
 *
 * Le scénario reproduit exactement le trou d'origine : le HOLD initial ÉCHOUE (refus PSP), ce qui
 * laisse `hasInFlightHold` à faux, puis la mission est close. Sans garde de statut, un second
 * débit du client était alors accepté sur un dossier soldé.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import type { UserRole } from "@prisma/client";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { prisma } from "@/lib/db";
import { requestContractHold } from "@/lib/escrow";

const RUN = Date.now();
const LONG = 60_000;
const ids = { client: "", provider: "", missionSimple: "", contratSimple: "", missionJalon: "", contratJalon: "", jalon: "" };

const postReq = () => new Request("http://localhost/api", { method: "POST" });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";

  let n = 0;
  const mk = (key: string, role: UserRole) =>
    prisma.user.create({
      data: {
        email: `closed-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}9`,
        status: "active",
        country: "BJ",
        firstname: "Close",
        lastname: key,
        kycStatus: "verifie",
        role,
      },
    });
  ids.client = (await mk("client", "client")).id;
  ids.provider = (await mk("prestataire", "expert_digital")).id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });

  const dossier = async (suffixe: string, granularity: "upfront" | "per_jalon") => {
    const mission = await prisma.mission.create({
      data: {
        titre: `Mission close ${suffixe} ${RUN}`,
        description: "Régression — financement d'une mission close.",
        domaine: "developpement",
        mode: "distance",
        currency: "XOF",
        budget: 200_000,
        budgetType: "FIXED",
        delaiJours: 10,
        riskLevel: "low",
        status: "cloturee",
        clientId: ids.client,
      },
    });
    const contrat = await prisma.prestationContract.create({
      data: {
        missionId: mission.id,
        clientId: ids.client,
        providerId: ids.provider,
        termsSnapshot: { prix: 200_000 },
        // Les deux signatures : sans elles le refus viendrait de `contract_not_signed`, et le
        // test ne prouverait rien sur le statut de la mission.
        clientSignedAt: new Date(),
        providerSignedAt: new Date(),
        fundingGranularity: granularity,
        currentHash: `closed-${suffixe}-${RUN}`,
      },
    });
    // Le trou d'origine : un HOLD `failed` ne compte pas comme « en vol ».
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contrat.id,
        pspName: "test-closed",
        pspReference: `hold_failed_${suffixe}_${RUN}`,
        amount: 200_000,
        currency: "XOF",
        instructionType: "hold",
        status: "failed",
      },
    });
    return { missionId: mission.id, contractId: contrat.id };
  };

  const simple = await dossier("simple", "upfront");
  ids.missionSimple = simple.missionId;
  ids.contratSimple = simple.contractId;

  const parJalon = await dossier("jalon", "per_jalon");
  ids.missionJalon = parJalon.missionId;
  ids.contratJalon = parJalon.contractId;
  ids.jalon = (
    await prisma.jalon.create({
      data: { contractId: parJalon.contractId, titre: "Phase unique", montant: 200_000, ordre: 1 },
    })
  ).id;
}, LONG);

afterAll(async () => {
  const contrats = [ids.contratSimple, ids.contratJalon];
  const missions = [ids.missionSimple, ids.missionJalon];
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contrats } } });
  await prisma.jalon.deleteMany({ where: { contractId: { in: contrats } } });
  await prisma.mission.deleteMany({ where: { id: { in: missions } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.client, ids.provider] } } });
}, LONG);

describe("financement d'une mission close — les deux chemins refusent", () => {
  it("contrat entier : `cloturee` puis `remboursee` sont refusés, et aucune instruction n'est créée", async () => {
    const avant = await prisma.pspEscrowOperation.count({ where: { contractId: ids.contratSimple } });

    expect(await requestContractHold(ids.contratSimple)).toMatchObject({ ok: false, error: "mission_closed", status: 409 });

    await prisma.mission.update({ where: { id: ids.missionSimple }, data: { status: "remboursee" } });
    expect(await requestContractHold(ids.contratSimple)).toMatchObject({ ok: false, error: "mission_closed", status: 409 });

    // Le refus doit être SEC : pas d'instruction au PSP, donc pas de débit du client.
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: ids.contratSimple } })).toBe(avant);
  }, LONG);

  it("le même contrat redevient finançable si la mission repart — le refus tient au statut, pas au contrat", async () => {
    await prisma.mission.update({ where: { id: ids.missionSimple }, data: { status: "contrat_signe" } });
    const res = await requestContractHold(ids.contratSimple);
    expect(res.ok, "mission rouverte : le financement repasse").toBe(true);

    // Remis en l'état pour ne rien laisser traîner au PSP virtuel.
    if (res.ok) await prisma.pspEscrowOperation.delete({ where: { id: res.operation.id } });
    await prisma.mission.update({ where: { id: ids.missionSimple }, data: { status: "cloturee" } });
  }, LONG);

  it("financement par jalon : la route refuse aussi, par sa propre garde", async () => {
    mockAuth.mockResolvedValue({ user: { id: ids.client, email: `closed-client-${RUN}@flexwork.test` } });
    const res = await jalonHoldPost(postReq(), { params: Promise.resolve({ id: ids.missionJalon, jalonId: ids.jalon }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "mission_closed" });
    expect(await prisma.pspEscrowOperation.count({ where: { jalonId: ids.jalon } })).toBe(0);
  }, LONG);
});
