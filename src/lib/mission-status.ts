// Styles/libellés partagés pour MissionStatus (enum réel, prisma/schema.prisma) — une
// seule source de vérité au lieu de dupliquer la même table dans chaque page qui affiche
// un statut de mission (liste, détail, dashboard).
// Les 11 valeurs réelles de l'enum MissionStatus (prisma/schema.prisma). "en_cours" est posé
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
] as const;

export type MissionStatusValue = (typeof MISSION_STATUSES)[number];

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
};
