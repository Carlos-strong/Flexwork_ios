/**
 * Visibilité publique du profil prestataire — routes réelles, vraie base Prisma (même
 * pattern que security-guards.route.test.ts).
 *
 * Depuis l'ouverture de la page d'accueil aux visiteurs (2026-09-09), la chaîne d'entrée du
 * site est : accueil → carte « Talents d'Afrique » → /profil/[id]. Elle traverse deux routes
 * qui exigeaient une session et renvoyaient donc 401 à tout visiteur. Elles sont désormais
 * ouvertes, mais aux SEULS profils déjà listés publiquement (identité vérifiée + rôle
 * prestataire + au moins un profil) — exactement le critère de /api/search/prestataires.
 *
 * Ce que ces tests verrouillent :
 *   - la règle d'éligibilité elle-même (un client, un compte sans profil, un compte non
 *     vérifié restent invisibles sans session) ;
 *   - l'absence d'oracle d'existence : un visiteur reçoit le même 401 pour un identifiant
 *     inexistant que pour un compte non listé ;
 *   - le contenu renvoyé au visiteur, qui est la vraie surface de risque : la route
 *     renvoyait la déclaration professionnelle COMPLÈTE (ipAddress, userAgent, hachages de
 *     chaînage, filePath des justificatifs) — l'ouvrir sans restreindre la charge utile
 *     aurait publié ces données sur le web.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

// Mock auth() AVANT d'importer les routes.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as publicProfileGet } from "@/app/api/users/[id]/public-profile/route";
import { GET as avatarGet } from "@/app/api/users/[id]/avatar/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
let listedId: string;      // prestataire vérifié AVEC profil → listé publiquement
let noProfileId: string;   // prestataire vérifié SANS profil → non listé
let clientId: string;      // client vérifié → jamais listé comme prestataire
let declarationId: string;
let experienceDeclId: string;

function asVisitor() {
  mockAuth.mockResolvedValue(null);
}

function asUser(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, role: "client" } });
}

// Signature commune aux deux routes testées (public-profile et avatar) : même forme de
// params, et NextResponse étend Response — typée ainsi, le helper accepte les deux sans
// dépendre de la charge utile (nécessairement différente) de chacune.
type GetRoute = (req: Request, opts: { params: Promise<{ id: string }> }) => Promise<Response>;

function get(route: GetRoute, id: string) {
  return route(new Request("http://localhost/api"), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  const [listed, noProfile, client] = await Promise.all([
    prisma.user.create({
      data: { email: `pv-listed-${RUN}@flexwork.test`, tel: `+2298${RUN}1`, role: "artisan", status: "active", kycStatus: "verifie", firstname: "Ama", lastname: "Koffi", country: "BJ", dateNaissance: new Date("2000-01-01") },
    }),
    prisma.user.create({
      data: { email: `pv-noprofile-${RUN}@flexwork.test`, tel: `+2298${RUN}2`, role: "artisan", status: "active", kycStatus: "verifie", dateNaissance: new Date("2000-01-01") },
    }),
    prisma.user.create({
      data: { email: `pv-client-${RUN}@flexwork.test`, tel: `+2298${RUN}3`, role: "client", status: "active", kycStatus: "verifie" },
    }),
  ]);
  listedId = listed.id;
  noProfileId = noProfile.id;
  clientId = client.id;

  const profile = await prisma.profile.create({
    data: {
      userId: listedId,
      label: `Principal-${RUN}`,
      isDefault: true,
      mainDomain: "Maçonnerie",
      indicativeRate: 5000,
      portfolioUrls: ["portfolio/secret/chantier.jpg"],
      cvUrl: "portfolio/secret/cv.pdf",
    },
  });

  // Déclaration d'assurance porteuse des champs qui ne doivent JAMAIS sortir.
  const declaration = await prisma.professionalDeclaration.create({
    data: {
      profileId: profile.id,
      declarationType: "insurance",
      insurerName: "AXA Bénin",
      policyNumber: "POL-PRIVE-42",
      coverageCeiling: 5_000_000,
      validUntil: new Date("2027-01-01"),
      declarationTextSnapshot: `PV_SNAPSHOT_${RUN}`,
      ipAddress: "203.0.113.77",
      userAgent: "UA-PRIVE",
      currentHash: `pv-hash-${RUN}`,
    },
  });
  declarationId = declaration.id;
  await prisma.declarationDocument.create({
    data: { declarationId, filePath: "declarations/secret/attestation.pdf", fileName: "attestation.pdf" },
  });
  // Expérience attestée par une personne ressource : l'expérience est publique, la personne
  // qui l'atteste (nom, téléphone) ne l'est jamais.
  const xpDecl = await prisma.professionalDeclaration.create({
    data: {
      profileId: profile.id,
      declarationType: "experience",
      declarationTextSnapshot: `PV_XP_${RUN}`,
      currentHash: `pv-xp-hash-${RUN}`,
      experiences: {
        create: {
          clientType: "COMPANY",
          clientName: "SOBEBRA",
          role: "Électricien",
          startDate: "2022-01",
          references: { create: { kind: "primary", nom: "GarantSecret", tel: "+22990000077" } },
        },
      },
    },
  });
  experienceDeclId = xpDecl.id;
});

afterAll(async () => {
  await prisma.declarationDocument.deleteMany({ where: { declarationId } });
  await prisma.professionalDeclaration.deleteMany({ where: { id: { in: [declarationId, experienceDeclId] } } });
  await prisma.profile.deleteMany({ where: { userId: listedId } });
  await prisma.user.deleteMany({ where: { id: { in: [listedId, noProfileId, clientId] } } });
});

describe("public-profile — règle d'éligibilité pour un visiteur", () => {
  it("prestataire vérifié avec profil : visible sans session (200)", async () => {
    asVisitor();
    const res = await get(publicProfileGet, listedId);
    expect(res.status).toBe(200);
    expect((await res.json()).identite.prenom).toBe("Ama");
  });

  it("prestataire vérifié SANS profil : invisible sans session (401)", async () => {
    asVisitor();
    expect((await get(publicProfileGet, noProfileId)).status).toBe(401);
  });

  it("compte client : invisible sans session (401)", async () => {
    asVisitor();
    expect((await get(publicProfileGet, clientId)).status).toBe(401);
  });

  it("identifiant inexistant : même 401 qu'un compte non listé (pas d'oracle d'existence)", async () => {
    asVisitor();
    const inconnu = await get(publicProfileGet, "cmzzzzzzzzzzzzzzzzzzzzzzz");
    const nonListe = await get(publicProfileGet, clientId);
    expect(inconnu.status).toBe(401);
    expect(await inconnu.json()).toEqual(await nonListe.json());
  });

});

// Connectés (2026-11-08) : être connecté ne donne plus accès à n'importe quel compte.
describe("public-profile — connectés : profil non listé", () => {
  let strangerId: string;
  let suspendedId: string;
  let missionId: string;

  beforeAll(async () => {
    const [stranger, suspended] = await Promise.all([
      prisma.user.create({
        data: { email: `pv-stranger-${RUN}@flexwork.test`, tel: `+2298${RUN}4`, role: "client", status: "active", kycStatus: "verifie" },
      }),
      prisma.user.create({
        data: { email: `pv-suspended-${RUN}@flexwork.test`, tel: `+2298${RUN}5`, role: "artisan", status: "suspended", kycStatus: "verifie", dateNaissance: new Date("2000-01-01") },
      }),
    ]);
    strangerId = stranger.id;
    suspendedId = suspended.id;
    await prisma.profile.create({ data: { userId: suspendedId, label: `Suspendu-${RUN}`, isDefault: true, mainDomain: "Plomberie" } });
    // Le client a reçu une candidature du prestataire sans profil : ils partagent une mission.
    const mission = await prisma.mission.create({
      data: { clientId, titre: `PV ${RUN}`, description: "Mission de test", domaine: "batiment", budget: 50_000, currency: "XOF", delaiJours: 10 },
    });
    missionId = mission.id;
    await prisma.missionProposal.create({ data: { missionId, providerId: noProfileId, montant: 50_000 } });
  });

  afterAll(async () => {
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await prisma.profile.deleteMany({ where: { userId: suspendedId } });
    await prisma.user.deleteMany({ where: { id: { in: [strangerId, suspendedId] } } });
  });

  it("un connecté SANS lien avec le compte ne le voit pas (404)", async () => {
    asUser(strangerId);
    expect((await get(publicProfileGet, noProfileId)).status).toBe(404);
    expect((await get(publicProfileGet, clientId)).status).toBe(404);
  });

  it("identifiant inexistant : même 404 qu'un profil non autorisé (pas d'oracle)", async () => {
    asUser(strangerId);
    const inconnu = await get(publicProfileGet, "cmzzzzzzzzzzzzzzzzzzzzzzz");
    const refuse = await get(publicProfileGet, noProfileId);
    expect(inconnu.status).toBe(404);
    expect(await inconnu.json()).toEqual(await refuse.json());
  });

  it("le titulaire voit son propre profil non listé", async () => {
    asUser(noProfileId);
    expect((await get(publicProfileGet, noProfileId)).status).toBe(200);
  });

  it("le client d'une mission voit le prestataire qui y a candidaté, et inversement", async () => {
    asUser(clientId);
    expect((await get(publicProfileGet, noProfileId)).status).toBe(200);
    asUser(noProfileId);
    expect((await get(publicProfileGet, clientId)).status).toBe(200);
  });

  it("un administrateur voit tout profil", async () => {
    mockAuth.mockResolvedValue({ user: { id: strangerId, role: "client", isAdmin: true } });
    expect((await get(publicProfileGet, noProfileId)).status).toBe(200);
  });

  it("un compte suspendu n'est plus listé : invisible du visiteur comme d'un connecté sans lien", async () => {
    asVisitor();
    expect((await get(publicProfileGet, suspendedId)).status).toBe(401);
    expect((await get(avatarGet, suspendedId)).status).toBe(401);
    asUser(strangerId);
    expect((await get(publicProfileGet, suspendedId)).status).toBe(404);
    asUser(suspendedId);
    expect((await get(publicProfileGet, suspendedId)).status).toBe(200);
  });
});

describe("public-profile — charge utile renvoyée au visiteur", () => {
  it("ne publie ni IP, ni user-agent, ni hachage, ni chemin de justificatif", async () => {
    asVisitor();
    const brut = await (await get(publicProfileGet, listedId)).text();
    expect(brut).not.toContain("203.0.113.77");
    expect(brut).not.toContain("UA-PRIVE");
    expect(brut).not.toContain(`pv-hash-${RUN}`);
    expect(brut).not.toContain("declarations/secret/attestation.pdf");
    expect(brut).not.toContain(`PV_SNAPSHOT_${RUN}`);
  });

  it("expériences publiées, sans les personnes ressources qui les attestent", async () => {
    asVisitor();
    const res = await get(publicProfileGet, listedId);
    const brut = await res.clone().text();
    expect(brut).not.toContain("GarantSecret");
    expect(brut).not.toContain("+22990000077");
    const { declare } = await res.json();
    expect(declare.experiences).toEqual([
      expect.objectContaining({ role: "Électricien", clientName: "SOBEBRA", startDate: "2022-01" }),
    ]);
    expect(declare.experiences[0]).not.toHaveProperty("references");
  });

  it("assurance : assureur, plafond et validité oui — numéro de police non", async () => {
    asVisitor();
    const { declare } = await (await get(publicProfileGet, listedId)).json();
    expect(declare.insurance).toEqual({
      insurerName: "AXA Bénin",
      policyNumber: null,
      coverageCeiling: 5_000_000,
      validUntil: "2027-01-01T00:00:00.000Z",
    });
  });

  it("CV et portfolio retenus pour le visiteur (fichiers servis derrière une session)", async () => {
    asVisitor();
    const { declare } = await (await get(publicProfileGet, listedId)).json();
    expect(declare.cvUrl).toBeNull();
    expect(declare.portfolioUrls).toEqual([]);
  });

  it("un connecté conserve numéro de police, CV et portfolio", async () => {
    asUser(clientId);
    const { declare } = await (await get(publicProfileGet, listedId)).json();
    expect(declare.insurance.policyNumber).toBe("POL-PRIVE-42");
    expect(declare.cvUrl).toBe("portfolio/secret/cv.pdf");
    expect(declare.portfolioUrls).toEqual(["portfolio/secret/chantier.jpg"]);
  });
});

describe("avatar — même règle d'éligibilité", () => {
  // Le prestataire listé n'a pas d'avatarPath : un 404 prouve que le garde d'accès a laissé
  // passer (c'est l'absence de photo qui répond), là où un 401 signalerait un refus d'accès.
  it("prestataire listé : le garde laisse passer (404, pas 401)", async () => {
    asVisitor();
    expect((await get(avatarGet, listedId)).status).toBe(404);
  });

  it("prestataire non listé : refusé au visiteur (401)", async () => {
    asVisitor();
    expect((await get(avatarGet, noProfileId)).status).toBe(401);
  });

  it("compte client : refusé au visiteur (401)", async () => {
    asVisitor();
    expect((await get(avatarGet, clientId)).status).toBe(401);
  });

  it("un connecté atteint toujours l'avatar d'un compte non listé (404, pas 401)", async () => {
    asUser(clientId);
    expect((await get(avatarGet, noProfileId)).status).toBe(404);
  });
});

// Fichiers de portfolio (2026-11-08) : un chemin valide ne suffit plus.
describe("portfolio-file — contrôle d'accès", () => {
  let publishedPath: string;
  let removedPath: string;
  let strangerId: string;
  let portfolioGet: (req: Request) => Promise<Response>;

  const fetchFile = (relPath: string) =>
    portfolioGet(new Request(`http://localhost/api/profile/portfolio-file?p=${encodeURIComponent(relPath)}`));

  beforeAll(async () => {
    ({ GET: portfolioGet } = await import("@/app/api/profile/portfolio-file/route"));
    const { savePortfolioFile } = await import("@/lib/storage");
    publishedPath = await savePortfolioFile({ userId: listedId, fileName: "chantier.png", buffer: Buffer.from("png") });
    removedPath = await savePortfolioFile({ userId: listedId, fileName: "retire.png", buffer: Buffer.from("png") });
    // Seul `publishedPath` figure encore sur le profil : `removedPath` a été retiré par son auteur.
    await prisma.profile.updateMany({ where: { userId: listedId }, data: { portfolioUrls: [publishedPath] } });
    strangerId = (
      await prisma.user.create({
        data: { email: `pv-pf-${RUN}@flexwork.test`, tel: `+2298${RUN}6`, role: "client", status: "active", kycStatus: "verifie" },
      })
    ).id;
  });

  afterAll(async () => {
    const { deleteStoredFile } = await import("@/lib/storage");
    await Promise.all([deleteStoredFile(publishedPath), deleteStoredFile(removedPath)]);
    await prisma.user.deleteMany({ where: { id: strangerId } });
  });

  it("un fichier publié d'un profil listé est servi à un connecté, avec nosniff", async () => {
    asUser(strangerId);
    const res = await fetchFile(publishedPath);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("un fichier retiré du profil n'est plus servi aux autres (404)", async () => {
    asUser(strangerId);
    expect((await fetchFile(removedPath)).status).toBe(404);
  });

  it("le titulaire garde l'accès à ses propres fichiers", async () => {
    asUser(listedId);
    expect((await fetchFile(removedPath)).status).toBe(200);
  });

  it("chemin hors portfolio ou remontée de dossier : 404", async () => {
    asUser(strangerId);
    expect((await fetchFile("avatars/x/y.png")).status).toBe(404);
    expect((await fetchFile(`portfolio/${listedId}/../../etc`)).status).toBe(404);
  });
});

// Déclarations brutes (2026-11-08) : réservées au titulaire et aux administrateurs.
describe("GET /api/declarations — lecture réservée au titulaire", () => {
  let declarationsGet: (req: Request) => Promise<Response>;
  let profileId: string;
  const list = (id: string) => declarationsGet(new Request(`http://localhost/api/declarations?profileId=${id}`));

  beforeAll(async () => {
    ({ GET: declarationsGet } = await import("@/app/api/declarations/route"));
    profileId = (await prisma.profile.findFirstOrThrow({ where: { userId: listedId } })).id;
  });

  it("un autre connecté reçoit 404, sans aucune donnée (garants, IP, hachages)", async () => {
    asUser(clientId);
    const res = await list(profileId);
    expect(res.status).toBe(404);
    const brut = await res.text();
    expect(brut).not.toContain("GarantSecret");
    expect(brut).not.toContain("203.0.113.77");
  });

  it("le titulaire lit ses déclarations", async () => {
    asUser(listedId);
    const res = await list(profileId);
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });

  it("un administrateur lit les déclarations", async () => {
    mockAuth.mockResolvedValue({ user: { id: clientId, role: "client", isAdmin: true } });
    expect((await list(profileId)).status).toBe(200);
  });
});

// Avis et services sur le profil public (2026-11-08).
describe("public-profile — avis et services", () => {
  let missionId: string;
  let reviewerId: string;
  const gigIds: string[] = [];

  beforeAll(async () => {
    reviewerId = (
      await prisma.user.create({
        data: { email: `pv-rev-${RUN}@flexwork.test`, tel: `+2298${RUN}7`, role: "client", status: "active", kycStatus: "verifie", firstname: "Clientnom", lastname: "Secretnom", country: "SN" },
      })
    ).id;
    missionId = (
      await prisma.mission.create({
        data: { clientId: reviewerId, titre: `PV avis ${RUN}`, description: "Mission de test", domaine: "Maçonnerie", budget: 10_000, currency: "XOF", delaiJours: 3 },
      })
    ).id;
    await prisma.review.create({ data: { missionId, authorId: reviewerId, targetId: listedId, note: 4, commentaire: `Avis public ${RUN}` } });
    for (const status of ["publie", "brouillon"] as const) {
      gigIds.push(
        (
          await prisma.gig.create({
            data: { providerId: listedId, titre: `Je vais tester ${status} ${RUN}`, description: "x", domaine: "Maçonnerie", prix: 1000, delaiJours: 2, status },
          })
        ).id,
      );
    }
  });

  afterAll(async () => {
    await prisma.gig.deleteMany({ where: { id: { in: gigIds } } });
    await prisma.mission.deleteMany({ where: { id: missionId } });
    await prisma.user.deleteMany({ where: { id: reviewerId } });
  });

  it("publie l'avis (note, commentaire, pays) sans jamais nommer son auteur", async () => {
    asVisitor();
    const res = await get(publicProfileGet, listedId);
    const brut = await res.clone().text();
    const body = await res.json();
    expect(body.avis.find((a: { commentaire: string }) => a.commentaire === `Avis public ${RUN}`)).toMatchObject({ note: 4, pays: "SN", metier: "Maçonnerie" });
    expect(body.activite.ratingBreakdown.find((b: { note: number }) => b.note === 4).count).toBeGreaterThanOrEqual(1);
    expect(brut).not.toContain("Clientnom");
    expect(brut).not.toContain("Secretnom");
  });

  it("n'affiche que les services publiés", async () => {
    asVisitor();
    const body = await (await get(publicProfileGet, listedId)).json();
    const titres = body.services.map((g: { titre: string }) => g.titre);
    expect(titres).toContain(`Je vais tester publie ${RUN}`);
    expect(titres).not.toContain(`Je vais tester brouillon ${RUN}`);
  });
});
