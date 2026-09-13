import type { ProposalStatus, GigOrderStatus } from "@prisma/client";

// Visibilité de la bulle de messagerie (src/components/chat/MessageBubble.tsx).
//
// Règle : une conversation n'a de sens qu'à partir du moment où une NÉGOCIATION EXISTE
// réellement entre les deux parties — c'est-à-dire dès qu'une candidature a été soumise.
// Avant ça, un prestataire qui consulte simplement une mission publiée n'a aucune relation
// avec le client : lui ouvrir un canal de discussion revient à autoriser le démarchage sur
// n'importe quelle mission du catalogue (et contourne la détection de fuite hors plateforme,
// US-1301, qui ne protège que des échanges déjà cadrés).
//
// La bulle reste ensuite visible sur toute la durée de vie de la relation — y compris après
// acceptation : c'est précisément pendant l'exécution que les deux parties ont le plus besoin
// de se coordonner (livrables, pointage, jalons). Elle ne disparaît qu'une fois la relation
// éteinte (refus ou annulation définitive), où il n'y a plus rien à discuter.
export const ENGAGED_PROPOSAL_STATUSES: ProposalStatus[] = [
  "envoyee", // candidature soumise → la négociation s'ouvre
  "preselectionnee",
  "en_negociation",
  "devis_valide",
  "acceptee", // mission en cours : la coordination continue
];

export function isProposalEngaged(status: string): boolean {
  return (ENGAGED_PROPOSAL_STATUSES as string[]).includes(status);
}

// Pendant Gig. Le modèle Gig n'a PAS de phase de négociation (prix ferme, achat direct) :
// l'équivalent du « passage en négociation » est la création de la commande, moment où les
// deux parties deviennent liées. Une commande annulée ou remboursée éteint la relation.
export const ENGAGED_GIG_ORDER_STATUSES: GigOrderStatus[] = [
  "created",
  "client_signed",
  "active",
  "completed",
];

export function isGigOrderEngaged(status: string): boolean {
  return (ENGAGED_GIG_ORDER_STATUSES as string[]).includes(status);
}
