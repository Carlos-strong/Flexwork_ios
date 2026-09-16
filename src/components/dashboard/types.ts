// Types partagés par tous les dashboards prestataires

export type ApiMission = {
  id: string; titre: string; description: string; domaine: string;
  budget: number; currency: string; delaiJours: number;
  status: string; riskLevel: string; insuranceRequired: boolean;
  createdAt: string;
  // Mode de financement et conditions au temps (S2) — renvoyés tels quels par GET /api/missions.
  financingModeKey?: string | null; timeRate?: number | null; timeMaxQuantity?: number | null;
};

export const STATUS_LABEL: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  brouillon:            { label: "Brouillon",            bg: "bg-gray-100", text: "text-gray-500",  dot: "bg-gray-300" },
  publiee:              { label: "Ouverte",              bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  proposition_acceptee: { label: "Proposition acceptée", bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  contrat_genere:       { label: "Contrat généré",       bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  contrat_signe:        { label: "Contrat signé",        bg: "bg-blue-50",   text: "text-blue-700",  dot: "bg-blue-500" },
  en_cours:             { label: "En cours",             bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  livrable_soumis:      { label: "Livrable soumis",      bg: "bg-amber-50",  text: "text-amber-700", dot: "bg-[#FCD116]" },
  validee:              { label: "Validée",              bg: "bg-[#f0faf5]", text: "text-[#008751]", dot: "bg-[#008751]" },
  cloturee:             { label: "Clôturée",             bg: "bg-gray-900",  text: "text-white",     dot: "bg-white" },
  mediation_ouverte:    { label: "Médiation",            bg: "bg-red-50",    text: "text-[#E8112D]", dot: "bg-[#E8112D]" },
};

export const STATUS_TABS = [
  { id: "Tous", label: "Tous" },
  { id: "publiee", label: "Ouvertes" },
  { id: "proposition_acceptee", label: "Acceptées" },
  { id: "en_cours", label: "En cours" },
  { id: "cloturee", label: "Clôturées" },
];

export const RISK_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  low:    { label: "Risque faible", bg: "bg-green-50",  text: "text-green-700" },
  medium: { label: "Risque moyen",  bg: "bg-amber-50",  text: "text-amber-700" },
  high:   { label: "Risque élevé",  bg: "bg-red-50",    text: "text-red-700" },
};

export type Toast = { id: string; msg: string; icon: string };
