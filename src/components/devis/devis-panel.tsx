"use client";

import { useState } from "react";
import type { DevisData } from "@/lib/devis";
import { authorDisplayName, type DevisProposalPayload } from "./types";
import { DevisForm } from "./devis-form";

const STATUS_LABEL: Record<string, string> = {
  envoyee: "Candidature envoyée",
  preselectionnee: "Présélectionné",
  en_negociation: "En négociation",
  devis_valide: "Devis validé",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee_definitive: "Annulée",
};

// Panneau de négociation de devis : affiche l'état de la candidature, le devis courant,
// l'historique des révisions et les actions du rôle (soumettre/réviser pour le prestataire,
// valider pour le client).
export function DevisPanel({
  missionId,
  maxRounds,
  proposal,
  isClient,
  canSubmit = true,
  onChanged,
}: {
  missionId: string;
  maxRounds: number;
  proposal: DevisProposalPayload | null;
  isClient: boolean;
  canSubmit?: boolean;
  onChanged?: () => void;
}) {
  if (!proposal) {
    if (isClient || !canSubmit) return null;
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">Candidater avec un devis</span>
        </div>
        <DevisForm missionId={missionId} maxRounds={maxRounds} onSubmitted={onChanged} />
      </div>
    );
  }

  const devis: DevisData | null = proposal.devisData;
  const isClosed =
    proposal.status === "acceptee" ||
    proposal.status === "refusee" ||
    proposal.status === "annulee_definitive" ||
    proposal.status === "devis_valide";
  const canResubmit = !isClient && canSubmit && !isClosed && proposal.roundActuel < maxRounds;
  const canValidate = isClient && proposal.status === "en_negociation";
  const lastRound = proposal.status === "en_negociation" && proposal.roundActuel >= maxRounds;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <span className="card-title">Ma candidature</span>
          <span className="badge">{STATUS_LABEL[proposal.status] ?? proposal.status}</span>
        </div>
        <p className="text-sm text-zinc-500">
          Round {proposal.roundActuel}/{maxRounds}
        </p>
      </div>

      {devis ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Devis — Round {proposal.roundActuel}</span>
          </div>
          <DevisDetails devis={devis} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Aucun devis soumis pour le moment.</p>
      )}

      {lastRound && (
        <div className="alert alert-warning">
          Dernier round. Sans accord, la candidature sera annulée à l&apos;expiration de la mission.
        </div>
      )}

      {canResubmit && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{proposal.devisData ? "Réviser le devis" : "Soumettre le devis"}</span>
          </div>
          <DevisForm
            missionId={missionId}
            maxRounds={maxRounds}
            initial={devis}
            onSubmitted={onChanged}
          />
        </div>
      )}

      {canValidate && <ValidateDevis missionId={missionId} proposalId={proposal.id} onValidated={onChanged} />}

      <Revisions revisions={proposal.revisions} />
    </div>
  );
}

export function DevisDetails({ devis }: { devis: DevisData }) {
  return (
    <div className="space-y-2">
      {devis.lineItems.map((item, idx) => (
        <div key={idx} className="flex justify-between text-sm">
          <span className="text-zinc-600">
            {item.description} — {item.quantity} {item.unit} × {item.unitPrice.toLocaleString("fr-FR")}
          </span>
          <span className="font-mono">{item.total.toLocaleString("fr-FR")}</span>
        </div>
      ))}
      <div className="border-t border-zinc-200 pt-2 text-sm text-zinc-600">
        <div className="flex justify-between">
          <span>Total HT</span>
          <span className="font-mono">{devis.totalHT.toLocaleString("fr-FR")}</span>
        </div>
        <div className="flex justify-between">
          <span>TVA ({devis.tvaRate}%)</span>
          <span className="font-mono">{devis.tva.toLocaleString("fr-FR")}</span>
        </div>
        <div className="flex justify-between font-bold text-zinc-900">
          <span>Total TTC</span>
          <span className="font-mono text-emerald-700">{devis.totalTTC.toLocaleString("fr-FR")}</span>
        </div>
      </div>
      {devis.delay && <p className="text-sm text-zinc-600">Délai : {devis.delay}</p>}
      {devis.notes && <p className="text-sm text-zinc-600">Notes : {devis.notes}</p>}
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
      setFeedback("Devis validé — vous pouvez générer le contrat.");
      onValidated?.();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.error ?? "Échec de la validation.");
    }
  }

  return (
    <div className="card">
      <button onClick={validate} disabled={pending} className="btn btn-primary">
        {pending ? "Validation..." : "Valider le devis"}
      </button>
      {feedback && <p className="mt-2 text-sm text-emerald-700">{feedback}</p>}
    </div>
  );
}

function Revisions({ revisions }: { revisions: DevisProposalPayload["revisions"] }) {
  if (!revisions?.length) return null;
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Historique des révisions</span>
      </div>
      <div className="space-y-3">
        {revisions.map((rev) => (
          <div key={rev.id} className="rounded-lg border border-zinc-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">
                Round {rev.roundNumber} — {authorDisplayName(rev.author)}
              </span>
              <span className="text-xs text-zinc-400">
                {new Date(rev.createdAt).toLocaleDateString("fr-FR")}
              </span>
            </div>
            {rev.comment && <p className="mt-1 text-sm text-zinc-600">{rev.comment}</p>}
            <p className="mt-1 font-mono text-sm">
              Total TTC : {rev.devisData.totalTTC.toLocaleString("fr-FR")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
