"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin-nav";

// Médiation — aligné sur formulaires-flexwork-tous-profils.html.
// L'admin propose, ne tranche jamais. Double validation pour les rejets.
export default function AdminMediationPage() {
  const [mediationId, setMediationId] = useState("");
  const [resolution, setResolution] = useState("");
  const [justification, setJustification] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/mediations/${mediationId}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposedResolution: resolution, justification }),
    });
    if (res.ok) {
      setFeedback("Proposition envoyée aux deux parties — en attente de leur acceptation ou refus.");
    } else {
      setFeedback("Échec de l'envoi — vérifiez l'identifiant de la médiation.");
    }
  }

  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Admin Médiation</h1>

        <div className="warn-box">
          <strong>Vous proposez, vous ne tranchez pas.</strong> Ne jamais libérer ou bloquer de fonds unilatéralement.
          Toute proposition doit être soumise à l&apos;acceptation des deux parties.
        </div>

        {feedback && <div className="alert alert-info">{feedback}</div>}

        <div className="card">
          <div className="card-header"><span className="card-title">Proposer une résolution</span></div>
          <form onSubmit={handlePropose}>
            <div className="form-group">
              <label>Identifiant de la médiation</label>
              <input type="text" required value={mediationId} onChange={(e) => setMediationId(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Proposition de résolution</label>
              <textarea rows={4} required minLength={5} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Justification (obligatoire)</label>
              <input type="text" required value={justification} onChange={(e) => setJustification(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary">Soumettre la proposition aux deux parties</button>
          </form>
        </div>
      </div>
    </div>
  );
}
