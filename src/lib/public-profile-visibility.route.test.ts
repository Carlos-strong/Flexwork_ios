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
});

afterAll(async () => {
  await prisma.declarationDocument.deleteMany({ where: { declarationId } });
  await prisma.professionalDeclaration.deleteMany({ where: { id: declarationId } });
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

  it("un connecté voit toujours un profil non listé (comportement inchangé)", async () => {
    asUser(clientId);
    expect((await get(publicProfileGet, noProfileId)).status).toBe(200);
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
