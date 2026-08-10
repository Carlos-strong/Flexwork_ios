"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Proposal = {
  id: string;
  montant: number;
  message: string | null;
  createdAt: string;
  provider: { id: string; email: string };
};

// Gestion des propositions reçues — réservé au client propriétaire de la mission.
// Permet d'accepter une proposition (ce qui génère le contrat).
export default function ProposalsPage() {
  const params = useParams();
  const missionId = params.id as string;

  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/proposals`);
    if (res.ok) setProposals((await res.json()).items);
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
                <strong style={{ fontSize: "1.1rem" }}>
                  {p.montant.toLocaleString("fr-FR")} XOF
                </strong>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 4 }}>
                  {p.provider.email}
                </p>
                {p.message && (
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
                <button
                  className="btn btn-primary"
                  style={{ padding: "6px 14px", fontSize: "0.85rem" }}
                  onClick={() => acceptProposal(p.id, p.provider.id)}
                >
                  Accepter
                </button>
              </div>
            </div>
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
