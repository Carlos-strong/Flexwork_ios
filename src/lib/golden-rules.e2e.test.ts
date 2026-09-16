/**
 * LA RÈGLE D'OR — vérifiée sur tous les modes (§26 du cahier des charges, 2026-09-14).
 *
 *   RÈGLE 1 — Aucune obligation de paiement ne peut être exécutée sans disponibilité préalable
 *   des fonds dans le séquestre. Une validation crée AU MAXIMUM une créance payable.
 *
 *   RÈGLE 2 — Tout montant litigieux, retenu ou non encore validé demeure dans le séquestre
 *   jusqu'à une décision autorisant sa libération ou son remboursement.
 *
 * Ces règles sont respectées par une dizaine de chemins distincts — jalon, point d'étape,
 * acceptation tacite, retenue, pointage, médiation, reliquat, commande Gig. Chacun les tient pour
 * ses propres raisons, et rien ne garantissait qu'un onzième chemin les tiendrait aussi.
 *
 * Ce fichier les vérifie sur l'ÉTAT et non sur le chemin : après CHAQUE opération, quel que soit
 * le mode, le séquestre doit satisfaire les mêmes égalités. C'est l'audit final du §6, exécutable.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  emitContractRefund,
  emitDisputeFreeze,
  emitScopedRelease,
  emitUnfreeze,
  escrowBalance,
  requestContractHold,
} from "@/lib/escrow";
import { checkEscrowInvariants, checkBalanceInvariants, GOLDEN_RULES } from "@/lib/escrow-invariants";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { RETENTION_RATE_J4 } from "@/lib/financing-modes";
import { approveAttendance, disputeAttendance, submitAttendance } from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";

const RUN = Date.now();
let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

/** Assertion des deux règles — appelée après CHAQUE opération de chaque scénario. */
async function assertGoldenRules(contractId: string, etape: string) {
  const violations = await checkEscrowInvariants(contractId);
  expect(violations, `${etape} — ${violations.map((v) => `[${v.rule}] ${v.detail}`).join(" | ")}`).toEqual([]);
}

async function createContract(opts: {
  prix: number;
  retentionRate?: number;
  jalons?: { titre: string; montant: number }[];
  timeTerms?: { rate: number; maxQuantity: number };
}) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Règle d'or ${RUN}-${seq}`,
      description: "Contrat e2e pour l'audit des invariants",
      domaine: "batiment",
      budget: opts.prix,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
    },
  });
  missionIds.push(mission.id);

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: opts.prix, devise: "XOF" },
      currentHash: `hash-or-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      retentionRate: opts.retentionRate ?? 0,
      ...(opts.jalons
        ? {
            fundingGranularity: "upfront" as const,
            jalons: {
              create: opts.jalons.map((j, i) => ({ ordre: i + 1, titre: j.titre, montant: j.montant })),
            },
          }
        : {}),
      ...(opts.timeTerms
        ? {
            spotTimeTerms: {
              create: {
                rateUnit: "day" as const,
                rate: opts.timeTerms.rate,
                maxQuantity: opts.timeTerms.maxQuantity,
                maxAmount: opts.prix,
              },
            },
          }
        : {}),
    },
    include: { jalons: { orderBy: { ordre: "asc" } } },
  });
  contractIds.push(contract.id);

  // Financement unique et confirmé — le point de départ commun à tous les modes.
  const hold = await requestContractHold(contract.id);
  if (!hold.ok) throw new Error(`financement attendu: ${hold.error}`);
  await operateVirtualPsp("authorize", hold.operation.pspReference!);

  return contract;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: `e2e-or-c-${RUN}@flexwork.test`, tel: `+229${RUN}97`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: `e2e-or-p-${RUN}@flexwork.test`, tel: `+229${RUN}98`, role: "manoeuvre", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.attendance.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.spotTimeTerms.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.jalon.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("les deux règles sont énoncées dans les termes du cahier des charges", () => {
  it("elles parlent de créance payable et de maintien au séquestre", () => {
    expect(GOLDEN_RULES.rule1).toMatch(/créance payable/);
    expect(GOLDEN_RULES.rule2).toMatch(/demeure dans le séquestre/);
  });
});

describe("règle d'or — F2 : séquestre unique, libération unique", () => {
  it("tient à chaque étape", async () => {
    const contract = await createContract({ prix: 200_000 });
    await assertGoldenRules(contract.id, "F2 financé");

    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: null,
      currency: "XOF",
      plafond: 200_000,
      targetCumulative: 200_000,
    });
    expect(res.ok).toBe(true);
    await assertGoldenRules(contract.id, "F2 instruit");

    if (res.ok) await operateVirtualPsp("release", res.operation.pspReference!);
    await assertGoldenRules(contract.id, "F2 confirmé");
  });
});

describe("règle d'or — J4 : la retenue reste au séquestre", () => {
  it("tient, et la part retenue n'est JAMAIS disponible", async () => {
    const contract = await createContract({
      prix: 200_000,
      retentionRate: RETENTION_RATE_J4,
      jalons: [
        { titre: "Lot A", montant: 100_000 },
        { titre: "Lot B", montant: 100_000 },
      ],
    });
    await assertGoldenRules(contract.id, "J4 financé");

    const retenue = Math.round(100_000 * RETENTION_RATE_J4);
    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: contract.jalons[0].id,
      currency: "XOF",
      plafond: 100_000 - retenue,
      retentionRate: RETENTION_RATE_J4,
      targetCumulative: 100_000 - retenue,
    });
    expect(res.ok).toBe(true);
    if (res.ok) await operateVirtualPsp("release", res.operation.pspReference!);
    await assertGoldenRules(contract.id, "J4 premier lot payé");

    // RÈGLE 2, en chiffres : la retenue acquise est au séquestre et hors du disponible.
    const b = await escrowBalance(contract.id);
    expect(b.retained).toBe(retenue);
    expect(b.available).toBe(b.held - retenue);
  });
});

describe("règle d'or — S2 : le pointage, la contestation, le gel", () => {
  it("tient à chaque étape, y compris litige ouvert", async () => {
    const contract = await createContract({ prix: 150_000, timeTerms: { rate: 7_500, maxQuantity: 20 } });
    await assertGoldenRules(contract.id, "S2 financé");

    const submitted = await submitAttendance({
      contractId: contract.id,
      workerId: providerId,
      ...dayPeriod(new Date(Date.UTC(2026, 10, 2))),
      declaredQuantity: 6,
    });
    if (!submitted.ok) throw new Error("soumission attendue");
    // RÈGLE 1 : un relevé soumis n'est pas une autorisation de débit.
    await assertGoldenRules(contract.id, "S2 relevé soumis");
    expect((await escrowBalance(contract.id)).released).toBe(0);

    const dispute = await disputeAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 4,
      reason: "Deux journées non constatées",
    });
    expect(dispute).toMatchObject({ ok: true });
    await assertGoldenRules(contract.id, "S2 litige ouvert");

    // RÈGLE 2, en chiffres : les journées contestées sont au séquestre et indisponibles.
    const b = await escrowBalance(contract.id);
    expect(b.blocked).toBe(2 * 7_500);
    expect(b.available).toBe(b.held - b.blocked);
  });
});

describe("règle d'or — sur les chemins de SORTIE", () => {
  it("un remboursement de reliquat ne la rompt pas", async () => {
    const contract = await createContract({ prix: 100_000 });
    await emitScopedRelease({
      contractId: contract.id,
      jalonId: null,
      currency: "XOF",
      plafond: 60_000,
      targetCumulative: 60_000,
    });
    await assertGoldenRules(contract.id, "partiellement libéré");

    await emitContractRefund({ contractId: contract.id, currency: "XOF" });
    await assertGoldenRules(contract.id, "reliquat remboursé");
    expect((await escrowBalance(contract.id)).held).toBe(0);
  });

  it("un gel puis un dégel ne la rompent pas", async () => {
    const contract = await createContract({ prix: 100_000 });
    await emitDisputeFreeze({ contractId: contract.id, currency: "XOF", amount: 40_000 });
    await assertGoldenRules(contract.id, "gelé");
    expect((await escrowBalance(contract.id)).available).toBe(60_000);

    await emitUnfreeze({ contractId: contract.id, currency: "XOF" });
    await assertGoldenRules(contract.id, "dégelé");
    expect((await escrowBalance(contract.id)).available).toBe(100_000);
  });
});

describe("le contrôle DÉTECTE réellement une violation", () => {
  // Un contrôle qui ne trouve jamais rien ne prouve rien : on lui soumet des états impossibles,
  // qu'aucun chemin du code ne sait produire, pour vérifier qu'il les rejette.
  const sain = {
    contractual: 100_000,
    funded: 100_000,
    released: 40_000,
    refunded: 0,
    held: 60_000,
    blocked: 10_000,
    retained: 0,
    releasable: 0,
    available: 50_000,
    owedToProvider: 0,
    refundable: 50_000,
    fundingPending: false,
  };

  it("un état sain ne produit aucune violation", () => {
    expect(checkBalanceInvariants(sain, [])).toEqual([]);
  });

  it("des sorties supérieures au financement sont détectées (règle 1)", () => {
    const v = checkBalanceInvariants({ ...sain, released: 150_000, held: -50_000 }, []);
    expect(v.some((x) => x.rule === "rule1")).toBe(true);
  });

  it("un disponible qui ignore le gel est détecté (règle 2)", () => {
    const v = checkBalanceInvariants({ ...sain, available: 60_000 }, []);
    expect(v.some((x) => x.rule === "rule2")).toBe(true);
  });

  it("une créance payée sans instruction est détectée (règle 1)", () => {
    const v = checkBalanceInvariants(sain, [
      { id: "p1", amount: 10_000, status: "paid", escrowOperationId: null },
    ]);
    expect(v.some((x) => x.rule === "rule1")).toBe(true);
  });

  it("une créance encore « validated » mais déjà instruite est détectée (règle 1)", () => {
    const v = checkBalanceInvariants(sain, [
      { id: "p2", amount: 10_000, status: "validated", escrowOperationId: "op-1" },
    ]);
    expect(v.some((x) => x.rule === "rule1")).toBe(true);
  });

  it("une identité comptable rompue est détectée", () => {
    const v = checkBalanceInvariants({ ...sain, held: 80_000 }, []);
    expect(v.some((x) => x.rule === "accounting")).toBe(true);
  });
});
