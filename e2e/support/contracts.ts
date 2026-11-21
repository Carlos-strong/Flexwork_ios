import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { requestContractHold } from "../../src/lib/escrow";
import { operateVirtualPsp } from "../../src/lib/psp-virtual";
import { dayPeriod } from "../../src/lib/spot-time";
import { submitAttendance } from "../../src/lib/spot-time-actions";

// Contrats déjà signés et financés, posés directement en base : les tests de ce dossier jouent
// l'écran qui SUIT la signature (constat de présence, règlement de retenue). Signature et
// financement ont leurs propres tests (vitest : signature, escrow, psp-virtual).
let seq = 0;
const RUN = Date.now();

/** Contrat au temps (S2J, 7 500 / jour, 20 jours) financé en entier, avec un relevé soumis. */
export async function fundedDayContract(clientId: string, providerId: string) {
  seq += 1;
  const TARIF = 7_500;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Renfort chantier au jour — pw ${RUN}-${seq}`,
      description: "Renfort de chantier rémunéré à la journée.",
      domaine: "batiment",
      budget: TARIF * 20,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: "S2J",
    },
  });
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: TARIF * 20, devise: "XOF" },
      currentHash: `hash-pw-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      spotTimeTerms: { create: { rateUnit: "day", rate: TARIF, maxQuantity: 20, maxAmount: TARIF * 20 } },
    },
  });
  const hold = await requestContractHold(contract.id);
  if (!hold.ok) throw new Error(`financement du contrat refusé : ${JSON.stringify(hold)}`);
  await operateVirtualPsp("authorize", hold.operation.pspReference!);

  const releve = await submitAttendance({
    contractId: contract.id,
    workerId: providerId,
    ...dayPeriod(new Date(Date.UTC(2026, 9, 5))),
    declaredQuantity: 1,
  });
  if (!releve.ok) throw new Error(`relevé refusé : ${releve.error}`);
  return { mission, contract, attendanceId: releve.attendanceId, tarif: TARIF };
}

const confirmedOp = (type: "hold" | "release", amount: number): Prisma.PspEscrowOperationCreateWithoutContractInput => ({
  pspName: "psp-virtuelle",
  pspReference: `${type}_pw_${RUN}_${++seq}`,
  amount,
  currency: "XOF",
  instructionType: type,
  status: "confirmed",
  pspConfirmedAt: new Date(),
});

/**
 * Contrat à jalon unique LIBÉRÉ avec retenue de garantie de 5 % : 100 000 séquestrés, 95 000
 * versés, 5 000 retenus. La mission est arrêtée en cours de route — seule une décision
 * d'administration peut encore verser la retenue.
 */
export async function contractWithRetention(clientId: string, providerId: string) {
  seq += 1;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission arrêtée avec retenue — pw ${RUN}-${seq}`,
      description: "Mission arrêtée : seule la retenue de garantie reste au séquestre.",
      domaine: "batiment",
      budget: 100_000,
      currency: "XOF",
      delaiJours: 30,
      status: "en_cours",
    },
  });
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 100_000, devise: "XOF" },
      currentHash: `hash-pw-ret-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      retentionRate: 0.05,
      jalons: { create: { ordre: 1, titre: "Jalon unique", montant: 100_000, status: "libere" } },
      escrowOperations: { create: [confirmedOp("hold", 100_000), confirmedOp("release", 95_000)] },
    },
  });
  return { mission, contract };
}

/** Contrat à prix fixe (F2) signé des deux parties, pas encore financé. */
export async function signedFixedContract(clientId: string, providerId: string) {
  seq += 1;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Refonte boutique en ligne — pw ${RUN}-${seq}`,
      description: "Mission à prix fixe signée, en attente de mise sous séquestre.",
      domaine: "design",
      budget: 120_000,
      currency: "XOF",
      delaiJours: 20,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: "F2",
    },
  });
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 120_000, devise: "XOF" },
      currentHash: `hash-pw-fix-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
    },
  });
  return { mission, contract };
}
