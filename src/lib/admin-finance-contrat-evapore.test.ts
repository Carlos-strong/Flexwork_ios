/**
 * Console financière — un contrat disparu ne doit pas blanchir la vue de toute la plateforme
 * (régression du 16/09/2026).
 *
 * `loadContractFinanceRows` lit les contrats, puis demande leurs soldes à `escrowBalancesFor`,
 * qui les relit. Entre les deux requêtes, un contrat peut avoir disparu — `PrestationContract`
 * cascade depuis la mission ET depuis chacune des deux parties, donc effacer un utilisateur
 * emporte ses contrats. Le solde manquait alors à l'appel, et un `!` trompeur le laissait passer
 * en `undefined` : la console entière tombait sur `Cannot read properties of undefined (reading
 * 'funded')`, y compris pour les dossiers intacts.
 *
 * Le défaut a été vu pour de vrai, en concurrence, pendant une exécution de la suite complète.
 * Ici la course est rejouée de façon déterministe : `escrowBalancesFor` renvoie sciemment un
 * solde de moins.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const omis = { contractId: "" };

vi.mock("@/lib/escrow", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/escrow")>();
  return {
    ...reel,
    // Exactement ce que produit la course : la clé du contrat évaporé n'est pas dans la carte.
    escrowBalancesFor: async (ids: string[]) => {
      const soldes = await reel.escrowBalancesFor(ids);
      soldes.delete(omis.contractId);
      return soldes;
    },
  };
});

import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadContractFinanceRows } from "@/lib/admin-finance";

const RUN = Date.now();
const ids = { client: "", provider: "", missionA: "", missionB: "", contratA: "", contratB: "" };

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: UserRole) =>
    prisma.user.create({
      data: {
        email: `evapore-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}3`,
        status: "active",
        country: "BJ",
        firstname: "Evapore",
        lastname: key,
        kycStatus: "verifie",
        role,
      },
    });
  ids.client = (await mk("client", "client")).id;
  ids.provider = (await mk("prestataire", "expert_digital")).id;

  const creerDossier = async (suffixe: string, montant: number) => {
    const mission = await prisma.mission.create({
      data: {
        titre: `Console contrat évaporé ${suffixe} ${RUN}`,
        description: "Mission de régression — console financière.",
        domaine: "developpement",
        mode: "distance",
        currency: "XOF",
        budget: montant,
        budgetType: "FIXED",
        delaiJours: 10,
        status: "contrat_genere",
        clientId: ids.client,
      },
    });
    const contrat = await prisma.prestationContract.create({
      data: {
        missionId: mission.id,
        clientId: ids.client,
        providerId: ids.provider,
        termsSnapshot: {},
        // Chaîne d'audit du contrat : la colonne est unique et obligatoire. Aucune valeur
        // particulière n'est attendue ici, le test ne porte pas sur la signature.
        currentHash: `evapore-${suffixe}-${RUN}`,
      },
    });
    // Le `where` par défaut de la console ne retient que les contrats ayant au moins un mouvement.
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contrat.id,
        pspName: "test-evapore",
        amount: montant,
        currency: "XOF",
        instructionType: "hold",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
    return { missionId: mission.id, contractId: contrat.id };
  };

  const a = await creerDossier("A", 100_000);
  const b = await creerDossier("B", 250_000);
  ids.missionA = a.missionId;
  ids.contratA = a.contractId;
  ids.missionB = b.missionId;
  ids.contratB = b.contractId;
  omis.contractId = a.contractId;
}, 60_000);

afterAll(async () => {
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: [ids.contratA, ids.contratB] } } });
  await prisma.mission.deleteMany({ where: { id: { in: [ids.missionA, ids.missionB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.client, ids.provider] } } });
}, 60_000);

describe("console financière — contrat évaporé entre les deux requêtes", () => {
  it("la ligne sans solde est omise, les autres restent lisibles", async () => {
    const lignes = await loadContractFinanceRows({ id: { in: [ids.contratA, ids.contratB] } });

    // Le point du correctif : plus de TypeError, et le dossier intact survit à la disparition
    // de son voisin. Avant, l'appel entier levait et la console n'affichait plus rien.
    expect(lignes.map((l) => l.contractId)).toEqual([ids.contratB]);

    const survivant = lignes[0];
    expect(survivant.balance.funded).toBe(250_000);
    expect(survivant.financialState).toBeTypeOf("string");
    expect(survivant.violations).toEqual([]);
  }, 60_000);

  it("tous les soldes présents : aucune ligne n'est perdue", async () => {
    omis.contractId = "";
    try {
      const lignes = await loadContractFinanceRows({ id: { in: [ids.contratA, ids.contratB] } });
      expect(new Set(lignes.map((l) => l.contractId))).toEqual(new Set([ids.contratA, ids.contratB]));
    } finally {
      omis.contractId = ids.contratA;
    }
  }, 60_000);
});
