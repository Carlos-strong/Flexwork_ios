// Famille 4 — les invariants (« Le socle et les deux manques » + « Dual-Role à l'épreuve du
// code ») : « L'opération est-elle cohérente en elle-même ? » Indépendamment des droits de
// l'appelant, l'écriture demandée produit-elle un état valide ? Ces règles portent sur la
// DONNÉE, pas sur le rôle de l'appelant — elles valent aujourd'hui (rôle unique) et demain
// (dual-role).

// Une personne ne peut pas être les deux parties d'un même contrat.
// Un contrat entre une personne et elle-même est refusé non pas faute de droits, mais parce
// qu'il n'a pas de sens — et un commanditaire ne peut pas candidater à sa propre mission.
export function assertNoSelfDealing(clientId: string, providerId: string): boolean {
  return clientId !== providerId;
}

// Invariant de lecture : si les deux faces sont vraies sur une même mission, une donnée
// invalide existe déjà en base — aucune décision d'autorisation n'est sûre au-dessus.
// Sous mono-rôle ces deux branches sont mutuellement exclusives ; sous dual-role un même
// utilisateur peut satisfaire les deux (le garde requireMissionParty l'autoriserait
// doublement, et isClient/isProvider deviendraient ambigus au lieu d'être faux).
export function assertPartyExclusive(isClient: boolean, isProvider: boolean): boolean {
  return !(isClient && isProvider);
}
