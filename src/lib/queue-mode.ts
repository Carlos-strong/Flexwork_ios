// Mode d'exécution des traitements différables (2026-10-01) : paiements et e-mails.
//
//   - `inline` (défaut) : les instructions PSP sont transmises, les webhooks appliqués et les
//     e-mails envoyés dans la requête qui les produit. Aucun worker requis — développement,
//     tests, petite instance.
//   - `worker` : la requête se contente d'ÉCRIRE (outbox PSP, inbox des webhooks, outbox des
//     e-mails) et rend la main ; le worker (`npm run worker`) fait le reste. Mode de production :
//     une requête HTTP ne dépend plus de la latence du PSP ni du serveur SMTP, et leur
//     indisponibilité ne fait plus échouer — ni perdre — l'action de l'utilisateur.
//
// Exceptions, dans les deux modes : le financement (HOLD), que le client attend pour payer, et le
// code OTP, qu'il attend pour se connecter, restent immédiats.
export type QueueMode = "inline" | "worker";

export function queueMode(): QueueMode {
  return process.env.QUEUE_MODE === "worker" ? "worker" : "inline";
}
