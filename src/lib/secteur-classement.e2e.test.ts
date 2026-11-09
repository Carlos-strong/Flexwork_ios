/**
 * Classement des catégories par secteur (DIGITAL / BTP / SERVICES), de bout en bout (2026-09-28).
 *
 * Le contrat vérifié est celui du tableau de classement du backoffice (SecteurBoard) :
 *   · « Ajouter » range une catégorie dans un secteur, ou l'y déplace depuis un autre ;
 *   · « ✕ » la RETIRE (secteur = null) sans rien supprimer, ni elle ni ses métiers ;
 *   · un PUT qui ne dit rien du secteur ne le touche pas, et une valeur inconnue est refusée ;
 *   · seul l'éditeur du frontend classe — le superviseur lit sans agir.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import * as categories from "@/app/api/categories/route";

const RUN = Date.now();
const PREFIX = `E2E Secteur ${RUN}`;

let editorId = "";
let superviseurId = "";
let categorieId = "";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const req = (method: string, body: unknown) =>
  new NextRequest("http://localhost/api/categories", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const secteurOf = async () => (await prisma.categorie.findUniqueOrThrow({ where: { id: categorieId } })).secteur;

beforeAll(async () => {
  const [editor, superviseur] = await Promise.all([
    prisma.user.create({ data: { email: `e2e-sect-editeur-${RUN}@flexwork.test`, tel: `+229${RUN}90`, isAdmin: true, adminRole: "frontend" } }),
    prisma.user.create({ data: { email: `e2e-sect-sup-${RUN}@flexwork.test`, tel: `+229${RUN}91`, isAdmin: true, adminRole: "superviseur" } }),
  ]);
  editorId = editor.id;
  superviseurId = superviseur.id;
});

afterAll(async () => {
  await prisma.metier.deleteMany({ where: { categorie: { libelle: { startsWith: PREFIX } } } });
  await prisma.categorie.deleteMany({ where: { libelle: { startsWith: PREFIX } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [editorId, superviseurId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [editorId, superviseurId] } } });
});

describe("classement par secteur", () => {
  it("une catégorie créée sans secteur naît non classée", async () => {
    as(editorId);
    const res = await categories.POST(req("POST", { libelle: `${PREFIX} Plomberie` }));
    expect(res.status).toBe(201);
    categorieId = (await res.json()).data.id;
    expect(await secteurOf()).toBeNull();
  });

  it("la range dans un secteur, puis la déplace dans un autre", async () => {
    as(editorId);
    expect((await categories.PUT(req("PUT", { id: categorieId, type: "category", secteur: "services" }))).status).toBe(200);
    expect(await secteurOf()).toBe("services");
    expect((await categories.PUT(req("PUT", { id: categorieId, type: "category", secteur: "btp" }))).status).toBe(200);
    expect(await secteurOf()).toBe("btp");
  });

  it("un PUT qui ne parle pas du secteur le laisse intact", async () => {
    as(editorId);
    await categories.PUT(req("PUT", { id: categorieId, type: "category", requiresAgeCheck: true }));
    expect(await secteurOf()).toBe("btp");
  });

  it("refuse un secteur inconnu sans rien modifier", async () => {
    as(editorId);
    const res = await categories.PUT(req("PUT", { id: categorieId, type: "category", secteur: "industrie" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("secteur_invalid");
    expect(await secteurOf()).toBe("btp");
  });

  it("retirer du secteur déclasse la catégorie sans la supprimer, ni ses métiers", async () => {
    as(editorId);
    await prisma.metier.create({ data: { categorieId, libelle: `${PREFIX} Plombier` } });
    expect((await categories.PUT(req("PUT", { id: categorieId, type: "category", secteur: null }))).status).toBe(200);
    const cat = await prisma.categorie.findUniqueOrThrow({ where: { id: categorieId }, include: { metiers: true } });
    expect(cat.secteur).toBeNull();
    expect(cat.requiresAgeCheck).toBe(true);
    expect(cat.metiers).toHaveLength(1);
  });

  it("journalise chaque classement avec le secteur", async () => {
    const logs = await prisma.adminAuditLog.findMany({
      where: { adminId: editorId, targetId: categorieId, action: "taxonomy_categorie_update" },
    });
    expect(logs.some((l) => l.justification?.includes("secteur BTP"))).toBe(true);
    expect(logs.some((l) => l.justification?.includes("secteur Non classée"))).toBe(true);
  });

  it("le superviseur ne peut pas classer", async () => {
    as(superviseurId);
    expect((await categories.PUT(req("PUT", { id: categorieId, type: "category", secteur: "digital" }))).status).toBe(403);
    expect(await secteurOf()).toBeNull();
  });
});
