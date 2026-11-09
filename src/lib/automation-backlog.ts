import { prisma } from "@/lib/db";
import { COUNTER_SIGN_DEADLINE_MS } from "@/lib/contract-expiry";
import { PROVIDER_SIGN_DEADLINE_MS } from "@/lib/gig-expiry";
import { countDueTacitAcceptances } from "@/lib/tacit-acceptance";
import { countResidualRefundsDue } from "@/lib/residual-refund";
import { emailQueueHealth } from "@/lib/mail-queue";
import { paymentQueueHealth } from "@/lib/psp/reconcile";

/**
 * Ce que chacune des tâches automatiques a à traiter MAINTENANT.
 *
 * Mise à jour 2026-10-01 : les tâches sont désormais exécutées par le worker (src/worker/jobs.ts,
 * planification pg-boss) — les routes /api/cron/* restent pour un déploiement sans worker. Les
 * trois files du worker (instructions PSP, webhooks reçus, e-mails) s'ajoutent à la liste : leur
 * arriéré est le premier signe d'un worker arrêté.
 *
 * Remplace la rubrique « Queues » de flexwork_job, qui pilote des files BullMQ sur Redis. Ce
 * projet n'a ni BullMQ ni Redis : ses tâches sont des routes `/api/cron/*` appelées par un cron
 * système (DEPLOYMENT-PRODUCTION.md), qui ne consignent aucune exécution. On ne peut donc pas
 * afficher un historique qui n'existe pas. On peut, en revanche, mesurer l'arriéré : chaque
 * compteur ci-dessous applique EXACTEMENT le critère de sélection de la tâche, sans rien
 * exécuter. Un arriéré qui ne baisse jamais est le signe qu'une tâche ne tourne plus.
 *
 * Les fréquences affichées sont celles que DEPLOYMENT-PRODUCTION.md PRESCRIT, pas celles que le
 * serveur applique réellement : ce dépôt n'a aucun moyen de lire la table cron du système.
 *
 * Pas de bouton « exécuter » : trois de ces tâches déplacent de l'argent (acceptation tacite,
 * reliquats, remboursement de commandes Gig) et aucun rôle d'administration n'a ce pouvoir.
 */

export type AutomationTask = {
  key: string;
  route: string;
  label: string;
  effect: string;
  schedule: string;
  movesMoney: boolean;
  /** Éléments que la tâche traiterait à sa prochaine exécution. */
  due: number;
  /** Précision facultative (montant, candidats examinés). */
  detail?: string;
};

export async function getAutomationBacklog(now: Date = new Date()): Promise<AutomationTask[]> {
  const [contracts, devis, gigs, tacit, residual, payments, emails] = await Promise.all([
    prisma.prestationContract.count({
      where: { providerSignedAt: { not: null, lt: new Date(now.getTime() - COUNTER_SIGN_DEADLINE_MS) }, clientSignedAt: null },
    }),
    prisma.missionProposal.count({
      where: { status: { in: ["preselectionnee", "en_negociation"] }, mission: { dateExpiration: { lt: now } } },
    }),
    prisma.gigOrder.count({
      where: {
        clientSignedAt: { not: null, lt: new Date(now.getTime() - PROVIDER_SIGN_DEADLINE_MS) },
        providerSignedAt: null,
        status: "client_signed",
      },
    }),
    countDueTacitAcceptances(now),
    countResidualRefundsDue(),
    paymentQueueHealth(),
    emailQueueHealth(),
  ]);

  return [
    {
      key: "contract-expirations",
      route: "/api/cron/contract-expirations",
      label: "Expiration des contrats",
      effect: "Annule les contrats dont le client n’a pas contre-signé dans le délai.",
      schedule: "toutes les 10 min",
      movesMoney: false,
      due: contracts,
    },
    {
      key: "devis-expirations",
      route: "/api/cron/devis-expirations",
      label: "Expiration des devis",
      effect: "Clôt les négociations de devis arrivées à l’échéance de la mission.",
      schedule: "toutes les 10 min",
      movesMoney: false,
      due: devis,
    },
    {
      key: "gig-order-expirations",
      route: "/api/cron/gig-order-expirations",
      label: "Expiration des commandes Gig",
      effect: "Rembourse les commandes que le prestataire n’a pas signées sous 24 h.",
      schedule: "toutes les 10 min",
      movesMoney: true,
      due: gigs,
    },
    {
      key: "tacit-acceptance",
      route: "/api/cron/tacit-acceptance",
      label: "Acceptation tacite",
      effect: "Libère le paiement d’un livrable non contesté dans le délai contractuel.",
      schedule: "toutes les heures (h + 5), un job par contrat",
      movesMoney: true,
      due: tacit.due,
      detail: `${tacit.candidates} livrable${tacit.candidates > 1 ? "s" : ""} soumis examiné${tacit.candidates > 1 ? "s" : ""}`,
    },
    {
      key: "residual-refunds",
      route: "/api/cron/residual-refunds",
      label: "Reliquats du séquestre",
      effect: "Rembourse au client ce qui reste au séquestre d’une mission close.",
      schedule: "quotidienne (3 h 30), un job par contrat",
      movesMoney: true,
      due: residual.due,
      detail: `${Math.round(residual.amount).toLocaleString("fr-FR")} XOF sur ${residual.examined} mission${residual.examined > 1 ? "s" : ""} close${residual.examined > 1 ? "s" : ""}`,
    },
    {
      key: "psp-outbox",
      route: "worker · PspEscrowOperation",
      label: "Instructions PSP à transmettre",
      effect: "Transmet au PSP les versements, remboursements et gels décidés par la plateforme.",
      schedule: "en continu (≈ 1 s)",
      movesMoney: true,
      due: payments.outboxPending,
      detail: anomalies([
        [payments.outboxLate, "en retard"],
        [payments.outboxAbandoned, "abandonnée(s)"],
        [payments.stalePending, "sans réponse du PSP"],
      ]),
    },
    {
      key: "psp-inbox",
      route: "worker · PspInboundEvent",
      label: "Webhooks PSP à appliquer",
      effect: "Applique les confirmations reçues du PSP (séquestre, versements, clôtures).",
      schedule: "en continu (≈ 1 s)",
      movesMoney: true,
      due: payments.inboxPending,
      detail: anomalies([[payments.inboxFailed, "en échec"]]),
    },
    {
      key: "emails",
      route: "worker · EmailOutbox",
      label: "E-mails en file",
      effect: "Remet au serveur SMTP les e-mails de notification.",
      schedule: "en continu (≈ 1 s)",
      movesMoney: false,
      due: emails.pending,
      detail: anomalies([
        [emails.late, "en retard"],
        [emails.failed, "abandonné(s)"],
      ]),
    },
  ];
}

function anomalies(entries: [number, string][]): string | undefined {
  const parts = entries.filter(([n]) => n > 0).map(([n, label]) => `⚠️ ${n} ${label}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
