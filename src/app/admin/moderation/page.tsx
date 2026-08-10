"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin-nav";

// Modération — aligné sur formulaires-flexwork-tous-profils.html.
// Retrait de déclaration sur signalement, justification obligatoire,
// journalisé dans admin_audit_log (append-only, hash chaîné SHA-256).
export default function AdminModerationPage() {
  const [declarationId, setDeclarationId] = useState("");
  const [justification, setJustification] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleRemove(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/declarations/${declarationId}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    if (res.ok) {
      setFeedback("Déclaration retirée et journalisée dans admin_audit_log.");
      setDeclarationId("");
      setJustification("");
    } else {
      setFeedback("Échec du retrait — vérifiez l'identifiant de la déclaration.");
    }
  }

  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Admin Modération</h1>

        <div className="info-box">
          <strong>Action sur signalement uniquement.</strong> Pas de vérification systématique. Chaque retrait est
          journalisé avec justification dans <code>admin_audit_log</code> (append-only, hash chaîné SHA-256).
        </div>

        {feedback && <div className="alert alert-warning">{feedback}</div>}

        <div className="card">
          <div className="card-header"><span className="card-title">Retirer une déclaration signalée</span></div>
          <form onSubmit={handleRemove}>
            <div className="form-group">
              <label>Identifiant de la déclaration</label>
              <input type="text" required value={declarationId} onChange={(e) => setDeclarationId(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Justification (obligatoire)</label>
              <textarea rows={3} required value={justification} onChange={(e) => setJustification(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-danger">Retirer la déclaration</button>
          </form>
        </div>
      </div>
    </div>
  );
}
