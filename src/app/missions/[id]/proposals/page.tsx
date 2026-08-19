"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DevisDetails, ValidateDevis } from "@/components/devis/devis-panel";
import type { DevisProposalPayload } from "@/components/devis/types";

type MissionMeta = { budgetType: string | null; maxRevisionRounds: number };

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  envoyee: "Candidature envoyée",
  preselectionnee: "Présélectionné",
  en_negociation: "En négociation",
  devis_valide: "Devis validé",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee_definitive: "Annulée",
};

// Gestion des propositions reçues — réservé au client propriétaire de la mission.
// Permet d'accepter une proposition (ce qui génère le contrat).
export default function ProposalsPage() {
  const params = useParams();
  const missionId = params.id as string;

  const [proposals, setProposals] = useState<DevisProposalPayload[] | null>(null);
  const [missionMeta, setMissionMeta] = useState<MissionMeta | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isQuote = missionMeta?.budgetType === "QUOTE";

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/proposals`);
    if (res.ok) {
      const d = await res.json();
      setProposals(d.items ?? []);
      setMissionMeta(d.mission ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [missionId]);

  async function acceptProposal(proposalId: string, providerId: string) {
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals/${proposalId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    });
    if (res.ok) {
      setFeedback("Proposition acceptée — le contrat va être généré.");
      load();
    } else {
      setFeedback("Échec de l'acceptation.");
    }
  }

  if (loading) return <div className="container">Chargement...</div>;

  return (
    <div className="container" style={{ maxWidth: 800 }}>
      <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>
        Propositions reçues
      </h1>

      {feedback && <div className="alert alert-info">{feedback}</div>}

      <div className="card">
        <div className="card-header">
          <span className="card-title">
            {proposals?.length ?? 0} proposition{(proposals?.length ?? 0) > 1 ? "s" : ""}
          </span>
        </div>

        {proposals?.length === 0 && (
          <p style={{ color: "var(--muted)" }}>
            Aucune proposition reçue pour cette mission.
          </p>
        )}

        {proposals?.map((p) => (
          <div
            key={p.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              marginBottom: 12,
              background: "#fafafa",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                {isQuote ? (
                  <strong style={{ fontSize: "1.1rem" }}>{p.provider.email}</strong>
                ) : (
                  <strong style={{ fontSize: "1.1rem" }}>
                    {p.montant.toLocaleString("fr-FR")} XOF
                  </strong>
                )}
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                  {isQuote
                    ? `Round ${p.roundActuel}/${missionMeta?.maxRevisionRounds ?? 3} — ${PROPOSAL_STATUS_LABEL[p.status] ?? p.status}`
                    : p.provider.email}
                </p>
                {!isQuote && p.message && (
                  <p style={{ marginTop: 8, fontSize: "0.9rem" }}>{p.message}</p>
                )}
                <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 6 }}>
                  Reçue le {new Date(p.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link
                  href={`/profil/${p.provider.id}`}
                  className="btn btn-outline"
                  style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                >
                  Profil
                </Link>
                {!isQuote && (
                  <button
                    className="btn btn-primary"
                    style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                    onClick={() => acceptProposal(p.id, p.provider.id)}
                  >
                    Accepter
                  </button>
                )}
              </div>
            </div>

            {isQuote && p.devisData && (
              <div style={{ marginTop: 12 }}>
                <DevisDetails devis={p.devisData} />
                {p.status === "en_negociation" && (
                  <div style={{ marginTop: 12 }}>
                    <ValidateDevis missionId={missionId} proposalId={p.id} onValidated={load} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <Link href={`/missions/${missionId}`} style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
