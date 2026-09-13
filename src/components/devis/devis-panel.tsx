"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { DevisData } from "@/lib/devis";
import { canClientRequestRevision, canProviderReviseDevis } from "@/lib/devis";
import { authorDisplayName, PROPOSAL_STATUS_LABEL, type DevisProposalPayload } from "./types";
import { refreshBadges } from "@/lib/badge-sync";
import { missionFlow } from "@/lib/mission-flow";

// Panneau de négociation de devis : affiche l'état de la candidature, le devis courant,
// l'historique des révisions et les actions du rôle (soumettre/réviser pour le prestataire,
// valider pour le client). Langage de carte aligné sur
// Recap-Offre-Candidature-Envoyee-Vjr — composant utilisé uniquement par
// /missions/[id]/page.tsx, restylable ici sans effet ailleurs.
export function DevisPanel({
  missionId,
  maxRounds,
  proposal,
  isClient,
  canSubmit = true,
  onChanged,
  currency,
}: {
  missionId: string;
  maxRounds: number;
  proposal: DevisProposalPayload | null;
  isClient: boolean;
  canSubmit?: boolean;
  onChanged?: () => void;
  /** Devise réelle de la mission (mission.currency) — jamais un symbole fixe, ce projet
      travaille en XOF, jamais en euros. */
  currency: string;
}) {
  if (!proposal) {
    if (isClient || !canSubmit) return null;
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
        <h3 className="text-[13px] font-semibold mb-2">Candidater avec un devis</h3>
        <p className="text-[13px] text-[#64748B] mb-3">
          Préparez votre devis (jalons, délai, message) sur la page dédiée.
        </p>
        <Link href={`/missions/${missionId}/devis`} className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49] transition-colors" style={{ textDecoration: "none" }}>
          Soumettre un devis
        </Link>
      </div>
    );
  }

  const devis: DevisData | null = proposal.devisData;
  const isClosed =
    proposal.status === "acceptee" ||
    proposal.status === "refusee" ||
    proposal.status === "annulee_definitive" ||
    proposal.status === "devis_valide";
  const canResubmit =
    !isClient &&
    canSubmit &&
    !isClosed &&
    proposal.roundActuel < maxRounds &&
    canProviderReviseDevis({ hasDevis: !!devis, revisionRequested: !!proposal.revisionRequestedAt });
  const canValidate = isClient && proposal.status === "en_negociation";
  const canRequestRevision =
    isClient &&
    canClientRequestRevision({
      hasDevis: !!devis,
      status: proposal.status as Parameters<typeof canClientRequestRevision>[0]["status"],
      revisionAlreadyRequested: !!proposal.revisionRequestedAt,
    });
  const lastRound = proposal.status === "en_negociation" && proposal.roundActuel >= maxRounds;

  // Mini-stepper "Soumission / Contre-offre / Finalisation" — représentation générique du
  // cycle de négociation (pas le compteur de round lui-même, affiché séparément juste
  // au-dessus). Dérivé uniquement de données réelles : roundActuel > 1 signifie qu'au moins
  // une révision a eu lieu ; isClosed couvre tous les statuts de fin de négociation.
  const stepIndex = isClosed ? 2 : proposal.roundActuel > 1 ? 1 : 0;
  const STEPS = ["Soumission", "Contre-offre", "Finalisation"];
  // Une fois le devis validé, la négociation est terminée : la barre affiche 100%, pas
  // roundActuel/maxRounds (round 1/3 → 33% aurait affiché une barre orange partielle à côté
  // d'un badge "Devis validé", laissant croire que la négociation continue).
  const roundPct = proposal.status === "devis_valide" ? 100 : Math.min(100, Math.round((proposal.roundActuel / maxRounds) * 100));

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Ma candidature</h3>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" /> {PROPOSAL_STATUS_LABEL[proposal.status] ?? proposal.status}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[12px] font-medium text-[#0f172a]">Round {proposal.roundActuel}/{maxRounds}</div>
          <div className="text-[11px] text-[#64748B]">{roundPct}%</div>
        </div>
        <div className="mt-2 h-2 w-full bg-[#F1F5F9] rounded-full overflow-hidden">
          <div className="h-full bg-[#F59E0B] rounded-full" style={{ width: `${roundPct}%` }} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          {STEPS.map((_, i) => (
            <div key={i} className="flex items-center gap-3 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold border shrink-0 ${i <= stepIndex ? "bg-[#0f172a] text-white border-[#0f172a]" : "bg-white text-[#94A3B8] border-[#E2E8F0]"}`}>
                {i < stepIndex ? <Check size={14} /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-[2px] ${i < stepIndex ? "bg-[#0f172a]" : "bg-[#F1F5F9]"}`} />}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 text-[11px] text-[#64748B]">
          <span className={stepIndex === 0 ? "font-medium text-[#0f172a]" : ""}>{STEPS[0]}</span>
          <span className={`text-center ${stepIndex === 1 ? "font-medium text-[#0f172a]" : ""}`}>{STEPS[1]}</span>
          <span className={`text-right ${stepIndex === 2 ? "font-medium text-[#0f172a]" : ""}`}>{STEPS[2]}</span>
        </div>
      </div>

      {devis ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Devis — Round {proposal.roundActuel}</h3>
            <span className="text-[11px] text-[#94A3B8]">Read-only • envoyé</span>
          </div>
          <div className="p-4 lg:p-5">
            <DevisDetails devis={devis} currency={currency} />
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[#64748B]">Aucun devis soumis pour le moment.</p>
      )}

      {lastRound && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E]">
          Dernier round. Sans accord, la candidature sera annulée à l&apos;expiration de la mission.
        </div>
      )}

      {proposal.revisionRequestedAt && (
        <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF]">
          {isClient ? "Révision demandée" : "Le client a demandé une révision"} le{" "}
          {new Date(proposal.revisionRequestedAt).toLocaleDateString("fr-FR")}
          {proposal.revisionRequestMessage && <> — « {proposal.revisionRequestMessage} »</>}
          {!isClient && " — vous pouvez soumettre un nouveau devis ci-dessous."}
        </div>
      )}

      {canResubmit && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">{proposal.devisData ? "Réviser le devis" : "Soumettre le devis"}</h3>
          <Link href={`/missions/${missionId}/devis`} className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49] transition-colors" style={{ textDecoration: "none" }}>
            {proposal.devisData ? "Réviser mon devis" : "Soumettre mon devis"}
          </Link>
        </div>
      )}

      {(canValidate || canRequestRevision) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {canValidate && <ValidateDevis missionId={missionId} proposalId={proposal.id} onValidated={onChanged} />}
          {canRequestRevision && <RequestRevision missionId={missionId} proposalId={proposal.id} onRequested={onChanged} />}
        </div>
      )}

      <Revisions revisions={proposal.revisions} />
    </div>
  );
}

export function DevisDetails({ devis, currency }: { devis: DevisData; currency: string }) {
  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="bg-[#F8FAF9] text-[11px] uppercase tracking-widest text-[#64748B] border-b border-[#E2E8F0]">
              <th className="text-left py-2.5 px-3 font-semibold">Description</th>
              <th className="text-right py-2.5 px-3 font-semibold">Délai</th>
              <th className="text-right py-2.5 px-3 font-semibold">Unité</th>
              <th className="text-right py-2.5 px-3 font-semibold">Prix unitaire</th>
              <th className="text-right py-2.5 px-3 font-semibold">Montant</th>
            </tr>
          </thead>
          <tbody>
            {devis.lineItems.map((item, idx) => (
              <tr key={idx} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#FBFDFC] transition-colors">
                <td className="py-2.5 px-3 align-top">
                  <div className="font-medium text-[#0f172a]">{item.description}</div>
                </td>
                <td className="py-2.5 px-3 text-right align-top">
                  {item.echeance ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-white border border-[#E2E8F0] text-[11px] text-[#64748B]">{item.echeance}</span>
                  ) : (
                    <span className="text-[#CBD5E1]">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right text-[#475569] align-top">{item.quantity} {item.unit}</td>
                <td className="py-2.5 px-3 text-right text-[#475569] font-mono align-top">
                  {item.unitPrice.toLocaleString("fr-FR")} {currency}
                </td>
                <td className="py-2.5 px-3 text-right font-medium font-mono align-top">
                  {item.total.toLocaleString("fr-FR")} {currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-4">
        <div className="w-full sm:w-[280px] space-y-1.5 text-[13px]">
          {devis.laborCost > 0 && (
            <div className="flex justify-between">
              <span className="text-[#64748B]">Main d&apos;œuvre</span>
              <span className="font-mono">{devis.laborCost.toLocaleString("fr-FR")} {currency}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#64748B]">Total HT</span>
            <span className="font-mono">{devis.totalHT.toLocaleString("fr-FR")} {currency}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#64748B]">TVA ({devis.tvaRate}%)</span>
            <span className="font-mono">{devis.tva.toLocaleString("fr-FR")} {currency}</span>
          </div>
          <div className="flex justify-between font-bold text-[15px] text-[#0f172a] border-t border-[#0f172a] pt-2 mt-1">
            <span>Total TTC</span>
            <span className="font-mono text-[#008751]">{devis.totalTTC.toLocaleString("fr-FR")} {currency}</span>
          </div>
        </div>
      </div>

      {(devis.delay || devis.notes) && (
        <div className="mt-4 pt-3 border-t border-[#F1F5F9] space-y-1">
          {devis.delay && <p className="text-[13px] text-[#64748B]">Délai global : {devis.delay}</p>}
          {devis.notes && <p className="text-[13px] text-[#64748B] whitespace-pre-wrap">Notes : {devis.notes}</p>}
        </div>
      )}
    </div>
  );
}

export function ValidateDevis({
  missionId,
  proposalId,
  onValidated,
}: {
  missionId: string;
  proposalId: string;
  onValidated?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function validate() {
    setPending(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${proposalId}/devis/validate`, {
      method: "POST",
    });
    setPending(false);
    if (res.ok) {
      // Passage de relais (audit workflow A-4) : l'étape suivante de la chronologie est la
      // génération du contrat, sur la page contrat — même motif que la redirection auto
      // signature 2/2 → séquestre, avec le délai de 1200 ms des autres confirmations pour
      // laisser lire le message avant le bond de page.
      setFeedback("Devis validé — ouverture de l'étape contrat…");
      onValidated?.();
      setTimeout(() => router.push(`/missions/${missionId}/contract`), 1200);
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.error ?? "Échec de la validation.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 flex-1">
      <button onClick={validate} disabled={pending} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
        {pending ? "Validation..." : "Valider le devis"}
      </button>
      {feedback && <p className="mt-2 text-[13px] text-[#008751]">{feedback}</p>}
    </div>
  );
}

// Suite du parcours une fois la candidature retenue — Offre acceptée → Signature →
// Financement séquestre → Pilotage des jalons (2026-09-09). Remplace le cul-de-sac
// « vous pouvez générer le contrat depuis le détail de la mission » : les quatre étapes sont
// visibles, l'étape courante est dérivée du statut réel de la mission (src/lib/mission-flow.ts)
// et le bouton mène exactement à la page de cette étape. Aucune décision supplémentaire n'est
// demandée au client : c'est un fil conducteur, pas un formulaire.
export function MissionFlowSteps({ missionId, missionStatus }: { missionId: string; missionStatus: string | null | undefined }) {
  const flow = missionFlow(missionId, missionStatus);

  return (
    <div className="w-full space-y-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {flow.steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold border ${
                step.current
                  ? "bg-[#0f172a] text-white border-[#0f172a]"
                  : step.done
                    ? "bg-[#E6F4EE] text-[#008751] border-[#A7F3D0]"
                    : "bg-white text-[#94A3B8] border-[#E2E8F0]"
              }`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${step.done ? "bg-[#008751] text-white" : step.current ? "bg-white text-[#0f172a]" : "bg-[#F1F5F9] text-[#94A3B8]"}`}>
                {step.done ? "✓" : i + 1}
              </span>
              {step.label}
            </span>
            {i < flow.steps.length - 1 && <span className="text-[#CBD5E1] text-[11px]">→</span>}
          </li>
        ))}
      </ol>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="flex-1 text-[12.5px] text-[#64748B] leading-relaxed">{flow.hint}</p>
        {flow.cta && (
          <Link
            href={flow.cta.href}
            className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors flex items-center justify-center shrink-0"
            style={{ textDecoration: "none" }}
          >
            {flow.cta.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

// Seule action qui fait réapparaître "Réviser le devis" côté prestataire — voir
// canProviderReviseDevis (src/lib/devis.ts) et la garde serveur équivalente dans
// POST /api/missions/[id]/devis.
export function RequestRevision({
  missionId,
  proposalId,
  onRequested,
}: {
  missionId: string;
  proposalId: string;
  onRequested?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function requestRevision() {
    setPending(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${proposalId}/devis/request-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim() || undefined }),
    });
    setPending(false);
    if (res.ok) {
      setFeedback("Demande de révision envoyée au prestataire.");
      setOpen(false);
      onRequested?.();
      // Le devis passe en "négociation" — resynchronise le compteur du bloc "Documents
      // Contractuels" du sidebar (useDevisContratsBadges) tout de suite.
      refreshBadges();
    } else {
      setFeedback("Échec de la demande de révision.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 flex-1">
      {open ? (
        <>
          <label className="text-[12px] font-medium text-[#475569]">Que faut-il changer ? (optionnel)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex. Revoir le délai, détailler la ligne peinture..."
            className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-[13px]"
            rows={3}
          />
          <div className="mt-2 flex gap-2">
            <button onClick={requestRevision} disabled={pending} className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
              {pending ? "Envoi..." : "Envoyer la demande"}
            </button>
            <button onClick={() => setOpen(false)} disabled={pending} className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
              Annuler
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => setOpen(true)} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
          Demander une révision
        </button>
      )}
      {feedback && <p className="mt-2 text-[13px] text-[#008751]">{feedback}</p>}
    </div>
  );
}

// Rejet explicite d'UNE candidature, distinct du passage à "refusee" en effet de bord de
// l'acceptation d'une autre proposition (voir POST .../devis/reject). Motif obligatoire —
// contrairement à RequestRevision, le rejet met fin à la négociation, pas de champ optionnel.
export function RejectDevis({
  missionId,
  proposalId,
  onRejected,
}: {
  missionId: string;
  proposalId: string;
  onRejected?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function reject() {
    if (!reason.trim()) {
      setFeedback("Le motif du rejet est obligatoire.");
      return;
    }
    setPending(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${proposalId}/devis/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setPending(false);
    if (res.ok) {
      setOpen(false);
      onRejected?.();
      // Le devis passe en "rejeté" — resynchronise le compteur du bloc "Documents
      // Contractuels" du sidebar (useDevisContratsBadges) tout de suite.
      refreshBadges();
    } else {
      setFeedback("Échec du rejet.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 flex-1">
      {open ? (
        <>
          <label className="text-[12px] font-medium text-[#475569]">
            Motif du rejet <span className="text-red-600">*</span> <span className="font-normal text-[#94A3B8]">obligatoire</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. Devis trop élevé, délai incompatible, profil ne correspond pas..."
            className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-[13px]"
            rows={3}
          />
          <div className="mt-2 flex gap-2">
            <button onClick={reject} disabled={pending} className="h-9 px-4 rounded-lg bg-[#DC2626] text-white text-[13px] font-medium hover:bg-[#B91C1C] disabled:opacity-50">
              {pending ? "Envoi..." : "Confirmer le rejet"}
            </button>
            <button onClick={() => setOpen(false)} disabled={pending} className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
              Annuler
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => setOpen(true)} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
          Rejeter
        </button>
      )}
      {feedback && <p className="mt-2 text-[13px] text-red-600">{feedback}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Négociation prix fixe/taux (2026-08-29) — même modèle que DevisPanel ci-dessus (round
// tracker, DevisDetails, RequestRevision, historique des révisions), réutilisé tel quel
// plutôt que dupliqué. Deux différences structurelles, propres à ce mode :
//   - Pas de page dédiée pour la 1ʳᵉ soumission (missions/[id]/page.tsx garde son propre
//     petit formulaire montant + message) : ce panneau n'est monté qu'une fois `proposal`
//     déjà non-null, contrairement à DevisPanel qui gère aussi le cas "pas encore candidaté".
//   - L'acceptation finale passe par POST .../accept (AcceptFixedPrice ci-dessous), PAS par
//     .../devis/validate qui pose le statut "devis_valide" : de nombreux endroits de l'app
//     (génération de contrat exceptée, qui accepte déjà les deux) ne reconnaissent que
//     "acceptee" comme candidature gagnante — messages, avis, stats prestataire, page
//     contrat. Réutiliser "devis_valide" ici casserait silencieusement tout ça pour les
//     missions à prix fixe/taux.
export function FixedPricePanel({
  missionId,
  maxRounds,
  proposal,
  isClient,
  onChanged,
  currency,
}: {
  missionId: string;
  maxRounds: number;
  proposal: DevisProposalPayload;
  isClient: boolean;
  onChanged?: () => void;
  currency: string;
}) {
  const devis: DevisData | null = proposal.devisData;
  const isClosed = proposal.status === "acceptee" || proposal.status === "refusee" || proposal.status === "annulee_definitive";
  const canResubmit =
    !isClient &&
    !isClosed &&
    proposal.roundActuel < maxRounds &&
    canProviderReviseDevis({ hasDevis: !!devis, revisionRequested: !!proposal.revisionRequestedAt });
  const canAccept = isClient && !isClosed;
  const canRequestRevision =
    isClient &&
    canClientRequestRevision({
      hasDevis: !!devis,
      status: proposal.status as Parameters<typeof canClientRequestRevision>[0]["status"],
      revisionAlreadyRequested: !!proposal.revisionRequestedAt,
    });
  const lastRound = !isClosed && proposal.roundActuel >= maxRounds;

  return (
    <div className="space-y-4">
      <NegotiationTracker status={proposal.status} roundActuel={proposal.roundActuel} maxRounds={maxRounds} />

      {devis ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Prix proposé — Round {proposal.roundActuel}</h3>
            <span className="text-[11px] text-[#94A3B8]">Read-only • envoyé</span>
          </div>
          <div className="p-4 lg:p-5">
            <DevisDetails devis={devis} currency={currency} />
            <div className="mt-3">
              {proposal.delaiPropose ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F8FAF9] border border-[#E2E8F0] text-[11.5px] text-[#475569]">
                  ⏱ Délai proposé : <strong>{proposal.delaiPropose} jours</strong>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F8FAF9] border border-[#E2E8F0] text-[11.5px] text-[#94A3B8]">
                  Délai non précisé — celui de la mission s&apos;applique
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-[#64748B]">Aucun prix soumis pour le moment.</p>
      )}

      {lastRound && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E]">
          Dernier round. Sans accord, la candidature sera annulée à l&apos;expiration de la mission.
        </div>
      )}

      {proposal.revisionRequestedAt && (
        <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF]">
          {isClient ? "Révision demandée" : "Le client a demandé une révision"} le{" "}
          {new Date(proposal.revisionRequestedAt).toLocaleDateString("fr-FR")}
          {proposal.revisionRequestMessage && <> — « {proposal.revisionRequestMessage} »</>}
          {!isClient && " — vous pouvez proposer un nouveau prix ci-dessous."}
        </div>
      )}

      {canResubmit && <ResubmitPrice missionId={missionId} suggestedAmount={proposal.montant} onSubmitted={onChanged} />}

      {(canAccept || canRequestRevision) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {canAccept && <AcceptFixedPrice missionId={missionId} proposalId={proposal.id} onAccepted={onChanged} />}
          {canRequestRevision && <RequestRevision missionId={missionId} proposalId={proposal.id} onRequested={onChanged} />}
        </div>
      )}

      <Revisions revisions={proposal.revisions} />
    </div>
  );
}

// Stepper "Soumission / Contre-offre / Finalisation" — factorisé hors de DevisPanel pour être
// réutilisé tel quel par FixedPricePanel (même représentation générique du cycle de
// négociation pour les deux modes, dérivée uniquement de données réelles : roundActuel > 1
// signifie qu'au moins une révision a eu lieu, isClosed couvre tous les statuts de fin).
function NegotiationTracker({ status, roundActuel, maxRounds }: { status: string; roundActuel: number; maxRounds: number }) {
  const isClosed = status === "acceptee" || status === "refusee" || status === "annulee_definitive" || status === "devis_valide";
  const stepIndex = isClosed ? 2 : roundActuel > 1 ? 1 : 0;
  const STEPS = ["Soumission", "Contre-offre", "Finalisation"];
  // Même correctif que le tracker inline de DevisPanel ci-dessus : une fois la candidature
  // ACCEPTÉE, 100% — pas roundActuel/maxRounds (qui resterait bloqué sous 100%, ex. round
  // 1/3 → 33%, alors que le badge affiche déjà "Acceptée"). Restreint à "acceptee"/
  // "devis_valide" et non à isClosed en entier : une candidature refusée/annulée ne doit PAS
  // afficher 100%, ce serait un signal positif trompeur sur une négociation qui a échoué.
  const isAccepted = status === "acceptee" || status === "devis_valide";
  const roundPct = isAccepted ? 100 : Math.min(100, Math.round((roundActuel / maxRounds) * 100));

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Ma candidature</h3>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" /> {PROPOSAL_STATUS_LABEL[status] ?? status}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="text-[12px] font-medium text-[#0f172a]">Round {roundActuel}/{maxRounds}</div>
        <div className="text-[11px] text-[#64748B]">{roundPct}%</div>
      </div>
      <div className="mt-2 h-2 w-full bg-[#F1F5F9] rounded-full overflow-hidden">
        <div className="h-full bg-[#F59E0B] rounded-full" style={{ width: `${roundPct}%` }} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        {STEPS.map((_, i) => (
          <div key={i} className="flex items-center gap-3 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold border shrink-0 ${i <= stepIndex ? "bg-[#0f172a] text-white border-[#0f172a]" : "bg-white text-[#94A3B8] border-[#E2E8F0]"}`}>
              {i < stepIndex ? <Check size={14} /> : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-[2px] ${i < stepIndex ? "bg-[#0f172a]" : "bg-[#F1F5F9]"}`} />}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 text-[11px] text-[#64748B]">
        <span className={stepIndex === 0 ? "font-medium text-[#0f172a]" : ""}>{STEPS[0]}</span>
        <span className={`text-center ${stepIndex === 1 ? "font-medium text-[#0f172a]" : ""}`}>{STEPS[1]}</span>
        <span className={`text-right ${stepIndex === 2 ? "font-medium text-[#0f172a]" : ""}`}>{STEPS[2]}</span>
      </div>
    </div>
  );
}

// Acceptation finale d'une négociation prix fixe/taux — POST .../accept (PAS
// .../devis/validate, voir le commentaire au-dessus de FixedPricePanel). Même composant
// utilisé par la carte "Ma candidature" (missions/[id]/page.tsx, côté client) et le tiroir
// de /missions/[id]/proposals (voir aussi acceptProposal, cette dernière page a sa propre
// action déjà câblée pour le bouton "Accepter" du tableau — celle-ci est pour ce panneau).
export function AcceptFixedPrice({
  missionId,
  proposalId,
  onAccepted,
}: {
  missionId: string;
  proposalId: string;
  onAccepted?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${proposalId}/accept`, { method: "POST" });
    setPending(false);
    if (res.ok) {
      // Passage de relais (A-4) : même chose que ValidateDevis ci-dessus — l'acceptation
      // était le seul maillon de la chronologie sans orientation vers l'étape suivante.
      setFeedback("Candidature acceptée — ouverture de l'étape contrat…");
      onAccepted?.();
      setTimeout(() => router.push(`/missions/${missionId}/contract`), 1200);
    } else {
      setFeedback("Échec de l'acceptation.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 flex-1">
      <button onClick={accept} disabled={pending} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
        {pending ? "Acceptation..." : "Accepter le prix"}
      </button>
      {feedback && <p className="mt-2 text-[13px] text-[#008751]">{feedback}</p>}
    </div>
  );
}

// Resoumission d'un prix par le prestataire après une demande de révision du client — pendant
// pour ce mode du lien "Réviser mon devis" de DevisPanel, en formulaire inline (un prix fixe
// n'a pas besoin d'une page dédiée à jalons comme /missions/[id]/devis). Passe par la même
// route que la 1ʳᵉ soumission (POST /api/missions/[id]/proposals, upsert) — voir ce fichier
// pour la logique de round côté serveur.
function ResubmitPrice({
  missionId,
  suggestedAmount,
  onSubmitted,
}: {
  missionId: string;
  suggestedAmount: number;
  onSubmitted?: () => void;
}) {
  const [amount, setAmount] = useState(String(suggestedAmount));
  const [delay, setDelay] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit() {
    const montant = Number(amount);
    if (!amount || !(montant > 0)) {
      setFeedback("Indiquez un montant valide.");
      return;
    }
    setPending(true);
    setFeedback(null);
    const delaiPropose = delay.trim() ? Number(delay) : undefined;
    const res = await fetch(`/api/missions/${missionId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ montant, delaiPropose, message: message.trim() || undefined }),
    });
    setPending(false);
    if (res.ok) {
      setMessage("");
      onSubmitted?.();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.message ?? "Échec de l'envoi du nouveau prix.");
    }
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 space-y-3">
      <h3 className="text-[13px] font-semibold">Proposer un nouveau prix</h3>
      <div>
        <label className="block text-[12px] font-medium text-[#475569] mb-1">Nouveau prix *</label>
        <input
          type="number"
          min={1}
          step={500}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
        />
      </div>
      <div>
        <label className="block text-[12px] font-medium text-[#475569] mb-1">Nouveau délai (jours) — optionnel</label>
        <input
          type="number"
          min={1}
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
        />
      </div>
      <div>
        <label className="block text-[12px] font-medium text-[#475569] mb-1">Message (optionnel)</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
          rows={2}
          placeholder="Précisez ce qui a changé..."
          className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
        />
      </div>
      {feedback && <p className="text-[12px] text-red-600">{feedback}</p>}
      <button onClick={submit} disabled={pending} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
        {pending ? "Envoi..." : "Envoyer le nouveau prix"}
      </button>
    </div>
  );
}

export function Revisions({ revisions }: { revisions: DevisProposalPayload["revisions"] }) {
  if (!revisions?.length) return null;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
      <h3 className="text-[13px] font-semibold mb-4">Historique des révisions</h3>
      <div className="relative pl-6 border-l border-[#E2E8F0] space-y-5">
        {revisions.map((rev) => (
          <div key={rev.id} className="relative">
            <div className="absolute -left-[29px] top-1 w-2.5 h-2.5 rounded-full bg-[#008751] border-2 border-white shadow" />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <span className="text-[13px] font-semibold">Round {rev.roundNumber} — {authorDisplayName(rev.author)}</span>
              <span className="text-[11px] text-[#94A3B8]">{new Date(rev.createdAt).toLocaleDateString("fr-FR")}</span>
            </div>
            {rev.comment && <p className="mt-1 text-[12px] text-[#475569]">{rev.comment}</p>}
            <div className="mt-2 inline-flex px-2.5 py-1 rounded-full bg-[#F8FAF9] border border-[#E2E8F0] text-[11px] font-medium">
              Total TTC {rev.devisData.totalTTC.toLocaleString("fr-FR")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
