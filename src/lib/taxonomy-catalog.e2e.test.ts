/**
 * Taxonomie Catégorie → Métier → Service, de bout en bout (2026-09-22).
 *
 * Architecture reprise de flexwork_job : mêmes routes (/api/categories, /api/services), même
 * contrat, édition en direct sans brouillon. Ce fichier vérifie ce contrat sur la vraie base,
 * plus les deux ajouts de ce dépôt : écritures réservées au rôle `frontend`, et journalisées.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import * as categories from "@/app/api/categories/route";
import * as services from "@/app/api/services/route";

const RUN = Date.now();
const CAT = `E2E Catégorie ${RUN}`;

let editorId = "";
let superviseurId = "";
let clientId = "";
let categorieId = "";
let metierId = "";
let serviceId = "";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const req = (method: string, body?: unknown, query = "") =>
  new NextRequest(`http://localhost/api${query}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function tree() {
  const res = await categories.GET();
  return (await res.json()).data as { id: string; libelle: string; metiers: { id: string; libelle: string; _count: { services: number } }[] }[];
}

beforeAll(async () => {
  const [editor, superviseur, client] = await Promise.all([
    prisma.user.create({ data: { email: `e2e-cat-editeur-${RUN}@flexwork.test`, tel: `+229${RUN}80`, isAdmin: true, adminRole: "frontend" } }),
    prisma.user.create({ data: { email: `e2e-cat-sup-${RUN}@flexwork.test`, tel: `+229${RUN}81`, isAdmin: true, adminRole: "superviseur" } }),
    prisma.user.create({ data: { email: `e2e-cat-client-${RUN}@flexwork.test`, tel: `+229${RUN}82` } }),
  ]);
  editorId = editor.id;
  superviseurId = superviseur.id;
  clientId = client.id;
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { metier: { categorie: { libelle: { startsWith: `E2E Catégorie ${RUN}` } } } } });
  await prisma.metier.deleteMany({ where: { categorie: { libelle: { startsWith: `E2E Catégorie ${RUN}` } } } });
  await prisma.categorie.deleteMany({ where: { libelle: { startsWith: `E2E Catégorie ${RUN}` } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [editorId, superviseurId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [editorId, superviseurId, clientId] } } });
});

describe("séparation des pouvoirs", () => {
  it("la lecture est publique, comme dans flexwork_job", async () => {
    as(null);
    expect((await categories.GET()).status).toBe(200);
    expect((await services.GET(req("GET", undefined, "/services"))).status).toBe(200);
  });

  it("refuse l'écriture au superviseur, qui lit sans agir", async () => {
    as(superviseurId);
    expect((await categories.POST(req("POST", { libelle: CAT }))).status).toBe(403);
    expect((await services.POST(req("POST", { metierId: "x", libelle: "x" }))).status).toBe(403);
  });

  it("refuse l'écriture à un non-administrateur et à un anonyme", async () => {
    as(clientId);
    expect((await categories.PUT(req("PUT", { id: "x", libelle: "x" }))).status).toBe(403);
    as(null);
    expect((await categories.DELETE(req("DELETE", { id: "x" }))).status).toBe(401);
    expect((await services.DELETE(req("DELETE", { id: "x" }))).status).toBe(401);
  });
});

describe("Catégorie → Métier → Service, en direct", () => {
  it("crée une catégorie, visible aussitôt sans publication", async () => {
    as(editorId);
    const res = await categories.POST(req("POST", { libelle: CAT, description: "e2e", icon: "🧪" }));
    expect(res.status).toBe(201);
    categorieId = (await res.json()).data.id;
    expect((await tree()).map((c) => c.libelle)).toContain(CAT);
  });

  it("refuse un libellé de catégorie en double (409)", async () => {
    as(editorId);
    expect((await categories.POST(req("POST", { libelle: CAT }))).status).toBe(409);
  });

  it("crée un métier sous la catégorie", async () => {
    as(editorId);
    const res = await categories.POST(req("POST", { categorieId, metierLibelle: "Plombier e2e" }));
    expect(res.status).toBe(201);
    metierId = (await res.json()).data.id;
    const cat = (await tree()).find((c) => c.id === categorieId)!;
    expect(cat.metiers.map((m) => m.libelle)).toEqual(["Plombier e2e"]);
  });

  it("crée un service sous le métier, filtrable par métier et par catégorie", async () => {
    as(editorId);
    const res = await services.POST(req("POST", { metierId, libelle: "Débouchage e2e", dureeEstimee: 45 }));
    expect(res.status).toBe(201);
    serviceId = (await res.json()).id;

    const byMetier = await (await services.GET(req("GET", undefined, `/services?metierId=${metierId}`))).json();
    expect(byMetier.data.map((s: { id: string }) => s.id)).toEqual([serviceId]);
    const byCat = await (await services.GET(req("GET", undefined, `/services?categorieId=${categorieId}`))).json();
    expect(byCat.data[0].metier.categorie.id).toBe(categorieId);
  });

  it("refuse un service sous un métier inexistant (404)", async () => {
    as(editorId);
    expect((await services.POST(req("POST", { metierId: "inexistant", libelle: "x" }))).status).toBe(404);
  });

  it("modifie catégorie, métier et service", async () => {
    as(editorId);
    expect((await categories.PUT(req("PUT", { id: categorieId, libelle: `${CAT} bis`, type: "category" }))).status).toBe(200);
    expect((await categories.PUT(req("PUT", { id: metierId, libelle: "Plombier e2e bis", type: "metier" }))).status).toBe(200);
    const res = await services.PUT(req("PUT", { id: serviceId, dureeEstimee: "60" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.dureeEstimee).toBe(60);
  });

  it("répond 404, pas 500, sur un identifiant inconnu", async () => {
    as(editorId);
    expect((await categories.PUT(req("PUT", { id: "inexistant", libelle: "x" }))).status).toBe(404);
    expect((await services.DELETE(req("DELETE", { id: "inexistant" }))).status).toBe(404);
  });

  it("supprimer une catégorie emporte ses métiers et ses services", async () => {
    as(editorId);
    expect((await categories.DELETE(req("DELETE", { id: categorieId, type: "category" }))).status).toBe(200);
    expect(await prisma.metier.count({ where: { id: metierId } })).toBe(0);
    expect(await prisma.service.count({ where: { id: serviceId } })).toBe(0);
  });
});

describe("journal d'audit", () => {
  it("trace chaque geste de l'éditeur", async () => {
    const actions = new Set((await prisma.adminAuditLog.findMany({ where: { adminId: editorId } })).map((e) => e.action));
    for (const a of [
      "taxonomy_categorie_create",
      "taxonomy_metier_create",
      "taxonomy_service_create",
      "taxonomy_categorie_update",
      "taxonomy_metier_update",
      "taxonomy_service_update",
      "taxonomy_categorie_delete",
    ]) {
      expect(actions).toContain(a);
    }
  });
});
