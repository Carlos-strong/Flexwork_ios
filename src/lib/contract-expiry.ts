import { prisma } from "@/lib/db";
import { SignatureService } from "@/lib/signature";
import { notifyMissionUser } from "@/lib/mission-notify";

// Délai de contre-signature (modèle mission) : après la signature du prestataire (1/2),
// le client dispose de COUNTER_SIGN_DEADLINE_HOURS pour contre-signer (2/2). Passé ce délai,
// le contrat est annulé SANS pénalité — ni le client ni le prestataire n'étaient engagés
// tant que les deux signatures n'étaient pas apposées. Corrige le point 7 du modèle
// (« Freelance signe mais client ne contre-signe jamais → délai pour le client, sinon
// annulation sans pénalité »).
export const COUNTER_SIGN_DEADLINE_HOURS = 48;
export const COUNTER_SIGN_DEADLINE_MS = COUNTER_SIGN_DEADLINE_HOURS * 60 * 60 * 1000;

export function counterSignDeadline(providerSignedAt: Date): Date {
  return new Date(providerSignedAt.getTime() + COUNTER_SIGN_DEADLINE_MS);
}

// Un contrat est « expiré » si le prestataire a signé mais que le client n'a pas contre-signé
// dans le délai.
export function isCounterSignExpired(contract: {
  providerSignedAt: Date | null;
  clientSignedAt: Date | null;
}): boolean {
  return (
    !!contract.providerSignedAt &&
    !contract.clientSignedAt &&
    Date.now() > counterSignDeadline(contract.providerSignedAt).getTime()
  );
}

// Annule un contrat dont le délai de contre-signature est dépassé.
// La signature du prestataire est invalidée (providerSignedAt → null) et ses enregistrements
// ContractSignature supprimés pour que le flux redémarre proprement (le prestataire re-signe,
// le client contre-signe). Le statut mission reste `contrat_genere` (le contrat existe, en
// attente de signatures — pas de régénération nécessaire). La chaîne d'audit garde la trace
// (événement CONTRACT_EXPIRED, chaîné normalement). Idempotent.
export async function cancelExpiredContract(contractId: string): Promise<boolean> {
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: {
      providerSignedAt: true,
      clientSignedAt: true,
      providerId: true,
      // clientId est requis plus bas pour notifier le client de l'annulation : il manquait
      // au select, donc notify() recevait userId: undefined a l'execution (defaut reel,
      // revele par next build).
      clientId: true,
      missionId: true,
      mission: { select: { titre: true } },
    },
  });
  if (!contract) return false;
  // Rien à annuler : déjà annulé (providerSignedAt null) ou pas encore expiré.
  if (!isCounterSignExpired(contract)) return false;

  // clientSignedAt est null (garanti par isCounterSignExpired) → toutes les signatures sont
  // celles du prestataire. On les supprime pour remettre le compteur à zéro (sinon, à la
  // re-signature, le verrouillage se déclencherait à tort sur 2 signatures sans le client).
  await prisma.$transaction([
    prisma.contractSignature.deleteMany({ where: { contractId } }),
    prisma.prestationContract.update({
      where: { id: contractId },
      data: { providerSignedAt: null },
    }),
  ]);

  await SignatureService.addAuditEntry(
    contractId,
    "CONTRACT_EXPIRED",
    `Contrat annulé — délai de contre-signature (${COUNTER_SIGN_DEADLINE_HOURS}h) dépassé sans signature du client`
  );

  // ⚠️ 7 du modèle — informer le prestataire que le contrat a été annulé faute de
  // contre-signature dans le délai : il peut re-signer si le flux redémarre. L'e-mail est
  // non bloquant (try/catch dans le helper) — l'annulation ne dépend jamais de la notif.
  await notifyMissionUser({
    missionId: contract.missionId,
    userId: contract.providerId,
    type: "contract_expired",
    message: `Contrat annulé — le client n'a pas contre-signé sous ${COUNTER_SIGN_DEADLINE_HOURS}h pour « ${contract.mission.titre} »`,
    email: {
      subject: "Contrat annulé — contre-signature non effectuée",
      text: `Le client n'a pas contre-signé le contrat de la mission « ${contract.mission.titre} » sous ${COUNTER_SIGN_DEADLINE_HOURS}h. Le contrat a été annulé sans pénalité. Vous pouvez le signer à nouveau si vous le souhaitez.`,
      html: `<p>Le client n'a pas contre-signé le contrat de la mission <strong>${contract.mission.titre}</strong> sous ${COUNTER_SIGN_DEADLINE_HOURS}h.</p><p>Le contrat a été annulé sans pénalité. Vous pouvez le signer à nouveau si vous le souhaitez.</p>`,
    },
  });

  // Le client est la partie qui a laissé expirer le délai : il est notifié aussi (même type
  // `contract_expired`, message différencié) pour l'inviter à relancer la signature.
  await notifyMissionUser({
    missionId: contract.missionId,
    userId: contract.clientId,
    type: "contract_expired",
    message: `Contrat annulé — le délai de ${COUNTER_SIGN_DEADLINE_HOURS}h pour contre-signer « ${contract.mission.titre} » est dépassé`,
    email: {
      subject: "Contrat annulé — délai de contre-signature dépassé",
      text: `Vous n'avez pas contre-signé le contrat de la mission « ${contract.mission.titre} » dans le délai de ${COUNTER_SIGN_DEADLINE_HOURS}h. Le contrat a été annulé sans pénalité — le prestataire peut le signer à nouveau si vous souhaitez poursuivre.`,
      html: `<p>Vous n'avez pas contre-signé le contrat de la mission <strong>${contract.mission.titre}</strong> dans le délai de ${COUNTER_SIGN_DEADLINE_HOURS}h.</p><p>Le contrat a été annulé sans pénalité — le prestataire peut le signer à nouveau si vous souhaitez poursuivre.</p>`,
    },
  });

  return true;
}
