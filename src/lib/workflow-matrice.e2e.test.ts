/**
 * Matrice des parcours complets — chaque type de candidature, chaque modèle de paiement, de la
 * publication à la clôture, par les routes que l'interface appelle.
 *
 *   Client      : publie → accepte (candidature) ou valide (devis) → génère le contrat → signe
 *                 → finance → apprécie, constate, valide (ou valide les relevés) → clôture.
 *   Prestataire : candidate (prix fixe, au temps) ou soumet un devis → signe → livre (ou déclare
 *                 ses relevés de présence).
 *   Responsable : en vérification OPR, vérifie et transmet ; le client valide définitivement.
 *
 * Combinaisons :
 *   - candidature à prix fixe : F2, J1, J3, J4, S1 (jalons saisis par le client au contrat) ;
 *   - devis détaillé           : F2, J1, J3, J4, S1 (jalons dérivés des lignes du devis) ;
 *   - au temps                 : S2H, S2J, S2W, S2M ;
 *   - vérification OPR         : devis J1, et au temps S2J.
 *
 * Chaque parcours a son prestataire (règle d'exclusivité) et finit par les mêmes contrôles :
 * mission close, séquestre cohérent (aucune règle d'or violée), montants versés et rendus exacts.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as jalonDeliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as jalonAppreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as jalonObservePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as jalonCheckpointPost } from "@/app/api/missions/[id]/jalons/[jalonId]/checkpoint/route";
import { POST as jalonVerificationPost } from "@/app/api/missions/[id]/jalons/[jalonId]/verification/route";
import { POST as jalonValidatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/deliverable/route";
import { POST as deliverableSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as missionAppreciatePost } from "@/app/api/missions/[id]/deliverable/[attachmentId]/appreciate/route";
import { POST as missionObservePost } from "@/app/api/missions/[id]/observe-progress/route";
import { POST as escrowReleasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { POST as attendancePost } from "@/app/api/missions/[id]/attendance/route";
import { POST as attendanceDecisionPost } from "@/app/api/missions/[id]/attendance/[attendanceId]/route";
import { POST as timeClosePost } from "@/app/api/missions/[id]/time-contract/close/route";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";
import { checkEscrowInvariants } from "@/lib/escrow-invariants";
import { operateVirtualPsp, type VirtualPspAction } from "@/lib/psp-virtual";
import { dayPeriod, monthPeriod, weekPeriod } from "@/lib/spot-time";
import { givePayoutAccount } from "@/test/payout-fixture";

const RUN = Date.now();
const PASSPHRASE = "passphrase-matrice-2026";
const LONG = 120_000;

// ── Les combinaisons ────────────────────────────────────────────────────────────────────────

type TypeCandidature = "FIXED" | "QUOTE" | "RATE";
type Cas = { nom: string; type: TypeCandidature; mode: string; opr?: boolean };

const CAS: Cas[] = [
  { nom: "Prix fixe · F2", type: "FIXED", mode: "F2" },
  { nom: "Prix fixe · J1", type: "FIXED", mode: "J1" },
  { nom: "Prix fixe · J3", type: "FIXED", mode: "J3" },
  { nom: "Prix fixe · J4", type: "FIXED", mode: "J4" },
  { nom: "Prix fixe · S1", type: "FIXED", mode: "S1" },
  { nom: "Devis · F2", type: "QUOTE", mode: "F2" },
  { nom: "Devis · J1", type: "QUOTE", mode: "J1" },
  { nom: "Devis · J3", type: "QUOTE", mode: "J3" },
  { nom: "Devis · J4", type: "QUOTE", mode: "J4" },
  { nom: "Devis · S1", type: "QUOTE", mode: "S1" },
  { nom: "Au temps · heure", type: "RATE", mode: "S2H" },
  { nom: "Au temps · jour", type: "RATE", mode: "S2J" },
  { nom: "Au temps · semaine", type: "RATE", mode: "S2W" },
  { nom: "Au temps · mois", type: "RATE", mode: "S2M" },
  { nom: "Devis · J1 · OPR", type: "QUOTE", mode: "J1", opr: true },
  { nom: "Au temps · jour · OPR", type: "RATE", mode: "S2J", opr: true },
];

// Prix fixe : 120 000, découpé au contrat en 70 000 + 50 000 pour les modes à jalons.
const PRIX_FIXE = 120_000;
const JALONS_SAISIS = [
  { titre: "Gros œuvre", montant: 70_000 },
  { titre: "Finitions", montant: 50_000 },
];
// Devis : deux lignes, sans TVA ni main d'œuvre — le prix du contrat vaut 150 000.
const LIGNES_DEVIS = [
  { description: "Fournitures et pose", quantity: 1, unit: "forfait", unitPrice: 100_000 },
  { description: "Finitions", quantity: 1, unit: "forfait", unitPrice: 50_000 },
];
const PRIX_DEVIS = 150_000;
// Au temps : tarif, quantité maximale, et relevés déclarés puis validés au fil du chantier.
const TEMPS: Record<string, { rate: number; max: number; releves: number[] }> = {
  S2H: { rate: 1_500, max: 20, releves: [8, 6] },
  S2J: { rate: 7_500, max: 20, releves: [3, 2] },
  S2W: { rate: 50_000, max: 4, releves: [1, 1] },
  S2M: { rate: 240_000, max: 3, releves: [1] },
};

// ── Outils ──────────────────────────────────────────────────────────────────────────────────

const ids = { client: "", clientCert: "", manager: "" };
let categorieOprId = "";
const missionIds: string[] = [];
const userIds: string[] = [];
const rapport: Record<string, unknown>[] = [];

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Matrice" } });
}
const postReq = (body: unknown = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atJalon = (id: string, jalonId: string) => ({ params: Promise.resolve({ id, jalonId }) });

function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve de réalisation — matrice");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function ok(res: Response, etape: string, codes = [200, 201]) {
  if (!codes.includes(res.status)) throw new Error(`${etape} → HTTP ${res.status} : ${await res.clone().text()}`);
  return res;
}

const PSP: Record<string, VirtualPspAction> = {
  hold: "authorize",
  release: "release",
  retention_release: "release",
  refund: "refund",
  freeze: "freeze",
  unfreeze: "unfreeze",
};

/** Le PSP confirme toutes les instructions en attente (dans l'ordre d'envoi) ; renvoie leurs types. */
async function pspConfirme(contractId: string): Promise<string[]> {
  const ops = await prisma.pspEscrowOperation.findMany({
    where: { contractId, status: "pending" },
    orderBy: [{ instructionSentAt: "asc" }, { id: "asc" }],
  });
  for (const op of ops) {
    expect(await operateVirtualPsp(PSP[op.instructionType], op.pspReference!), `${op.instructionType} ${op.amount}`).toMatchObject({ ok: true });
  }
  return ops.map((o) => o.instructionType);
}

let n = 0;
const nouvelUtilisateur = async (cle: string, role: string) => {
  const u = await prisma.user.create({
    data: {
      email: `mx-${cle}-${RUN}@flexwork.test`,
      tel: `+229${RUN}${String(++n).padStart(2, "0")}`,
      status: "active",
      country: "BJ",
      kycStatus: "verifie",
      firstname: "Matrice",
      lastname: cle,
      role: role as "client",
    },
  });
  userIds.push(u.id);
  return u;
};

async function certificat(userId: string, cle: string) {
  authAs(userId);
  const res = await ok(
    await certPost(postReq({ commonName: `Matrice ${cle}`, email: `mx-${cle}-${RUN}@flexwork.test`, passphrase: PASSPHRASE })),
    "certificat",
    [201]
  );
  return (await res.json()).data.id as string;
}

// ── Les étapes ──────────────────────────────────────────────────────────────────────────────

async function publier(cas: Cas, cle: string) {
  const temps = TEMPS[cas.mode];
  const corps: Record<string, unknown> = {
    titre: `Matrice ${cas.nom} ${RUN}`,
    description: `Parcours complet ${cas.nom} : publication, candidature, contrat, paiement, clôture.`,
    domaine: "batiment",
    mode: "distance",
    currency: "XOF",
    delaiJours: 20,
    status: "publiee",
    ...(cas.type === "FIXED" ? { budgetType: "FIXED", budget: PRIX_FIXE } : {}),
    ...(cas.type === "QUOTE" ? { budgetType: "QUOTE" } : {}),
    ...(cas.type === "RATE"
      ? { budgetType: "RATE", financingModeKey: cas.mode, timeRate: temps.rate, timeMaxQuantity: temps.max, attendanceValidation: "partielle" }
      : {}),
    ...(cas.opr
      ? { categorieId: categorieOprId, validationMode: "opr", siteManagerIdentifier: `mx-responsable-${RUN}@flexwork.test` }
      : {}),
  };
  authAs(ids.client);
  const res = await ok(await missionPost(postReq(corps)), `${cle} · publication`);
  const { id } = await res.json();
  missionIds.push(id);
  return id as string;
}

/** Le prestataire candidate (ou soumet son devis), le client retient sa proposition. */
async function candidaterEtRetenir(cas: Cas, missionId: string, prestataireId: string) {
  authAs(prestataireId);
  let proposalId: string;
  if (cas.type === "QUOTE") {
    const res = await ok(
      await devisPost(postReq({ lineItems: LIGNES_DEVIS, delay: "20 jours", tvaRate: 0, laborCost: 0, financingModeKey: cas.mode }), at(missionId)),
      "devis du prestataire"
    );
    proposalId = (await res.json()).proposalId;
    authAs(ids.client);
    await ok(await devisValidatePost(postReq(), { params: Promise.resolve({ id: missionId, proposalId }) }), "validation du devis");
  } else {
    const corps = cas.type === "RATE" ? { montant: 0, unitRate: TEMPS[cas.mode].rate } : { montant: PRIX_FIXE, financingModeKey: cas.mode };
    const res = await ok(await proposalPost(postReq(corps), at(missionId)), "candidature du prestataire");
    proposalId = (await res.json()).id;
    authAs(ids.client);
    await ok(await acceptPost(postReq(), { params: Promise.resolve({ id: missionId, proposalId }) }), "acceptation de la candidature");
  }
  return proposalId;
}

async function contratEtSignatures(cas: Cas, missionId: string, prestataireId: string, prestataireCert: string) {
  // Candidature à prix fixe en mode à jalons : le découpage est saisi par le client au contrat.
  const corps = cas.type === "FIXED" && cas.mode !== "F2" ? { jalons: JALONS_SAISIS } : {};
  authAs(ids.client);
  const res = await ok(await contractPost(postReq(corps), at(missionId)), "génération du contrat");
  const contractId = (await res.json()).id as string;
  authAs(prestataireId);
  await ok(await signPost(postReq({ contractId, certificateId: prestataireCert, passphrase: PASSPHRASE })), "signature du prestataire");
  authAs(ids.client);
  await ok(await signPost(postReq({ contractId, certificateId: ids.clientCert, passphrase: PASSPHRASE })), "signature du client");
  return contractId;
}

/** Le vérificateur (client, ou responsable en OPR) apprécie toutes les preuves ouvertes. */
async function apprecierPreuves(verificateur: string, missionId: string, jalonId: string | null) {
  authAs(verificateur);
  const preuves = await prisma.missionAttachment.findMany({ where: { missionId, jalonId, appreciation: null }, select: { id: true } });
  for (const p of preuves) {
    const res = jalonId
      ? await jalonAppreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, jalonId, attachmentId: p.id }) })
      : await missionAppreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, attachmentId: p.id }) });
    await ok(res, "appréciation d'une preuve");
  }
}

async function livrerJalon(cas: Cas, missionId: string, contractId: string, jalonId: string, prestataireId: string) {
  authAs(prestataireId);
  await ok(await jalonDeliverablePost(proofForm(), atJalon(missionId, jalonId)), "preuve du jalon");
  await ok(await jalonSubmitPost(postReq(), atJalon(missionId, jalonId)), "soumission du jalon");
  const verificateur = cas.opr ? ids.manager : ids.client;
  await apprecierPreuves(verificateur, missionId, jalonId);

  if (cas.mode === "J3") {
    // Financement progressif : chaque palier confirmé libère sa part.
    authAs(ids.client);
    await ok(await jalonCheckpointPost(postReq({ progress: 50 }), atJalon(missionId, jalonId)), "palier 50 %");
    expect(await pspConfirme(contractId)).toEqual(["release"]);
    await ok(await jalonCheckpointPost(postReq({ progress: 100 }), atJalon(missionId, jalonId)), "palier 100 %");
    expect(await pspConfirme(contractId)).toEqual(["release"]);
    return;
  }

  authAs(verificateur);
  await ok(await jalonObservePost(postReq({ progress: 100 }), atJalon(missionId, jalonId)), "constat 100 %");
  if (cas.opr) {
    await ok(await jalonVerificationPost(postReq({ note: "Conforme, vérifié sur site." }), atJalon(missionId, jalonId)), "transmission au client");
  }
  authAs(ids.client);
  await ok(await jalonValidatePost(postReq(), atJalon(missionId, jalonId)), "validation définitive");
  await pspConfirme(contractId);
}

async function livrerMission(missionId: string, contractId: string, prestataireId: string) {
  authAs(prestataireId);
  await ok(await deliverablePost(proofForm(), at(missionId)), "livrable de la mission");
  await ok(await deliverableSubmitPost(postReq(), at(missionId)), "soumission du livrable");
  await apprecierPreuves(ids.client, missionId, null);
  authAs(ids.client);
  await ok(await missionObservePost(postReq({ progress: 100 }), at(missionId)), "constat 100 %");
  await ok(await escrowReleasePost(postReq(), at(missionId)), "validation définitive");
  expect(await pspConfirme(contractId)).toEqual(["release"]);
}

/** Période d'un relevé selon l'unité : jours, semaines ISO ou mois consécutifs à partir du 2 nov. */
function periode(mode: string, rang: number) {
  const base = Date.UTC(2026, 10, 2);
  if (mode === "S2W") return weekPeriod(new Date(base + rang * 7 * 86_400_000));
  if (mode === "S2M") return monthPeriod(new Date(Date.UTC(2026, 10 + rang, 1)));
  return dayPeriod(new Date(base + rang * 86_400_000));
}

async function releves(cas: Cas, missionId: string, contractId: string, prestataireId: string) {
  const temps = TEMPS[cas.mode];
  for (const [rang, quantite] of temps.releves.entries()) {
    const { periodStart, periodEnd } = periode(cas.mode, rang);
    authAs(prestataireId);
    const res = await ok(
      await attendancePost(postReq({ periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), declaredQuantity: quantite }), at(missionId)),
      "déclaration du relevé",
      [201]
    );
    const attendanceId = (await res.json()).id as string;
    const cible = { params: Promise.resolve({ id: missionId, attendanceId }) };
    if (cas.opr) {
      authAs(ids.manager);
      await ok(await attendanceDecisionPost(postReq({ action: "verify", verifiedQuantity: quantite }), cible), "vérification du relevé");
    }
    authAs(ids.client);
    await ok(await attendanceDecisionPost(postReq({ approvedQuantity: quantite }), cible), "validation du relevé");
    expect(await pspConfirme(contractId)).toEqual(["release"]);
  }
  authAs(ids.client);
  await ok(await timeClosePost(postReq(), at(missionId)), "clôture du chantier");
  expect(await pspConfirme(contractId)).toEqual(["refund"]);
}

// ── Mise en place ───────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  ids.client = (await nouvelUtilisateur("client", "client")).id;
  ids.manager = (await nouvelUtilisateur("responsable", "responsable_chantier")).id;
  categorieOprId = (await prisma.categorie.create({ data: { libelle: `Matrice OPR ${RUN}`, allowsOprVerification: true } })).id;
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
  ids.clientCert = await certificat(ids.client, "client");
}, LONG);

afterAll(async () => {
  if (rapport.length) {
    console.log("\n══ MATRICE DES PARCOURS — état final ══");
    console.table(rapport);
  }
  const contrats = await prisma.prestationContract.findMany({ where: { missionId: { in: missionIds } }, select: { id: true } });
  const contractIds = contrats.map((c) => c.id);
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.categorie.deleteMany({ where: { id: categorieOprId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}, LONG);

// ── Les parcours ────────────────────────────────────────────────────────────────────────────

describe("matrice des parcours : publication → candidature → contrat → paiement → clôture", () => {
  for (const cas of CAS) {
    it(
      cas.nom,
      async () => {
        const cle = cas.nom.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const prestataire = await nouvelUtilisateur(`p-${cle}`, "expert_digital");
        await givePayoutAccount(prestataire.id);
        const prestataireCert = await certificat(prestataire.id, `p-${cle}`);

        // 1. Client : publication.
        const missionId = await publier(cas, cle);
        const publiee = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
        expect(publiee.status).toBe("publiee");
        // Fixe ou jalons n'est jamais posé à la publication ; seul le temps l'est.
        expect(publiee.financingModeKey).toBe(cas.type === "RATE" ? cas.mode : null);
        expect(publiee.validationMode).toBe(cas.opr ? "opr" : "client");

        // 2. Prestataire : candidature ou devis — 3. Client : il la retient.
        const proposalId = await candidaterEtRetenir(cas, missionId, prestataire.id);
        const proposition = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
        if (cas.type !== "RATE") {
          expect((proposition.devisData as { financingModeKey?: string }).financingModeKey).toBe(cas.mode);
        }

        // 4. Contrat et signatures.
        const contractId = await contratEtSignatures(cas, missionId, prestataire.id, prestataireCert);
        const contrat = await prisma.prestationContract.findUniqueOrThrow({
          where: { id: contractId },
          include: { jalons: { orderBy: { ordre: "asc" } }, spotTimeTerms: true },
        });
        const prix = cas.type === "FIXED" ? PRIX_FIXE : cas.type === "QUOTE" ? PRIX_DEVIS : TEMPS[cas.mode].rate * TEMPS[cas.mode].max;
        expect((contrat.termsSnapshot as { financingModeKey: string; prix: number })).toMatchObject({ financingModeKey: cas.mode, prix });
        expect(contrat.validationMode).toBe(cas.opr ? "opr" : "client");
        expect(contrat.jalons).toHaveLength(cas.type === "RATE" || cas.mode === "F2" ? 0 : 2);
        if (cas.mode === "J3") expect(contrat.financingMode).toBe("progressive");
        if (cas.mode === "J4") expect(contrat.retentionRate).toBe(0.05);
        if (cas.mode === "S1") expect(contrat.fundingGranularity).toBe("upfront");
        if (cas.type === "RATE") expect(contrat.spotTimeTerms).toMatchObject({ rate: TEMPS[cas.mode].rate, maxQuantity: TEMPS[cas.mode].max });

        // 5. Financement : séquestre unique (sans jalon, S1, au temps), déclenché à la signature ;
        //    sinon jalon par jalon, juste avant sa livraison.
        const parJalon = contrat.jalons.length > 0 && contrat.fundingGranularity === "per_jalon";
        if (!parJalon) {
          expect(await pspConfirme(contractId)).toEqual(["hold"]);
          expect((await escrowBalance(contractId)).funded).toBe(prix);
        }

        // 6. Exécution et validation.
        if (cas.type === "RATE") {
          await releves(cas, missionId, contractId, prestataire.id);
        } else if (contrat.jalons.length === 0) {
          await livrerMission(missionId, contractId, prestataire.id);
        } else {
          for (const jalon of contrat.jalons) {
            if (parJalon) {
              authAs(ids.client);
              await ok(await jalonHoldPost(postReq(), atJalon(missionId, jalon.id)), `financement du jalon ${jalon.ordre}`);
              expect(await pspConfirme(contractId)).toEqual(["hold"]);
            }
            await livrerJalon(cas, missionId, contractId, jalon.id, prestataire.id);
          }
          // J4 : la retenue part en une fois après le dernier jalon.
          if (cas.mode === "J4") await pspConfirme(contractId);
        }

        // 7. Contrôles finaux.
        const solde = await escrowBalance(contractId);
        expect(await checkEscrowInvariants(contractId)).toEqual([]);
        const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
        expect(mission.status).toBe("cloturee");
        if (cas.type === "RATE") {
          const consomme = TEMPS[cas.mode].releves.reduce((s, q) => s + q, 0) * TEMPS[cas.mode].rate;
          expect(solde).toMatchObject({ funded: prix, released: consomme, refunded: prix - consomme, held: 0 });
        } else {
          expect(solde).toMatchObject({ funded: prix, released: prix, held: 0 });
          // Chaque validation définitive est tracée au nom du client.
          const jalons = await prisma.jalon.findMany({ where: { contractId } });
          for (const j of jalons) expect(j.clientValidatedById).toBe(ids.client);
          if (jalons.length === 0) expect(mission.clientValidatedById).toBe(ids.client);
          if (cas.opr) for (const j of jalons) expect(j.verifiedById).toBe(ids.manager);
        }

        rapport.push({
          parcours: cas.nom,
          prix,
          jalons: contrat.jalons.length,
          financé: solde.funded,
          versé: solde.released,
          rendu: solde.refunded,
          mission: mission.status,
        });
      },
      LONG
    );
  }
});
