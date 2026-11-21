// Famille 3 — la propriété (« Le socle et les deux manques » + « Modèle de sécurité
// Flexwork ») : « A-t-il le droit sur cette ressource ? » Le garde manquant du projet —
// la condition de propriété est DANS le where, pas dans un `if` après coup : une ressource
// à laquelle l'appelant n'est pas partie est indistinguable d'une ressource inexistante
// (404), sans quoi la réponse devient un oracle d'existence (règle R02 du standard).

import { prisma } from "@/lib/db";
import type { Mission, MissionProposal, PrestationContract } from "@prisma/client";

export type MissionPartyResult =
  | { ok: false; status: 404 }
  | { ok: true; mission: Mission; isClient: boolean; isProvider: boolean };

// Racine de propriété principale : le client propriétaire OU un prestataire ayant une
// candidature sur la mission. Sous dual-role les deux branches ne sont plus exclusives :
// on qualifie explicitement (isClient / isProvider) au lieu de déduire l'une de l'autre.
export async function requireMissionParty(
  missionId: string,
  userId: string
): Promise<MissionPartyResult> {
  const mission = await prisma.mission.findFirst({
    where: {
      id: missionId,
      OR: [
        { clientId: userId }, // le client propriétaire
        { proposals: { some: { providerId: userId } } }, // un candidat de cette mission
      ],
    },
    include: { proposals: { select: { providerId: true } } },
  });
  if (!mission) return { ok: false, status: 404 } as const;

  const isClient = mission.clientId === userId;
  const isProvider = mission.proposals.some((p) => p.providerId === userId);

  return { ok: true, mission, isClient, isProvider } as const;
}

export type ContractPartyResult =
  | { ok: false; status: 404 }
  | { ok: true; contract: PrestationContract };

// Racine de propriété pour un contrat de prestation : seules les deux parties signataires.
// Sert notamment à fermer F-02 (POST /api/signature/verify lisait les métadonnées de
// signature de n'importe quel contrat par simple énumération d'identifiants).
export async function requireContractParty(
  contractId: string,
  userId: string
): Promise<ContractPartyResult> {
  const contract = await prisma.prestationContract.findFirst({
    where: { id: contractId, OR: [{ clientId: userId }, { providerId: userId }] },
  });
  if (!contract) return { ok: false, status: 404 } as const;

  return { ok: true, contract } as const;
}

export type ContractByMissionResult =
  | { ok: false; status: 404 }
  | { ok: true; contract: PrestationContract };

// Racine de propriété par mission : les deux parties signataires du contrat d'une mission.
// Utilisée par les routes mission-scopées qui opèrent sur le contrat (médiation, escrow…).
export async function requireContractByMission(
  missionId: string,
  userId: string
): Promise<ContractByMissionResult> {
  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
  });
  if (!contract) return { ok: false, status: 404 } as const;

  return { ok: true, contract } as const;
}

export type ProposalPartyResult =
  | { ok: false; status: 404 }
  | { ok: true; proposal: MissionProposal & { mission: Mission }; isClient: boolean; isProvider: boolean };

// Racine de propriété d'UNE candidature : le client propriétaire de la mission, ou le
// prestataire auteur de CETTE proposition — jamais un autre candidat de la même mission.
//
// `requireMissionParty` ne convient pas ici : sa branche prestataire admet tout candidat de
// la mission, ce qui suffit pour lire l'offre publique mais pas pour lire un DEVIS. Le
// chiffrage d'un concurrent (postes, prix unitaires, marge) est exactement ce qu'une place
// de marché ne doit jamais laisser fuiter entre candidats. La condition reste dans le
// `where` : une proposition qu'on n'a pas le droit de lire est indistinguable d'une
// proposition inexistante (R02).
export async function requireProposalParty(
  missionId: string,
  proposalId: string,
  userId: string
): Promise<ProposalPartyResult> {
  const proposal = await prisma.missionProposal.findFirst({
    where: {
      id: proposalId,
      missionId,
      OR: [{ mission: { clientId: userId } }, { providerId: userId }],
    },
    include: { mission: true },
  });
  if (!proposal) return { ok: false, status: 404 } as const;

  return {
    ok: true,
    proposal,
    isClient: proposal.mission.clientId === userId,
    isProvider: proposal.providerId === userId,
  } as const;
}
