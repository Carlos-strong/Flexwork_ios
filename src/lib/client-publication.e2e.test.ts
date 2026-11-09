/**
 * Côté CLIENT — publication et changement de mode avant contrat, par les vraies routes.
 *
 * Plan de tests (PLAN_TESTS_MODELE_PAIEMENT.md) : C-P06, C-P07, T-C07, T-C08, T-C09, T-C18,
 * T-C19, V-P04, V-P05, V-P07, C-K12, T-M01 à T-M04.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { PATCH as financingModePatch } from "@/app/api/missions/[id]/financing-mode/route";
import { PATCH as siteManagerPatch } from "@/app/api/missions/[id]/site-manager/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const ids = { client: "", provider: "", manager: "" };
const missionIds: string[] = [];
let categorieOprId = "";

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const jsonReq = (method: string, body: unknown) =>
  new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });

/** Publie (par défaut) une mission ; renvoie la réponse brute et, si créée, la mission en base. */
async function publier(body: Record<string, unknown>) {
  authAs(ids.client);
  const res = await missionPost(
    jsonReq("POST", {
      titre: `Publication client ${RUN}`,
      description: "Mission de test côté client : publication, modes et vérification.",
      domaine: "batiment",
      mode: "distance",
      currency: "XOF",
      delaiJours: 15,
      status: "publiee",
      ...body,
    })
  );
  const data = await res.clone().json().catch(() => ({}));
  if (data.id) missionIds.push(data.id);
  const mission = data.id ? await prisma.mission.findUniqueOrThrow({ where: { id: data.id } }) : null;
  return { res, data, mission };
}

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: string) =>
    prisma.user.create({
      data: {
        email: `cp-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}3`,
        status: "active",
        country: "BJ",
        kycStatus: "verifie",
        role: role as "client",
      },
    });
  ids.client = (await mk("client", "client")).id;
  ids.provider = (await mk("prestataire", "artisan")).id;
  ids.manager = (await mk("responsable", "responsable_chantier")).id;
  categorieOprId = (await prisma.categorie.create({ data: { libelle: `CP OPR ${RUN}`, allowsOprVerification: true } })).id;
});

afterAll(async () => {
  await prisma.prestationContract.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.categorie.deleteMany({ where: { id: categorieOprId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

describe("publication — le client ne fixe plus fixe/jalons", () => {
  it("C-P06 — mission à prix fixe ou en devis publiée sans mode de paiement", async () => {
    const fixe = await publier({ budgetType: "FIXED", budget: 120_000 });
    const devis = await publier({ budgetType: "QUOTE" });
    expect(fixe.mission?.financingModeKey).toBeNull();
    expect(devis.mission?.financingModeKey).toBeNull();
  });

  it("C-P07 — un mode fixe/jalons envoyé directement à l'API est ignoré", async () => {
    const { res, mission } = await publier({ budgetType: "FIXED", budget: 120_000, financingModeKey: "J4" });
    expect(res.status).toBe(200);
    expect(mission?.financingModeKey).toBeNull();
  });
});

describe("publication au temps", () => {
  it("T-C07 — S2J sans tarif ni quantité : refusé", async () => {
    const { res } = await publier({ budgetType: "RATE", financingModeKey: "S2J" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("time_terms_required_to_publish");
  });

  it("T-C08 — régime « Taux » sans mode au temps : refusé", async () => {
    const sansMode = await publier({ budgetType: "RATE", budget: 50_000 });
    expect(sansMode.res.status).toBe(400);
    expect(sansMode.data.error).toBe("rate_requires_time_mode");
    const modeJalons = await publier({ budgetType: "RATE", budget: 50_000, financingModeKey: "J1" });
    expect(modeJalons.res.status).toBe(400);
    expect(modeJalons.data.error).toBe("rate_requires_time_mode");
  });

  it("T-C09 — mode S2J envoyé avec « Prix fixe » : la mission est forcée en « Taux »", async () => {
    const { mission } = await publier({ budgetType: "FIXED", financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 });
    expect(mission).toMatchObject({ budgetType: "RATE", financingModeKey: "S2J", budget: 150_000 });
  });

  it("T-C18 — mode de pointage envoyé hors mission au temps : ignoré", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 80_000, attendanceValidation: "totale" });
    expect(mission?.attendanceValidation).toBeNull();
  });

  it("T-C19 — mode de pointage hors liste : refusé", async () => {
    const { res } = await publier({
      budgetType: "RATE",
      financingModeKey: "S2J",
      timeRate: 7_500,
      timeMaxQuantity: 20,
      attendanceValidation: "souple",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_payload");
  });
});

describe("publication en vérification OPR", () => {
  it("V-P04 — responsable inconnu ou compte non responsable : refusé, mission non créée", async () => {
    const avant = await prisma.mission.count({ where: { clientId: ids.client } });
    const inconnu = await publier({
      budgetType: "FIXED",
      budget: 90_000,
      categorieId: categorieOprId,
      validationMode: "opr",
      siteManagerIdentifier: `personne-${RUN}@flexwork.test`,
    });
    expect(inconnu.res.status).toBe(404);
    expect(inconnu.data.error).toBe("site_manager_user_not_found");

    const pasResponsable = await publier({
      budgetType: "FIXED",
      budget: 90_000,
      categorieId: categorieOprId,
      validationMode: "opr",
      siteManagerIdentifier: `cp-prestataire-${RUN}@flexwork.test`,
    });
    expect(pasResponsable.res.status).toBe(409);
    expect(pasResponsable.data.error).toBe("site_manager_not_a_site_manager");

    expect(await prisma.mission.count({ where: { clientId: ids.client } })).toBe(avant);
  });

  it("V-P05 — OPR sans responsable : publiée, responsable à désigner plus tard", async () => {
    const { res, mission } = await publier({ budgetType: "FIXED", budget: 90_000, categorieId: categorieOprId, validationMode: "opr" });
    expect(res.status).toBe(200);
    expect(mission).toMatchObject({ validationMode: "opr", siteManagerId: null });

    // Désignation « plus tard », avant le contrat : posée sur la mission.
    authAs(ids.client);
    const designation = await siteManagerPatch(jsonReq("PATCH", { identifier: `cp-responsable-${RUN}@flexwork.test` }), at(mission!.id));
    expect(designation.status).toBe(200);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission!.id } })).siteManagerId).toBe(ids.manager);
  });

  it("V-P07 — désigner un responsable sur une mission « Moi-même » : refusé", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 90_000 });
    expect(mission?.validationMode).toBe("client");
    authAs(ids.client);
    const res = await siteManagerPatch(jsonReq("PATCH", { identifier: `cp-responsable-${RUN}@flexwork.test` }), at(mission!.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("validation_mode_client");
  });
});

describe("changement de mode avant contrat (PATCH /financing-mode)", () => {
  it("T-M01 — passer une mission à prix fixe en S2J avec ses conditions", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 90_000 });
    authAs(ids.client);
    const res = await financingModePatch(
      jsonReq("PATCH", { financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20, attendanceValidation: "totale" }),
      at(mission!.id)
    );
    expect(res.status).toBe(200);
    expect(await prisma.mission.findUniqueOrThrow({ where: { id: mission!.id } })).toMatchObject({
      budgetType: "RATE",
      financingModeKey: "S2J",
      timeRate: 7_500,
      timeMaxQuantity: 20,
      budget: 150_000,
      attendanceValidation: "totale",
    });
  });

  it("T-M02 — passer en S2J sans conditions : refusé", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 90_000 });
    authAs(ids.client);
    const res = await financingModePatch(jsonReq("PATCH", { financingModeKey: "S2J" }), at(mission!.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("time_terms_required");
  });

  it("T-M03 / C-K12 — quitter le temps (demander J1) : mode et conditions effacés, retour au prix fixe", async () => {
    const { mission } = await publier({ budgetType: "RATE", financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 });
    authAs(ids.client);
    const res = await financingModePatch(jsonReq("PATCH", { financingModeKey: "J1" }), at(mission!.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ financingModeKey: null, paymentModeSetBy: "devis" });
    expect(await prisma.mission.findUniqueOrThrow({ where: { id: mission!.id } })).toMatchObject({
      financingModeKey: null,
      timeRate: null,
      timeMaxQuantity: null,
      attendanceValidation: null,
      budgetType: "FIXED",
    });
  });

  it("S02 — un tiers (ici le prestataire) ne change pas le mode d'une mission qui n'est pas la sienne", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 90_000 });
    authAs(ids.provider);
    const res = await financingModePatch(jsonReq("PATCH", { financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 }), at(mission!.id));
    expect(res.status).toBe(404);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission!.id } })).financingModeKey).toBeNull();
  });

  it("T-M04 — après génération du contrat : figé", async () => {
    const { mission } = await publier({ budgetType: "FIXED", budget: 90_000 });
    await prisma.prestationContract.create({
      data: {
        missionId: mission!.id,
        clientId: ids.client,
        providerId: ids.provider,
        termsSnapshot: { prix: 90_000, devise: "XOF" },
        currentHash: `hash-cp-${RUN}`,
      },
    });
    authAs(ids.client);
    const res = await financingModePatch(jsonReq("PATCH", { financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 }), at(mission!.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("financing_mode_locked");
  });
});
