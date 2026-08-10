// Styles/libellés partagés pour MissionStatus (enum réel, prisma/schema.prisma) — une
// seule source de vérité au lieu de dupliquer la même table dans chaque page qui affiche
// un statut de mission (liste, détail, dashboard).
// Les 11 valeurs réelles de l'enum MissionStatus (prisma/schema.prisma). Manquaient ici
// "fonds_sous_sequestre" et "validee" — pourtant les deux seuls statuts posés par le webhook
// PSP (src/lib/psp-webhook.ts, US-503) à la confirmation d'un HOLD/RELEASE : une mission qui
// atteint l'étape paiement affichait son enum brut au lieu d'un libellé, et n'avait pas de
// chip de filtre dédié sur /missions. "en_cours" n'est actuellement posé nulle part côté
// code (statut mort dans le cycle réel) mais reste listé pour rester exhaustif vis-à-vis du
// schéma.
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
  validee: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", label: "Paiement libéré" },
  mediation_ouverte: { bg: "bg-red-50", text: "text-[#E8112D]", dot: "bg-[#E8112D]", label: "Médiation en cours" },
  cloturee: { bg: "bg-gray-900", text: "text-white", dot: "bg-white", label: "Terminée" },
};
