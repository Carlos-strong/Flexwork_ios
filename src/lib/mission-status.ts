// Styles/libellés partagés pour MissionStatus (enum réel, prisma/schema.prisma) — une
// seule source de vérité au lieu de dupliquer la même table dans chaque page qui affiche
// un statut de mission (liste, détail, dashboard).
// Les 12 valeurs réelles de l'enum MissionStatus (prisma/schema.prisma). "en_cours" est posé
// depuis le 2026-09-01 par le premier pointage « arrivée » du prestataire (A12 — POST
// .../contract/checkin/events), seule trace réelle de démarrage du travail ; il n'avance que
// depuis fonds_sous_sequestre. "validee" n'a plus été posé entre le 2026-09-02 (le webhook
// RELEASE pose directement "cloturee" — auparavant une mission sans jalon restait bloquée en
// "validee" sans jamais atteindre le lien "Donner un avis", gaté sur "cloturee") et le
// 2026-09-11 : depuis, c'est l'état — et le seul — d'un contrat à RETENUE DE GARANTIE (mode
// J4) dont tous les jalons sont libérés et dont la retenue cumulée est partie au PSP en une
// instruction finale, pas encore confirmée (voir emitRetentionRelease, src/lib/psp-webhook.ts).
// D'où le libellé : le travail est validé et les jalons payés, mais il reste de l'argent au
// séquestre — dire « Paiement libéré » ici induirait le prestataire en erreur.
export const MISSION_STATUSES = [
  "brouillon",
  "publiee",
  "proposition_acceptee",
  "contrat_genere",
  "contrat_signe",
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
  "validee",
  "mediation_ouverte",
  "cloturee",
  // Manquait à cette liste ET à la table de styles jusqu'au 16/09/2026. Tous les appelants
  // retombent sur `?? MISSION_STATUS_STYLE.brouillon` : une mission remboursée s'affichait donc
  // « Brouillon » partout — liste, détail, tableaux de bord. Pire qu'un trou visuel, c'était un
  // contresens : un dossier soldé passait pour un dossier jamais publié.
  "remboursee",
] as const;

export type MissionStatusValue = (typeof MISSION_STATUSES)[number];

// Statuts où la mission est FINIE et où plus aucun financement n'est attendu — ni le HOLD
// initial du contrat, ni celui d'un jalon. `remboursee` y figure autant que `cloturee` : rendre
// les fonds puis en redemander serait pire encore que financer une mission déjà payée.
//
// Volontairement séparé de MISSION_STATUSES ci-dessus, qui décrit l'AFFICHAGE : ceci est une
// règle, elle est lue par le serveur (gardes de financement, src/lib/escrow.ts et la route de
// HOLD par jalon) autant que par la page contrat qui masque le bouton. Une seule liste pour les
// deux, sinon l'écran et le serveur finissent par diverger — ce fut exactement le cas jusqu'au
// 16/09/2026 : la page proposait « Procéder au paiement sous séquestre » sur une mission
// clôturée, et le serveur l'aurait accepté si aucun HOLD antérieur n'était en vol.
export const MISSION_FUNDING_CLOSED_STATUSES = ["cloturee", "remboursee"] as const;

export function isMissionFundingClosed(status: string | null | undefined): boolean {
  return !!status && (MISSION_FUNDING_CLOSED_STATUSES as readonly string[]).includes(status);
}

export const MISSION_STATUS_STYLE: Record<MissionStatusValue, { bg: string; text: string; dot: string; label: string }> = {
  brouillon: { bg: "bg-gray-100", text: "text-gray-500", dot: "bg-gray-400", label: "Brouillon" },
  publiee: { bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]", label: "Ouverte aux candidatures" },
  proposition_acceptee: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", label: "Proposition acceptée" },
  contrat_genere: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", label: "Contrat généré" },
  contrat_signe: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400", label: "Contrat signé" },
  fonds_sous_sequestre: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Fonds sous séquestre" },
  en_cours: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Travail en cours" },
  livrable_soumis: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", label: "Livrable soumis" },
  validee: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Retenue de garantie en cours" },
  mediation_ouverte: { bg: "bg-red-50", text: "text-[#E8112D]", dot: "bg-[#E8112D]", label: "Médiation en cours" },
  cloturee: { bg: "bg-gray-900", text: "text-white", dot: "bg-white", label: "Terminée" },
  // Délibérément PAS « Terminée », et délibérément pas le noir de `cloturee` : le schéma pose
  // `remboursee` comme un état à part précisément pour qu'un abandon ne passe pas pour une
  // réussite (voir prisma/schema.prisma, enum MissionStatus). L'ardoise reprend le ton déjà
  // utilisé par la console financière pour « Remboursé aux clients ».
  remboursee: { bg: "bg-slate-100", text: "text-[#475569]", dot: "bg-[#64748B]", label: "Remboursée" },
};

// Libellés de l'écran de VALIDATION CLIENT (ValidationClientView) : ils disent au client ce
// qu'il a à FAIRE (« À valider »), là où le badge général dit seulement où en est la mission.
// Volontairement partiel, donc — mais le repli ne doit jamais exposer la valeur brute de l'enum :
// sur une mission `cloturee`, `remboursee` ou `validee`, la carte affichait littéralement
// « remboursee » au client (constaté 16/09/2026). Hors de ces trois états, le libellé partagé
// ci-dessus prend le relais.
//
// Ici et non dans le composant, pour rester testable en pur (vitest, environment "node") — même
// convention que src/lib/contract-stepper.ts.
const MISSION_ESCROW_STATUS: Record<string, { label: string; color: string }> = {
  fonds_sous_sequestre: { label: "Financé — en attente du prestataire", color: "text-[#008751]" },
  en_cours: { label: "Financé — en attente du prestataire", color: "text-[#008751]" },
  livrable_soumis: { label: "À valider", color: "text-[#B45309]" },
};

export function missionEscrowStatusLabel(status: string): string {
  return (
    MISSION_ESCROW_STATUS[status]?.label ??
    MISSION_STATUS_STYLE[status as MissionStatusValue]?.label ??
    status
  );
}
