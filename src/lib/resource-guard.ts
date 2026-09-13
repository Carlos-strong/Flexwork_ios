// Famille 3 — la propriété (« Le socle et les deux manques » + « Modèle de sécurité
// Flexwork ») : « A-t-il le droit sur cette ressource ? » Le garde manquant du projet —
// la condition de propriété est DANS le where, pas dans un `if` après coup : une ressource
// à laquelle l'appelant n'est pas partie est indistinguable d'une ressource inexistante
// (404), sans quoi la réponse devient un oracle d'existence (règle R02 du standard).

import { prisma } from "@/lib/db";
import type { Mission, PrestationContract } from "@prisma/client";

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
