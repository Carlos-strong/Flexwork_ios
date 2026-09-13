// Libellés d'affichage des notifications — source unique partagée par la cloche du navbar
// (src/components/notifications-bell.tsx) et par tout autre fil qui rend un `type`
// applicatif. Depuis 2026-09-09 la cloche porte TOUS les événements (compte, mission,
// messagerie), et non plus seulement le KYC : `Notification.type` est une chaîne libre
// (même convention que MissionNotification.type / Message.type), les libellés vivent donc
// ici plutôt que dans un enum de base.
export const NOTIFICATION_LABELS: Record<string, string> = {
  // — Compte / KYC
  kyc_verifie: "Identité vérifiée",
  kyc_rejete: "KYC rejeté",
  kyc_document_decision: "Document KYC examiné",
  kyc_document_revoque: "Document KYC révoqué",
  kyc_decision_admin: "Décision KYC enregistrée",

  // — Cycle de vie des missions
  mission_publiee: "Mission publiée",
  mission_match: "Nouvelle mission dans votre domaine",
  candidature_recue: "Nouvelle candidature",
  candidature_acceptee: "Candidature acceptée",
  candidature_refusee: "Candidature non retenue",
  devis_soumis: "Devis reçu",
  devis_revision_demandee: "Révision demandée",
  devis_valide: "Devis validé",
  devis_rejete: "Devis rejeté",
  offre_recue: "Offre reçue",
  contract_generated: "Contrat à signer",
  provider_signed: "Contrat signé par le prestataire",
  contract_locked: "Contrat engagé",
  contract_expired: "Contrat expiré",

  // — Livrables, jalons, preuves
  deliverable_submitted: "Livrable soumis",
  deliverable_validated: "Livrable validé",
  deliverable_rejected: "Livrable refusé",
  proof_rejected: "Preuve refusée",
  progress_checkpoint: "Point d'avancement",

  // — Gigs (le prestataire publie, le client achète)
  gig_order_placed: "Commande à accepter",
  gig_order_locked: "Commande engagée",

  // — Messagerie
  message_recu: "Nouveau message",
  message_envoye: "Message envoyé",
};

export function notificationLabel(type: string): string {
  return NOTIFICATION_LABELS[type] ?? "Notification";
}
