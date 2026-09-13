/**
 * Régression (2026-09-09) : une demande de révision pose `MissionProposal.revisionRequestedAt`
 * sans changer `status`. Aucune transition terminale ne remettait ce champ à null — une
 * candidature finalement REFUSÉE (parce que le client en a retenu une autre) ou ACCEPTÉE
 * continuait donc d'afficher « Révision demandée » sur les quatre vues de candidature, et
 * invitait le prestataire à resoumettre un devis déjà hors course.
 *
 * Ce test vérifie le nettoyage sur les trois chemins de sortie de négociation, avec de
 * vraies routes et un état réellement lu en base — la règle d'affichage correspondante est
 * couverte à part par proposal-status.test.ts.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as devisRejectPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/reject/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { acceptProposal } from "@/lib/accept-proposal";
import { prisma } from "@/lib/db";

let clientId = "";
let providerAId = "";
let providerBId = "";
const missionIds: string[] = [];

const DEVIS = { lineItems: [], laborCost: 0, totalHT: 100000, tva: 0, totalTTC: 100000, tvaRate: 0, delay: "", notes: "" };

async function createMissionWithTwoProposals(budgetType: "QUOTE" | "FIXED") {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Test nettoyage révision (${budgetType})`,
      description: "Fixture de test — supprimée en fin de suite.",
      domaine: "Plomberie",
      budget: 100000,
      delaiJours: 7,
      budgetType,
      status: "publiee",
    },
  });
  missionIds.push(mission.id);

  // Les DEUX candidatures ont une demande de révision en cours au moment de la transition.
  const [a, b] = await Promise.all([
    prisma.missionProposal.create({
      data: { missionId: mission.id, providerId: providerAId, montant: 100000, status: "en_negociation", roundActuel: 1, devisData: DEVIS, revisionRequestedAt: new Date(), revisionRequestMessage: "Merci de détailler la main-d'œuvre." },
    }),
    prisma.missionProposal.create({
      data: { missionId: mission.id, providerId: providerBId, montant: 120000, status: "en_negociation", roundActuel: 1, devisData: DEVIS, revisionRequestedAt: new Date(), revisionRequestMessage: "Trop cher." },
    }),
  ]);
  return { mission, a, b };
}

beforeAll(async () => {
  const [client, providerA, providerB] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: "client", kycStatus: "verifie" } }),
    prisma.user.findFirstOrThrow({ where: { role: "expert_digital", kycStatus: "verifie" } }),
    prisma.user.findFirstOrThrow({ where: { role: "expert_btp_autres", kycStatus: "verifie" } }),
  ]);
  clientId = client.id;
  providerAId = providerA.id;
  providerBId = providerB.id;
  mockAuth.mockResolvedValue({ user: { id: clientId } });
});

afterAll(async () => {
  // Cascade : propositions, notifications et révisions partent avec la mission.
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
});

describe("Sortie de négociation — la demande de révision ne survit pas au statut terminal", () => {
  it("rejet explicite du devis → refusee ET revisionRequestedAt remis à null", async () => {
    const { mission, a } = await createMissionWithTwoProposals("QUOTE");

    const res = await devisRejectPost(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ reason: "Montant hors budget." }) }),
      { params: Promise.resolve({ id: mission.id, proposalId: a.id }) }
    );
    expect(res.status).toBe(200);

    const after = await prisma.missionProposal.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("refusee");
    expect(after.revisionRequestedAt).toBeNull();
    expect(after.revisionRequestMessage).toBeNull();
  });

  it("validation du devis → la retenue ET les écartées sont nettoyées", async () => {
    const { mission, a, b } = await createMissionWithTwoProposals("QUOTE");

    const res = await devisValidatePost(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: mission.id, proposalId: a.id }),
    });
    expect(res.status).toBe(200);

    const retenue = await prisma.missionProposal.findUniqueOrThrow({ where: { id: a.id } });
    expect(retenue.status).toBe("devis_valide");
    expect(retenue.revisionRequestedAt).toBeNull();

    // Le cas qui produisait le pire affichage : candidature écartée mais toujours marquée
    // « Révision demandée ».
    const ecartee = await prisma.missionProposal.findUniqueOrThrow({ where: { id: b.id } });
    expect(ecartee.status).toBe("refusee");
    expect(ecartee.revisionRequestedAt).toBeNull();
  });

  it("acceptation d'une candidature (prix fixe) → retenue et écartées nettoyées", async () => {
    const { mission, a, b } = await createMissionWithTwoProposals("FIXED");
    // acceptProposal ne refuse que les candidatures "envoyee" : on reproduit l'état réel
    // d'une candidature à prix fixe encore ouverte.
    await prisma.missionProposal.updateMany({ where: { missionId: mission.id }, data: { status: "envoyee" } });

    await acceptProposal(mission.id, a.id);

    const retenue = await prisma.missionProposal.findUniqueOrThrow({ where: { id: a.id } });
    expect(retenue.status).toBe("acceptee");
    expect(retenue.revisionRequestedAt).toBeNull();

    const ecartee = await prisma.missionProposal.findUniqueOrThrow({ where: { id: b.id } });
    expect(ecartee.status).toBe("refusee");
    expect(ecartee.revisionRequestedAt).toBeNull();
  });
});
