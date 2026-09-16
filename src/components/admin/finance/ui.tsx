// Vocabulaire et primitives visuelles de la console financière admin — une seule définition des
// libellés et des tons, partagée par la page et ses panneaux.

export const money = (n: number, currency = "XOF") =>
  `${Math.round(n).toLocaleString("fr-FR")} ${currency}`;

export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export type Tone = "green" | "amber" | "red" | "blue" | "slate" | "dark";

const TONE_CLASS: Record<Tone, string> = {
  green: "bg-[#E6F4EE] text-[#00623A]",
  amber: "bg-[#FFFBEB] text-[#92400E]",
  red: "bg-[#FEF2F2] text-[#B91C1C]",
  blue: "bg-[#EFF6FF] text-[#1E40AF]",
  slate: "bg-[#F1F5F9] text-[#475569]",
  dark: "bg-[#0f172a] text-white",
};

export function Chip({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </span>
  );
}

// `sign` : sens du mouvement pour le séquestre — +1 entre, −1 sort, 0 ne déplace aucun fonds.
export const OP_TYPE: Record<string, { label: string; sign: 1 | -1 | 0; tone: Tone }> = {
  hold: { label: "Financement", sign: 1, tone: "blue" },
  release: { label: "Versement prestataire", sign: -1, tone: "green" },
  retention_release: { label: "Retenue versée", sign: -1, tone: "green" },
  refund: { label: "Remboursement client", sign: -1, tone: "slate" },
  freeze: { label: "Gel", sign: 0, tone: "red" },
  unfreeze: { label: "Dégel", sign: 0, tone: "amber" },
};

export const OP_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "En attente PSP", tone: "amber" },
  confirmed: { label: "Confirmée", tone: "green" },
  failed: { label: "Échouée", tone: "red" },
};

export const PAYABLE_STATUS: Record<string, { label: string; tone: Tone }> = {
  validated: { label: "Due, non instruite", tone: "amber" },
  instructed: { label: "Instruite", tone: "blue" },
  paid: { label: "Payée", tone: "green" },
  failed: { label: "Refusée PSP", tone: "red" },
};

export const FIN_STATE: Record<string, { label: string; tone: Tone }> = {
  non_finance: { label: "Non financé", tone: "slate" },
  financement_en_attente: { label: "Financement en attente", tone: "amber" },
  sequestre: { label: "Sous séquestre", tone: "green" },
  partiellement_libere: { label: "Partiellement libéré", tone: "blue" },
  totalement_libere: { label: "Totalement libéré", tone: "green" },
  cloture: { label: "Clôturé", tone: "dark" },
};

export const MISSION_STATUS: Record<string, string> = {
  brouillon: "Brouillon",
  publiee: "Publiée",
  proposition_acceptee: "Proposition acceptée",
  contrat_genere: "Contrat généré",
  contrat_signe: "Contrat signé",
  fonds_sous_sequestre: "Fonds sous séquestre",
  en_cours: "En cours",
  livrable_soumis: "Livrable soumis",
  validee: "Validée",
  cloturee: "Clôturée",
  mediation_ouverte: "Médiation ouverte",
  remboursee: "Remboursée",
};

export const SEVERITY: Record<string, { label: string; tone: Tone; dot: string }> = {
  critical: { label: "Critique", tone: "red", dot: "bg-[#DC2626]" },
  warning: { label: "À traiter", tone: "amber", dot: "bg-[#D97706]" },
  info: { label: "Info", tone: "slate", dot: "bg-[#94A3B8]" },
};

export const ANOMALY: Record<string, { label: string; action: string }> = {
  invariant_violation: { label: "Règle d'or violée", action: "Examiner le registre du contrat — aucun geste automatique." },
  stale_instruction: { label: "Instruction non confirmée", action: "Vérifier l'opération auprès du PSP (référence ci-dessous)." },
  failed_payout: { label: "Versement refusé", action: "La créance reste due : faire réinstruire le versement." },
  unfunded_payable: { label: "Créance non couverte", action: "Le client doit compléter le séquestre depuis sa mission." },
  residual_on_closed: { label: "Reliquat sur mission close", action: "Rembourser le reliquat au client." },
  orphan_freeze: { label: "Gel sans litige", action: "Vérifier la médiation d'origine avant tout dégel." },
  retention_stuck: { label: "Retenue non versée", action: "Solder la retenue au prestataire." },
  gig_residual: { label: "Reliquat de commande Gig", action: "Vérifier le remboursement ou la livraison de la commande." },
};

export const ACTION_ERROR: Record<string, string> = {
  forbidden_wrong_admin_role: "Action réservée au rôle admin Médiation.",
  forbidden: "Action réservée à l'administration.",
  justification_required: "Une justification d'au moins 5 caractères est obligatoire.",
  invalid_amount: "Le montant doit être un nombre positif.",
  nothing_to_refund: "Aucun reliquat disponible à rembourser.",
  no_retention_on_contract: "Ce contrat ne porte pas de retenue de garantie.",
  no_retention_accrued: "Aucune retenue n'est encore acquise.",
  retention_already_instructed: "La retenue a déjà été instruite.",
};

export const inputCls =
  "w-full h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

export const selectCls =
  "h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

// ── Journal des échanges PSP ─────────────────────────────────────────────────────────────────
export const PSP_EVENT: Record<string, string> = {
  hold_confirmed: "Financement confirmé",
  release_confirmed: "Versement confirmé",
  freeze_confirmed: "Gel confirmé",
  unfreeze_confirmed: "Dégel confirmé",
  refund_confirmed: "Remboursement confirmé",
  failed: "Échec signalé",
  unknown: "Message illisible",
};

export const PSP_OUTCOME: Record<string, { label: string; tone: Tone }> = {
  applied: { label: "Appliqué", tone: "green" },
  replayed: { label: "Rejeu ignoré", tone: "blue" },
  rejected: { label: "Rejeté", tone: "red" },
};

export const PSP_CHANNEL: Record<string, string> = {
  webhook: "Webhook PSP",
  virtual_console: "Console PSP virtuelle",
  autoconfirm: "Confirmation auto",
};

export const PSP_ERROR: Record<string, string> = {
  invalid_signature: "Signature invalide",
  missing_signature: "Signature absente",
  invalid_payload: "Charge illisible",
  operation_not_found: "Référence inconnue",
  operation_out_of_scope: "Hors portée",
  operation_already_settled: "Dénouement contradictoire",
  internal_error: "Erreur interne",
};

export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1).replace(".", ",")} h`;
  return `${(ms / 86_400_000).toFixed(1).replace(".", ",")} j`;
}
