/**
 * Déclarations professionnelles — diplômes, expériences, badge (2026-09-23).
 *
 * Trois chemins de /declarations étaient morts :
 *
 *   1. les diplômes étaient envoyés puis SUPPRIMÉS par zod, pendant que l'écran annonçait
 *      « Qualifications enregistrées et horodatées » — alors que le schéma pose que « le
 *      diplôme d'État est le pivot du badge » ;
 *   2. les expériences postaient `declarationType: "experience"`, absent de l'enum : 400 à
 *      chaque envoi ;
 *   3. le bouton de badge appelait POST /api/declarations/badge, une route inexistante : 404,
 *      suivi d'un message accusant le prestataire.
 *
 * Ces tests vérifient que les trois enregistrent réellement, et que le badge ne s'accorde pas
 * tout seul.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { POST as declare } from "@/app/api/declarations/route";
import * as badge from "@/app/api/declarations/badge/route";

const RUN = Date.now();
let providerId = "";
let sansProfilId = "";
let profileId = "";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

const post = (body: unknown) =>
  declare(
    new Request("http://localhost/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const [p, sans] = await Promise.all([
    prisma.user.create({
      data: { email: `e2e-decl-${RUN}@flexwork.test`, tel: `+2292${String(RUN).slice(-7)}`, role: "artisan", country: "BJ", dateNaissance: new Date("1990-01-01") },
    }),
    prisma.user.create({
      data: { email: `e2e-decl-np-${RUN}@flexwork.test`, tel: `+2291${String(RUN).slice(-7)}`, role: "artisan", country: "BJ" },
    }),
  ]);
  providerId = p.id;
  sansProfilId = sans.id;
  const profile = await prisma.profile.create({
    data: { userId: providerId, label: "Principal", isDefault: true, mainDomain: "Plomberie" },
  });
  profileId = profile.id;
});

afterAll(async () => {
  await prisma.professionalDeclaration.deleteMany({ where: { profileId } });
  await prisma.profile.deleteMany({ where: { userId: { in: [providerId, sansProfilId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [providerId, sansProfilId] } } });
});

describe("diplômes — jusqu'ici saisis puis jetés", () => {
  it("persiste chaque diplôme avec son détail", async () => {
    as(providerId);
    const res = await post({
      declarationType: "qualification",
      diplomes: [
        { qualificationName: "BTS Électrotechnique", year: 2018, institution: "LTI Cotonou", specialty: "Électricité", isStateIssued: true },
        { qualificationName: "Formation soudure", year: 2020, isStateIssued: false },
      ],
    });
    expect(res.status).toBe(200);
    const declaration = await res.json();

    const stored = await prisma.declaredDiploma.findMany({ where: { declarationId: declaration.id }, orderBy: { qualificationName: "asc" } });
    expect(stored).toHaveLength(2);
    expect(stored[0].qualificationName).toBe("BTS Électrotechnique");
    expect(stored[0].year).toBe(2018);
    expect(stored[0].isStateIssued).toBe(true);
    expect(stored[1].isStateIssued).toBe(false);
  });

  it("scelle les diplômes dans le texte chaîné, pas seulement dans une table à côté", async () => {
    const declaration = await prisma.professionalDeclaration.findFirst({
      where: { profileId, declarationType: "qualification" },
      orderBy: { declaredAt: "desc" },
    });
    // C'est ce texte qui est haché : s'il ne nomme pas les diplômes, la chaîne scelle du vide.
    expect(declaration?.declarationTextSnapshot).toContain("BTS Électrotechnique");
    expect(declaration?.declarationTextSnapshot).toContain("diplôme d'État");
  });

  it("refuse un diplôme sans intitulé", async () => {
    as(providerId);
    expect((await post({ declarationType: "qualification", diplomes: [{ qualificationName: "" }] })).status).toBe(400);
  });
});

describe("expériences — jusqu'ici refusées en 400", () => {
  it("accepte le type `experience`, que l'enum ignorait", async () => {
    as(providerId);
    const res = await post({
      declarationType: "experience",
      experiences: [
        { id: 1, clientType: "COMPANY", clientName: "SOBEBRA", role: "Électricien", startDate: "2022-01", endDate: "2023-06", domain: "Électricité" },
        { id: 2, clientType: "INDIVIDUAL", clientName: "M. Adjovi", role: "Plombier" },
      ],
      references: [
        { experienceId: 1, kind: "primary", nom: "Koffi", prenom: "Jean", tel: "+22997000000" },
        // Rattachée à une expérience non envoyée : elle n'est accrochable à rien.
        { experienceId: 99, kind: "primary", nom: "Fantôme" },
      ],
    });
    expect(res.status).toBe(200);
    const declaration = await res.json();

    const xps = await prisma.declaredExperience.findMany({ where: { declarationId: declaration.id }, include: { references: true } });
    expect(xps).toHaveLength(2);
    const chezSobebra = xps.find((x) => x.clientName === "SOBEBRA")!;
    expect(chezSobebra.role).toBe("Électricien");
    expect(chezSobebra.startDate).toBe("2022-01");
    expect(chezSobebra.references).toHaveLength(1);
    expect(chezSobebra.references[0].nom).toBe("Koffi");
  });

  it("ne rattache aucune référence orpheline au hasard", async () => {
    const orphelines = await prisma.declaredReference.findMany({ where: { nom: "Fantôme" } });
    expect(orphelines).toHaveLength(0);
  });

  it("refuse une expérience sans poste", async () => {
    as(providerId);
    expect((await post({ declarationType: "experience", experiences: [{ role: "" }] })).status).toBe(400);
  });

  it("refuse une date qui n'est pas au format AAAA-MM", async () => {
    as(providerId);
    expect((await post({ declarationType: "experience", experiences: [{ role: "Plombier", startDate: "01/2022" }] })).status).toBe(400);
  });
});

describe("badge — la route n'existait pas", () => {
  it("refuse un anonyme", async () => {
    as(null);
    expect((await badge.POST()).status).toBe(401);
  });

  it("refuse un compte sans profil, au lieu de 404", async () => {
    as(sansProfilId);
    const res = await badge.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("profile_required");
  });

  it("enregistre la demande quand un diplôme d'État est déclaré", async () => {
    as(providerId);
    const res = await badge.POST();
    expect(res.status).toBe(201);
    expect((await res.json()).badgeStatus).toBe("en_attente");
  });

  it("n'accorde PAS le badge de lui-même — il reste à instruire", async () => {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    expect(profile?.badgeStatus).toBe("en_attente");
    expect(profile?.badgeDecidedAt).toBeNull();
  });

  it("refuse une seconde demande tant que la première est en cours", async () => {
    as(providerId);
    const res = await badge.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("badge_already_requested");
  });

  it("exige un diplôme d'ÉTAT, pas un simple déclaratif", async () => {
    // Nouveau profil, avec une qualification purement déclarative.
    const autre = await prisma.user.create({
      data: { email: `e2e-decl-d-${RUN}@flexwork.test`, tel: `+2290${String(RUN).slice(-7)}`, role: "artisan", country: "BJ" },
    });
    const autreProfile = await prisma.profile.create({
      data: { userId: autre.id, label: "Principal", isDefault: true, mainDomain: "Soudure" },
    });
    as(autre.id);
    await post({ declarationType: "qualification", diplomes: [{ qualificationName: "Formation interne", isStateIssued: false }] });

    const res = await badge.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("state_diploma_required");

    await prisma.professionalDeclaration.deleteMany({ where: { profileId: autreProfile.id } });
    await prisma.profile.delete({ where: { id: autreProfile.id } });
    await prisma.user.delete({ where: { id: autre.id } });
  });

  it("dit à l'écran s'il est éligible, plutôt que de le laisser essayer", async () => {
    as(providerId);
    const body = await (await badge.GET()).json();
    expect(body.eligible).toBe(true);
    expect(body.badgeStatus).toBe("en_attente");
  });
});
