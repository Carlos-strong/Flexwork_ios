/**
 * Contrat au TEMPS de bout en bout, côté cycle de vie (2026-09-15).
 *
 * `spot-time.e2e.test.ts` verrouille le pointage sur un contrat construit à la main. Ce fichier-ci
 * verrouille les deux chaînons qui manquaient pour qu'un contrat S2 existe et se termine :
 *
 *   1. la GÉNÉRATION — la vraie route crée `SpotTimeTerms` depuis la mission et la candidature.
 *      Avant ce correctif, aucun code hors des tests ne les créait : S2 était publiable et
 *      inexécutable ;
 *   2. la CLÔTURE — le client termine le chantier, le reliquat lui est rendu. Avant, rien ne
 *      disait qu'un chantier était fini, et le reliquat dormait au séquestre (§22).
 *
 * Mode CONSOLE (pas d'autoconfirm) : chaque confirmation PSP est jouée explicitement.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as generateContract } from "@/app/api/missions/[id]/contract/route";
import { prisma } from "@/lib/db";
import { escrowBalance, requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { buildContractSections } from "@/lib/contract-clauses";
import { approveAttendance, closeTimeContract, submitAttendance } from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";

const RUN = Date.now();
const TARIF = 7_500;
const MAX_JOURS = 20;
const PLAFOND = TARIF * MAX_JOURS; // 150 000

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";

const jour = (n: number) => dayPeriod(new Date(Date.UTC(2026, 8, n)));

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: "x@flexwork.test", name: "Testeur", role: "client" } });
}

// Chaque instruction a son action de confirmation à la PSP virtuelle : `authorize` pour un
// financement, `release` pour un versement, `refund` pour un remboursement.
async function confirmer(action: "authorize" | "release" | "refund", pspReference: string | null | undefined) {
  expect(pspReference).toBeTruthy();
  expect((await operateVirtualPsp(action, pspReference!)).ok).toBe(true);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: `e2e-s2-client-${RUN}@flexwork.test`, tel: `+229${RUN}90`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: `e2e-s2-provider-${RUN}@flexwork.test`, tel: `+229${RUN}91`, role: "manoeuvre", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Chantier au temps ${RUN}`,
      description: "Manœuvre rémunéré à la journée, 20 jours maximum.",
      domaine: "batiment",
      budget: PLAFOND,
      budgetType: "RATE",
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "proposition_acceptee",
      financingModeKey: "S2J",
      timeRate: TARIF,
      timeMaxQuantity: MAX_JOURS,
    },
  });
  missionId = mission.id;

  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: PLAFOND, unitRate: TARIF, status: "acceptee", roundActuel: 1 },
  });
});

afterAll(async () => {
  if (contractId) {
    await prisma.attendance.deleteMany({ where: { contractId } });
    await prisma.payable.deleteMany({ where: { contractId } });
    await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
    await prisma.spotTimeTerms.deleteMany({ where: { contractId } });
    await prisma.contractAuditEntry.deleteMany({ where: { contractId } });
    await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  }
  await prisma.missionNotification.deleteMany({ where: { missionId } });
  await prisma.notification.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("génération — un contrat S2 naît avec ses conditions tarifaires", () => {
  it("la route crée SpotTimeTerms depuis la mission et la candidature acceptée", async () => {
    authAs(clientId);
    const res = await generateContract(new Request("http://t/", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
      include: { spotTimeTerms: true, jalons: true },
    });
    contractId = contract.id;

    expect(contract.jalons).toHaveLength(0);
    expect(contract.spotTimeTerms).toMatchObject({
      rateUnit: "day",
      rate: TARIF,
      maxQuantity: MAX_JOURS,
      maxAmount: PLAFOND,
      overtimeAllowed: false,
    });
  });

  it("le contrat signé énonce les mêmes conditions, sans promettre de jalons", async () => {
    const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } });
    const snapshot = contract.termsSnapshot as Parameters<typeof buildContractSections>[0];
    expect(snapshot.conditionsTemps).toEqual({ rateUnit: "day", rate: TARIF, maxQuantity: MAX_JOURS, maxAmount: PLAFOND });

    const a2 = buildContractSections(snapshot).find((s) => s.title.startsWith("Article 2 "))!;
    expect(a2.title).toBe("Article 2 — Rémunération au temps");
  });
});

describe("clôture — le chantier se termine et le reliquat revient au client (§22)", () => {
  beforeAll(async () => {
    await prisma.prestationContract.update({
      where: { id: contractId },
      data: { clientSignedAt: new Date(), providerSignedAt: new Date() },
    });
    const hold = await requestContractHold(contractId);
    expect(hold.ok).toBe(true);
    if (hold.ok) await confirmer("authorize", hold.operation.pspReference);
    expect((await escrowBalance(contractId)).available).toBe(PLAFOND);
  });

  it("refuse de clôturer tant qu'un relevé attend une décision", async () => {
    const res = await submitAttendance({ contractId, workerId: providerId, ...jour(1), declaredQuantity: 4 });
    expect(res.ok).toBe(true);
    expect(await closeTimeContract({ missionId, clientId })).toEqual({ ok: false, error: "attendance_pending", count: 1 });
  });

  it("refuse de clôturer tant qu'un versement reconnu dû n'est pas parti", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    const approuve = await approveAttendance({ attendanceId: releve.id, validatorId: clientId, approvedQuantity: 4 });
    expect(approuve.ok).toBe(true);

    // Le versement de 30 000 est transmis au PSP, pas encore confirmé.
    expect(await closeTimeContract({ missionId, clientId })).toEqual({ ok: false, error: "payment_pending", count: 1 });

    const payable = await prisma.payable.findFirstOrThrow({
      where: { contractId },
      include: { escrowOperation: { select: { pspReference: true } } },
    });
    await confirmer("release", payable.escrowOperation?.pspReference);
  });

  it("seul le client clôture — ni le prestataire, ni un tiers", async () => {
    expect(await closeTimeContract({ missionId, clientId: providerId })).toEqual({ ok: false, error: "not_found" });
  });

  it("clôture, et rend au client les 120 000 non consommés", async () => {
    const res = await closeTimeContract({ missionId, clientId });
    expect(res).toEqual({ ok: true, refunded: PLAFOND - 4 * TARIF });

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");

    const refund = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, instructionType: "refund" } });
    await confirmer("refund", refund.pspReference);

    // Identité comptable : tout ce qui est entré est sorti, vers le prestataire ou vers le client.
    const b = await escrowBalance(contractId);
    expect(b).toMatchObject({ funded: PLAFOND, released: 4 * TARIF, refunded: PLAFOND - 4 * TARIF, held: 0, available: 0 });

    // La clôture d'une mission MENÉE À TERME n'est pas requalifiée « remboursée » par le webhook.
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("cloturee");
  });

  it("après clôture, plus aucune présence ne se déclare, et une seconde clôture ne rembourse rien", async () => {
    expect(await submitAttendance({ contractId, workerId: providerId, ...jour(5), declaredQuantity: 1 })).toEqual({
      ok: false,
      error: "contract_closed",
    });
    expect(await closeTimeContract({ missionId, clientId })).toEqual({ ok: false, error: "already_closed" });
    expect(await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "refund" } })).toBe(1);
  });
});
