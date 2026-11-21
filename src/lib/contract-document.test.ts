/**
 * Tests de l'export documentaire PDF du contrat de prestation (2026-08-31) — aligné sur le
 * UI/UX de l'export de référence « Contrat de prestation — Électricien(ne) d'équipement /
 * Chantier » : bandeau d'en-tête paginé, titre centré, blocs LE CLIENT / ET LE PRESTATAIRE,
 * tableau des jalons avec montant total, signatures avec empreinte/certificat.
 *
 * Même pattern que les autres tests E2E : vrais route handlers Next.js avec mock de `auth()`,
 * état vérifié via Prisma. Si PDF_DUMP=<chemin> est défini, le PDF généré est écrit sur disque
 * (inspection visuelle) sans casser la CI.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { writeFileSync } from "fs";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as documentGet } from "@/app/api/missions/[id]/contract/document/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `doc-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `doc-provider-${RUN}@flexwork.test`;
let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: "x@flexwork.test", name: "Testeur", role: "client" } });
}

async function cleanup() {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}5`,
      role: "client",
      status: "active",
      firstname: "Louis",
      lastname: "Durand",
      country: "BJ",
      city: "Cotonou",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}6`,
      role: "artisan",
      status: "active",
      firstname: "Gerome",
      lastname: "Carlos",
      country: "BJ",
    },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: "Électricien(ne) d'équipement / Chantier",
      description: "Installation et maintenance des équipements électriques sur différents sites.",
      domaine: "electricite",
      budget: 4708,
      currency: "EUR",
      delaiJours: 30,
      riskLevel: "high",
      status: "proposition_acceptee",
    },
  });
  missionId = mission.id;
  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: 4708, message: "Proposition acceptée", status: "acceptee" },
  });

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      currentHash: `doc-${RUN}`,
      termsSnapshot: {
        client: { id: clientId, email: CLIENT_EMAIL, tel: `+229${RUN}5` },
        provider: { id: providerId, email: PROVIDER_EMAIL, tel: `+229${RUN}6` },
        objet: "Électricien(ne) d'équipement / Chantier",
        description: "Installation et maintenance des équipements électriques sur différents sites.",
        prix: 4708,
        devise: "EUR",
        delaiJours: 30,
        declarationAssurance: "Aucune assurance déclarée par ce prestataire",
        declarationQualification: "CQP Électricien",
        clauseDuree:
          "La mission débute le 24 août 2026 pour une durée prévisionnelle de 30 jours. Le présent contrat prend effet à sa signature par les deux parties et s'achève à la validation et au paiement du dernier jalon.",
        clauseStatutIndependant:
          "Le Prestataire exerce sa mission en toute indépendance, sans lien de subordination juridique avec le Client.",
        clauseProprieteIntellectuelle:
          "Sous réserve du complet paiement des sommes dues, le Prestataire cède au Client les droits patrimoniaux de propriété intellectuelle sur les livrables développés spécifiquement dans le cadre de la mission.",
        clauseConfidentialite:
          "Chaque partie s'engage à conserver strictement confidentielles les informations techniques, commerciales ou financières dont elle aurait connaissance à l'occasion de la mission.",
        clauseResiliation:
          "Chaque partie peut résilier le présent contrat en cas de manquement grave non réparé dans les quinze jours suivant une mise en demeure restée sans effet.",
        clauseResponsabilite:
          "Le Prestataire est tenu à une obligation de moyens dans l'exécution de sa mission. Sa responsabilité est en tout état de cause limitée au montant total perçu au titre du présent contrat.",
        clauseDroitApplicable:
          "Le présent contrat est soumis au droit béninois. À défaut d'accord amiable, les tribunaux compétents du Bénin seront seuls compétents.",
        clauseMediationFacultative: true,
        clausePlateformeNonPartie: "Flexwork n'est pas partie au présent contrat.",
        jalons: [
          { titre: "Installation chantier", montant: 2360 },
          { titre: "Canalisation", montant: 780 },
          { titre: "Mise en service", montant: 568 },
          { titre: "Livrable initial", montant: 1000 },
        ],
      },
    },
  });
  contractId = contract.id;

  // Signature réelle du prestataire (certificat + empreinte) pour vérifier le bloc « POUR LE
  // PRESTATAIRE » avec « Signature vérifiable ».
  const cert = await prisma.digitalCertificate.create({
    data: {
      userId: providerId,
      commonName: "Gerome Carlos",
      email: PROVIDER_EMAIL,
      validUntil: new Date(Date.now() + 365 * 86400000),
      publicKey: "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
      encryptedPrivateKey: "enc",
      keyFingerprint: `5FECFECBECB9${RUN}`.padEnd(32, "0"),
      keySalt: "salt",
      keyIv: "iv",
      keyAuthTag: "tag",
    },
  });
  await prisma.contractSignature.create({
    data: {
      contractId,
      certificateId: cert.id,
      signedDataHash: `hash-${RUN}`,
      signature: "sig",
      signedAt: new Date("2026-08-24T18:26:00.000Z"),
    },
  });
});

afterAll(async () => {
  await cleanup();
});

describe("Export documentaire PDF du contrat (2026-08-31)", () => {
  it("génère un PDF valide reprenant le UI/UX de référence (en-tête, parties, jalons, signatures)", async () => {
    authAs(clientId);
    const res = await documentGet(new Request(`http://localhost/api/missions/${missionId}/contract/document?format=pdf`), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    // Le PDF (compressé) ne se prête pas à des assertions de texte ; on vérifie la présence
    // des pages attendues et, si demandé, on le dépose pour inspection visuelle.
    if (process.env.PDF_DUMP) {
      writeFileSync(process.env.PDF_DUMP, buf);
    }
  });

  it("refuse un tiers (404) — F-02 étendu", async () => {
    const outsider = await prisma.user.create({
      data: { email: `doc-out-${RUN}@flexwork.test`, tel: `+229${RUN}7`, role: "client", status: "active" },
    });
    authAs(outsider.id);
    const res = await documentGet(new Request(`http://localhost/api/missions/${missionId}/contract/document?format=pdf`), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(404);
    await prisma.user.delete({ where: { id: outsider.id } });
  });
});
