import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { computeChainedHash } from "@/lib/hash-chain";
import { computeAge, isChantierRole } from "@/lib/age-gate";
import { validateJalonsSum, type JalonInput } from "@/lib/jalons";

// US-402 (Phase 4) : génère le contrat de prestation à partir de la proposition acceptée.
// La plateforme n'est jamais signataire — voir la mention obligatoire ci-dessous, testée en
// non-régression (contract.test.ts). Contenu minimal imposé par modele-skillafrica-v3-
// Flexwork.md §2.1 : identités, objet, prix/conditions, délais, déclarations du prestataire
// (ou mention explicite d'absence), responsabilités, médiation facultative.
const PLATFORM_NOT_A_PARTY_CLAUSE = "Flexwork n'est pas partie au présent contrat.";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  // Paiement fractionné optionnel (2026-08-06) : `jalons` est facultatif. Absent → comportement
  // historique inchangé (un seul HOLD/RELEASE sur le prix total). Présent → les montants
  // doivent sommer exactement au prix de la proposition acceptée (validé plus bas, une fois
  // ce prix connu).
  const body = await req.json().catch(() => ({}));
  const rawJalons = Array.isArray(body?.jalons) ? (body.jalons as JalonInput[]) : null;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      client: true,
      proposals: { where: { status: "acceptee" }, include: { provider: { include: { profile: { include: { declarations: true } } } } } },
      contract: true,
    },
  });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const proposal = mission.proposals[0];
  if (!proposal) {
    return NextResponse.json({ error: "no_accepted_proposal" }, { status: 409 });
  }
  if (mission.contract) {
    return NextResponse.json({ error: "contract_already_generated" }, { status: 409 });
  }

  let jalons: JalonInput[] | null = null;
  if (rawJalons) {
    const parsed = rawJalons
      .filter((j) => j && typeof j.titre === "string" && typeof j.montant === "number")
      .map((j) => ({ titre: j.titre, montant: j.montant }));
    const validation = validateJalonsSum(parsed, proposal.montant);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    jalons = parsed;
  }

  let declarationAge: string | null = null;
  if (isChantierRole(proposal.provider.role) && proposal.provider.dateNaissance) {
    const requirement = await prisma.countryAgeRequirement.findUnique({
      where: {
        country_profileType_domain: {
          country: proposal.provider.country ?? "",
          profileType: proposal.provider.role,
          domain: null as unknown as string,
        },
      },
    });
    const minimumAge = requirement?.minimumAge ?? 18;
    const age = computeAge(proposal.provider.dateNaissance);
    declarationAge = `Le prestataire déclare être âgé de ${age} ans et satisfaire l'âge minimum de ${minimumAge} ans requis au ${proposal.provider.country ?? "pays de la mission"}. Le client reconnaît avoir été informé de cette exigence légale.`;
  }

  const latestInsurance = proposal.provider.profile?.declarations
    .filter((d) => d.declarationType === "insurance")
    .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())[0];
  const latestQualification = proposal.provider.profile?.declarations
    .filter((d) => d.declarationType === "qualification")
    .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())[0];

  const termsSnapshot = {
    client: { id: mission.client.id, email: mission.client.email, tel: mission.client.tel },
    provider: { id: proposal.provider.id, email: proposal.provider.email, tel: proposal.provider.tel },
    objet: mission.titre,
    description: mission.description,
    prix: proposal.montant,
    devise: mission.currency,
    delaiJours: mission.delaiJours,
    declarationAssurance: latestInsurance
      ? {
          insurerName: latestInsurance.insurerName,
          policyNumber: latestInsurance.policyNumber,
          coverageCeiling: latestInsurance.coverageCeiling,
          validUntil: latestInsurance.validUntil,
        }
      : "Aucune assurance déclarée par ce prestataire",
    declarationQualification: latestQualification?.label ?? null,
    declarationAge,
    responsabiliteQualite: "prestataire",
    responsabiliteBesoinEtSite: "client",
    clauseMediationFacultative: true,
    clausePlateformeNonPartie: PLATFORM_NOT_A_PARTY_CLAUSE,
    // Figé dans le snapshot immuable au même titre que le reste des conditions — un jalon
    // ajouté/modifié après génération du contrat n'existe pas (aucune route ne le permet).
    jalons: jalons ?? null,
  };

  const currentHash = computeChainedHash(null, termsSnapshot);

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.prestationContract.create({
      data: {
        missionId,
        clientId: mission.clientId,
        providerId: proposal.providerId,
        termsSnapshot,
        currentHash,
      },
    });
    if (jalons) {
      await tx.jalon.createMany({
        data: jalons.map((j, i) => ({ contractId: created.id, ordre: i + 1, titre: j.titre, montant: j.montant })),
      });
    }
    await tx.mission.update({ where: { id: missionId }, data: { status: "contrat_genere" } });
    return created;
  });

  return NextResponse.json({ id: contract.id, termsSnapshot: contract.termsSnapshot });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(contract);
}
