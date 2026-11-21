/**
 * Professionnel ciblé ⇄ secteur de la mission, de bout en bout (2026-09-28).
 *
 * Règle : une mission du secteur Digital ne cible ni artisan ni manœuvre. C'est une cohérence
 * de la MISSION (`Mission.professionalType`, préférence du client), refaite côté serveur contre
 * un appel direct — pas une règle d'éligibilité des prestataires (A16).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as createMission } from "@/app/api/missions/route";

const RUN = Date.now();
const PREFIX = `E2E Cible ${RUN}`;
let clientId = "";
const metiers: Record<"digital" | "btp" | "nonClassee", { categorieId: string; metierId: string }> = {
  digital: { categorieId: "", metierId: "" },
  btp: { categorieId: "", metierId: "" },
  nonClassee: { categorieId: "", metierId: "" },
};
const missionIds: string[] = [];

const base = {
  titre: "Mission de test du ciblage",
  description: "Description suffisamment longue pour passer la validation du schéma.",
  delaiJours: 5,
  status: "brouillon" as const,
};

const post = async (body: Record<string, unknown>) => {
  const res = await createMission(
    new Request("http://localhost/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ...body }),
    }),
  );
  if (res.status === 200) missionIds.push((await res.clone().json()).id);
  return res;
};

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `e2e-cible-${RUN}@flexwork.test`, tel: `+2296${String(RUN).slice(-7)}`, role: "client", country: "BJ" },
  });
  clientId = user.id;
  mockAuth.mockResolvedValue({ user: { id: clientId } });

  for (const [key, secteur] of [["digital", "digital"], ["btp", "btp"], ["nonClassee", null]] as const) {
    const cat = await prisma.categorie.create({
      data: { libelle: `${PREFIX} ${key}`, secteur, metiers: { create: { libelle: `${PREFIX} métier ${key}` } } },
      include: { metiers: true },
    });
    metiers[key] = { categorieId: cat.id, metierId: cat.metiers[0].id };
  }
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.metier.deleteMany({ where: { categorie: { libelle: { startsWith: PREFIX } } } });
  await prisma.categorie.deleteMany({ where: { libelle: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: clientId } });
});

describe("POST /api/missions — professionnel ciblé selon le secteur", () => {
  it("refuse un artisan ou un manœuvre ciblé sur une mission Digital", async () => {
    for (const professionalType of ["ARTISAN", "MANOEUVRE"]) {
      const res = await post({ metierId: metiers.digital.metierId, professionalType });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("professional_type_incompatible");
    }
  });

  it("le contrôle vaut aussi quand seule la catégorie est donnée", async () => {
    const res = await post({ categorieId: metiers.digital.categorieId, domaine: "Développement", professionalType: "ARTISAN" });
    expect(res.status).toBe(400);
  });

  it("accepte un indépendant, une entreprise ou « Indifférent » sur une mission Digital", async () => {
    for (const professionalType of ["EXPERT_DIGITAL", "EXPERT_BTP", undefined]) {
      const res = await post({ metierId: metiers.digital.metierId, professionalType });
      expect(res.status).toBe(200);
    }
  });

  it("accepte un manœuvre sur une mission BTP", async () => {
    const res = await post({ metierId: metiers.btp.metierId, professionalType: "MANOEUVRE" });
    expect(res.status).toBe(200);
  });

  it("une catégorie non classée ne restreint rien", async () => {
    const res = await post({ metierId: metiers.nonClassee.metierId, professionalType: "ARTISAN" });
    expect(res.status).toBe(200);
  });
});
