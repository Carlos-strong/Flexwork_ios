/**
 * Palier de risque porté par le métier (2026-09-24).
 *
 * Ce que ces tests verrouillent, et pourquoi ils existent : le palier venait de
 * `DomainRiskLevel`, une table indexée sur un libellé LIBRE. Sur les 220 métiers du catalogue,
 * 4 y trouvaient une ligne, et les 4 lignes « high » — Électricité, Travail en hauteur, Gros
 * œuvre, Engins de chantier — n'en désignaient AUCUN (le catalogue dit « Électricité bâtiment »,
 * « Électricité industrielle »…). `Mission.riskLevel` ne pouvait donc jamais valoir `high`, et
 * l'obligation d'assurance ne s'est jamais déclenchée : ni à la candidature
 * (`candidature-guard.ts`), ni au séquestre (`escrow.ts`). Une règle de conformité qui n'a
 * jamais pu s'appliquer.
 *
 * La chaîne est éprouvée ici de bout en bout :
 *
 *   administrateur → métier classé élevé → publication → assurance EXIGÉE
 *
 * Le dernier maillon (le refus de candidater) est déjà couvert par `candidature-guard.test.ts`,
 * qui pose un `mission.riskLevel = "high"` de toutes pièces. Ce qui manquait, c'est qu'une
 * mission PUISSE l'être — c'est ce qu'on vérifie ici.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as createMission } from "@/app/api/missions/route";
import { POST as categories, PUT as updateCategories } from "@/app/api/categories/route";
import { GET as taxonomy } from "@/app/api/taxonomy/route";
import { NextRequest } from "next/server";

const RUN = Date.now();
let adminId = "";
let clientId = "";
let categorieId = "";
let metierId = "";
const missionIds: string[] = [];

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

// `NextRequest` et non `Request` : les routes de la taxonomie en attendent un (elles lisent
// `nextUrl`). Un `NextRequest` reste un `Request`, donc le même helper sert aussi à la
// publication d'une mission.
const json = (url: string, body: unknown, method = "POST") =>
  new NextRequest(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const base = {
  titre: "Remise aux normes du tableau électrique",
  description: "Description suffisamment longue pour passer la validation du schéma.",
  delaiJours: 5,
  status: "brouillon" as const,
};

const publier = async (body: unknown) => {
  const res = await createMission(json("http://localhost/api/missions", body));
  if (res.status === 200) missionIds.push((await res.clone().json()).id);
  return res;
};

beforeAll(async () => {
  const [admin, client] = await Promise.all([
    // Le rôle `frontend` est le seul à écrire dans la taxonomie (§13 : lire n'est pas agir).
    prisma.user.create({
      data: {
        email: `e2e-risk-admin-${RUN}@flexwork.test`,
        tel: `+2296${String(RUN).slice(-7)}`,
        role: "client",
        isAdmin: true,
        adminRole: "frontend",
      },
    }),
    prisma.user.create({
      data: { email: `e2e-risk-client-${RUN}@flexwork.test`, tel: `+2295${String(RUN).slice(-7)}`, role: "client", country: "BJ" },
    }),
  ]);
  adminId = admin.id;
  clientId = client.id;

  // Catégorie PROPRE au test (2026-10-01) : « la première catégorie de la base » pouvait être une
  // catégorie de test qu'un autre fichier, exécuté en parallèle, supprimait en cours de route —
  // emportant le métier de ce test et faisant échouer la suite par intermittence.
  categorieId = (await prisma.categorie.create({ data: { libelle: `Catégorie palier de risque (test ${RUN})` } })).id;
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId } });
  // Le métier créé par le test d'administration part après ses missions : c'est l'ordre des
  // dépendances, pas une précaution.
  if (metierId) await prisma.metier.deleteMany({ where: { id: metierId } });
  await prisma.metier.deleteMany({ where: { categorieId } });
  await prisma.categorie.deleteMany({ where: { id: categorieId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, clientId] } } });
});

describe("le risque est attribué au métier par l'administrateur", () => {
  it("classe un métier à risque élevé, et le palier est bien enregistré", async () => {
    as(adminId);
    const res = await categories(
      json("http://localhost/api/categories", {
        categorieId,
        metierLibelle: `Électricité bâtiment (test ${RUN})`,
        riskLevel: "high",
      }),
    );
    expect(res.status).toBe(201);
    const metier = (await res.json()).data;
    metierId = metier.id;
    expect(metier.riskLevel).toBe("high");
  });

  it("refuse un palier inconnu au lieu de retomber silencieusement sur « faible »", async () => {
    as(adminId);
    const res = await categories(
      json("http://localhost/api/categories", {
        categorieId,
        metierLibelle: `Métier au palier inventé (test ${RUN})`,
        riskLevel: "extreme",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "risk_level_invalid" });
    // Rien n'a été créé : un refus ne doit pas laisser de métier à moitié classé.
    const cree = await prisma.metier.findFirst({ where: { libelle: `Métier au palier inventé (test ${RUN})` } });
    expect(cree).toBeNull();
  });

  it("n'écrit pas dans la taxonomie depuis un rôle qui n'y a pas droit", async () => {
    as(clientId);
    const res = await categories(
      json("http://localhost/api/categories", { categorieId, metierLibelle: `Métier pirate (test ${RUN})`, riskLevel: "low" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("la mission hérite du palier de son métier", () => {
  it("une mission sur un métier élevé devient « high », et l'assurance est EXIGÉE", async () => {
    as(clientId);
    const res = await publier({ ...base, metierId });
    expect(res.status).toBe(200);
    const mission = (await res.json()) as { id: string };

    const enBase = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(enBase?.riskLevel).toBe("high");
    // `insuranceRequired` n'est pas un réglage à part : il se DÉDUIT du palier. C'est ce
    // couplage qui rend le garde-fou de candidature atteignable.
    expect(enBase?.insuranceRequired).toBe(true);
  });

  it("baisser le palier change la règle pour les missions suivantes", async () => {
    as(adminId);
    const metier = await prisma.metier.findUnique({ where: { id: metierId }, select: { libelle: true } });
    const res = await updateCategories(
      json("http://localhost/api/categories", { id: metierId, libelle: metier!.libelle, riskLevel: "medium", type: "metier" }, "PUT"),
    );
    expect(res.status).toBe(200);

    as(clientId);
    const publiee = await publier({ ...base, metierId });
    expect(publiee.status).toBe(200);
    const enBase = await prisma.mission.findUnique({ where: { id: (await publiee.json()).id } });
    expect(enBase?.riskLevel).toBe("medium");
    expect(enBase?.insuranceRequired).toBe(false);
  });

  it("laisse le palier intact quand un autre écran enregistre un métier sans le connaître", async () => {
    as(adminId);
    const res = await updateCategories(
      json("http://localhost/api/categories", { id: metierId, libelle: `Électricité bâtiment (renommé ${RUN})`, type: "metier" }, "PUT"),
    );
    expect(res.status).toBe(200);
    // Clé absente ≠ palier à « faible » : un écran qui ne connaît pas le risque ne doit pas
    // pouvoir le remettre au minimum par omission.
    const enBase = await prisma.metier.findUnique({ where: { id: metierId } });
    expect(enBase?.riskLevel).toBe("medium");
  });

  it("un métier sans classification reste au palier faible, sans assurance", async () => {
    const vierge = await prisma.metier.create({
      data: { categorieId, libelle: `Métier non classé (test ${RUN})` },
    });
    as(clientId);
    const res = await publier({ ...base, metierId: vierge.id });
    expect(res.status).toBe(200);
    const enBase = await prisma.mission.findUnique({ where: { id: (await res.json()).id } });
    expect(enBase?.riskLevel).toBe("low");
    expect(enBase?.insuranceRequired).toBe(false);
    await prisma.metier.delete({ where: { id: vierge.id } });
  });
});

describe("le formulaire reçoit le palier au moment de la sélection", () => {
  it("l'arbre de la cascade porte le palier de chaque métier", async () => {
    // C'est cette donnée — et non un appel séparé à une autre table — qui alimente l'indication
    // affichée au prestataire : l'écran ne peut donc pas annoncer autre chose que la règle
    // appliquée à la publication.
    const res = await taxonomy(new NextRequest("http://localhost/api/taxonomy"));
    const corps = (await res.json()) as { categories: { metiers: { id: string; riskLevel?: string }[] }[] };
    const metier = corps.categories.flatMap((c) => c.metiers).find((m) => m.id === metierId);
    expect(metier?.riskLevel).toBe("medium");
  });
});
