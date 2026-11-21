/**
 * Mission catégorisée par la taxonomie, de bout en bout (2026-09-23).
 *
 * Le point qui compte : `Mission.domaine` reste le champ sur lequel `src/lib/domain-match.ts`
 * rapproche missions et prestataires. Brancher la cascade sans projeter le libellé du métier
 * dans ce champ produirait des missions proprement rangées que plus aucun prestataire
 * n'atteindrait. Ces tests verrouillent la projection, la cohérence catégorie ⊃ métier, et le
 * fait que le rapprochement continue de fonctionner.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as createMission } from "@/app/api/missions/route";
import { GET as taxonomy } from "@/app/api/taxonomy/route";
import { missionDomainFilter } from "@/lib/domain-match";
import { NextRequest } from "next/server";

const RUN = Date.now();
let clientId = "";
let categorieId = "";
let metierId = "";
let metierLibelle = "";
let autreCategorieId = "";
const missionIds: string[] = [];

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const base = {
  titre: "Réfection plomberie villa",
  description: "Description suffisamment longue pour passer la validation du schéma.",
  delaiJours: 5,
  status: "brouillon" as const,
};

const post = async (body: unknown) => {
  const res = await createMission(
    new Request("http://localhost/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (res.status === 200) missionIds.push((await res.clone().json()).id);
  return res;
};

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `e2e-mtax-${RUN}@flexwork.test`, tel: `+2297${String(RUN).slice(-7)}`, role: "client", country: "BJ" },
  });
  clientId = user.id;

  // Catégorie STABLE (2026-10-01) : la plus ancienne qui ait un métier — celles du référentiel.
  // Un `findFirst` sans ordre pouvait tomber sur une catégorie de test qu'un autre fichier, exécuté
  // en parallèle, crée sans métier ou supprime en cours de route.
  const cat = await prisma.categorie.findFirst({ where: { metiers: { some: {} } }, orderBy: { id: "asc" }, include: { metiers: { take: 1, orderBy: { id: "asc" } } } });
  categorieId = cat!.id;
  metierId = cat!.metiers[0].id;
  metierLibelle = cat!.metiers[0].libelle;
  const autre = await prisma.categorie.findFirst({ where: { id: { not: categorieId }, metiers: { some: {} } }, orderBy: { id: "asc" } });
  autreCategorieId = autre!.id;
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: clientId } });
});

describe("GET /api/taxonomy — l'arbre servi à la cascade", () => {
  it("sert catégories et métiers, sans les compétences", async () => {
    const res = await taxonomy(new NextRequest("http://localhost/api/taxonomy"));
    expect(res.status).toBe(200);
    const { categories } = await res.json();
    expect(categories.length).toBeGreaterThanOrEqual(20);
    // Les 1 306 compétences ne doivent PAS partir avec l'arbre : 98 Ko au lieu de 16.
    expect(categories[0].metiers[0]).not.toHaveProperty("services");
    expect(categories[0].metiers[0]).toHaveProperty("libelle");
  });

  it("sert les compétences d'un métier à la demande", async () => {
    const res = await taxonomy(new NextRequest(`http://localhost/api/taxonomy?metierId=${metierId}`));
    const { services } = await res.json();
    expect(services.length).toBeGreaterThan(0);
    expect(Object.keys(services[0]).sort()).toEqual(["description", "id", "libelle"]);
  });

  it("reste lisible sans authentification, comme le reste du catalogue", async () => {
    as(null);
    expect((await taxonomy(new NextRequest("http://localhost/api/taxonomy"))).status).toBe(200);
  });
});

describe("création avec métier", () => {
  it("projette le libellé du métier dans `domaine`, pour que le rapprochement tienne", async () => {
    as(clientId);
    const res = await post({ ...base, categorieId, metierId, tags: ["Soudure"] });
    expect(res.status).toBe(200);

    const mission = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(mission?.metierId).toBe(metierId);
    expect(mission?.categorieId).toBe(categorieId);
    expect(mission?.domaine).toBe(metierLibelle);
  });

  it("reste trouvable par un prestataire du même domaine", async () => {
    // Le filtre réel de GET /api/missions, appliqué au libellé projeté.
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, ...missionDomainFilter(metierLibelle) },
    });
    expect(found.length).toBeGreaterThan(0);
  });

  it("déduit la catégorie quand seul le métier est fourni", async () => {
    as(clientId);
    await post({ ...base, metierId });
    const mission = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(mission?.categorieId).toBe(categorieId);
  });

  it("refuse un métier qui n'appartient pas à la catégorie annoncée", async () => {
    as(clientId);
    const res = await post({ ...base, categorieId: autreCategorieId, metierId });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("metier_categorie_mismatch");
  });

  it("répond 404 sur un métier inexistant, pas 500", async () => {
    as(clientId);
    expect((await post({ ...base, metierId: "inexistant" })).status).toBe(404);
  });
});

describe("compatibilité avec le domaine libre", () => {
  it("accepte encore une mission sans taxonomie", async () => {
    as(clientId);
    const res = await post({ ...base, domaine: "Plomberie artisanale" });
    expect(res.status).toBe(200);
    const mission = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(mission?.domaine).toBe("Plomberie artisanale");
    expect(mission?.metierId).toBeNull();
  });

  it("exige un domaine quand aucun métier n'est choisi", async () => {
    as(clientId);
    const res = await post({ ...base });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("domaine_required");
  });
});

describe("champs de cadrage", () => {
  it("persiste lieu, urgence, matériel, cahier des charges et plafond", async () => {
    as(clientId);
    await post({
      ...base,
      metierId,
      dateDebut: "2026-07-01T00:00:00.000Z",
      pays: "BJ",
      ville: "Cotonou",
      quartier: "Fidjrossè",
      urgent: true,
      materiel: "client",
      cahierDesCharges: "Accès au site entre 8h et 17h.",
      maxCandidatures: 5,
    });
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.ville).toBe("Cotonou");
    expect(m?.quartier).toBe("Fidjrossè");
    expect(m?.urgent).toBe(true);
    expect(m?.materiel).toBe("client");
    expect(m?.cahierDesCharges).toContain("8h");
    expect(m?.maxCandidatures).toBe(5);
    expect(m?.dateDebut?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("retombe sur le pays du compte quand le lieu n'est pas précisé", async () => {
    as(clientId);
    await post({ ...base, metierId });
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.pays).toBe("BJ");
  });

  it("refuse une fourchette inversée", async () => {
    as(clientId);
    const res = await post({ ...base, metierId, budgetMin: 900000, budgetMax: 400000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("budget_range_inverted");
  });

  it("laisse le plafond de candidatures à null quand rien n'est demandé", async () => {
    as(clientId);
    await post({ ...base, metierId });
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.maxCandidatures).toBeNull();
    expect(m?.urgent).toBe(false);
  });
});

describe("cohérence rémunération ⇄ financement (défense en profondeur)", () => {
  it("refuse un régime « Taux » financé par un mode qui n'est pas au temps", async () => {
    as(clientId);
    // Le formulaire lie déjà les deux, mais ce lien ne vivait QUE dans l'UI : un appel direct
    // publiait « un taux journalier financé par jalons — une combinaison qu'aucun contrat ne
    // sait exécuter ».
    const res = await post({ ...base, metierId, budgetType: "RATE", financingModeKey: "J1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("rate_requires_time_mode");
  });

  it("accepte un régime « Taux » avec un mode au temps", async () => {
    as(clientId);
    const res = await post({
      ...base,
      metierId,
      budgetType: "RATE",
      financingModeKey: "S2J",
      timeRate: 5000,
      timeMaxQuantity: 40,
    });
    expect(res.status).toBe(200);
  });

  it("accepte le mode hebdomadaire S2W, ajouté au catalogue", async () => {
    as(clientId);
    const res = await post({
      ...base,
      metierId,
      budgetType: "RATE",
      financingModeKey: "S2W",
      timeRate: 50000,
      timeMaxQuantity: 4,
    });
    expect(res.status).toBe(200);
    const mission = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(mission?.financingModeKey).toBe("S2W");
    expect(mission?.budgetType).toBe("RATE");
  });

  it("laisse un montant fixe choisir librement son mode hors famille temps", async () => {
    as(clientId);
    expect((await post({ ...base, metierId, budgetType: "FIXED", financingModeKey: "F2", budget: 200000 })).status).toBe(200);
    expect((await post({ ...base, metierId, budgetType: "FIXED", financingModeKey: "J1", budget: 200000 })).status).toBe(200);
  });
});

describe("devise de la mission", () => {
  it("respecte la devise envoyée plutôt que d'imposer XOF", async () => {
    as(clientId);
    await post({ ...base, metierId, currency: "NGN" });
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.currency).toBe("NGN");
  });

  it("retombe sur XOF quand rien n'est précisé", async () => {
    as(clientId);
    await post({ ...base, metierId });
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.currency).toBe("XOF");
  });

  it("refuse une devise hors catalogue", async () => {
    as(clientId);
    // `Mission.currency` est une colonne `String` : sans liste fermée, n'importe quel code à
    // trois lettres entrait et se retrouvait affiché tel quel au récapitulatif.
    const res = await post({ ...base, metierId, currency: "GBP" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_payload");
  });
});

describe("brouillon tolérant par construction", () => {
  it("enregistre un texte à peine commencé", async () => {
    // `missionSchema` valide AUSSI les brouillons, inachevés par nature : exiger 10 et 50
    // caractères empêcherait d'enregistrer « Plomberie » à la sortie de l'étape 1, c'est-à-dire
    // le seul travail que le client ait commencé. Si quelqu'un remonte un jour le minimum du
    // SCHÉMA à 10, c'est ce test qui tombe — et c'est voulu.
    as(clientId);
    const res = await post({ ...base, metierId, titre: "abc", description: "Début de saisie." });
    expect(res.status).toBe(200);
    const m = await prisma.mission.findUnique({ where: { id: missionIds.at(-1)! } });
    expect(m?.titre).toBe("abc");
    expect(m?.status).toBe("brouillon");
  });
});
