"use client";

import { useState } from "react";
import Link from "next/link";

// US-802 — Signalement d'une déclaration ou d'un profil suspect.
// Alimente la file de travail de l'Admin Modération (US-306).
// Un signalement ouvre une revue, il ne déclenche pas d'action punitive automatique.
export default function SignalementPage() {
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetId: targetId || undefined,
        reason,
      }),
    });

    setSubmitting(false);
    if (res.ok) {
      setSuccess(true);
    } else {
      setError("Échec de l'envoi du signalement. Réessayez.");
    }
  }

  if (success) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: 16 }}>📩</div>
          <h1 style={{ color: "var(--secondary)", marginBottom: 10 }}>
            Signalement envoyé
          </h1>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>
            Votre signalement a été transmis à l&apos;équipe de modération. Il sera examiné
            dans les meilleurs délais. Aucune action automatique n&apos;est déclenchée.
          </p>
          <Link href="/" className="btn btn-primary">
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Signaler un contenu</span>
        </div>

        <div className="info-box">
          <strong>Important :</strong> un signalement ouvre une revue manuelle par l&apos;Admin
          Modération. Il ne déclenche <strong>aucune action automatique</strong> (suppression,
          suspension). Chaque signalement est traité individuellement avec justification
          obligatoire (US-306).
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Type de contenu signalé <span className="required">*</span></label>
            <select
              required
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
            >
              <option value="">-- Choisir --</option>
              <option value="declaration">Déclaration (assurance / qualification)</option>
              <option value="profile">Profil prestataire</option>
              <option value="mission">Mission</option>
              <option value="review">Avis</option>
            </select>
          </div>

          <div className="form-group">
            <label>Identifiant du contenu</label>
            <input
              type="text"
              placeholder="ID de la déclaration, du profil ou de la mission"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
            <p className="help-text">
              Optionnel — si vous ne connaissez pas l&apos;identifiant, décrivez le contenu
              dans le motif.
            </p>
          </div>

          <div className="form-group">
            <label>Motif du signalement <span className="required">*</span></label>
            <textarea
              rows={4}
              required
              minLength={10}
              placeholder="Décrivez précisément pourquoi ce contenu vous semble frauduleux ou inapproprié..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-danger"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={submitting}
          >
            {submitting ? "Envoi..." : "Envoyer le signalement"}
          </button>
        </form>
      </div>

      <div className="card" style={{ background: "#fef2f2", marginTop: 16 }}>
        <strong style={{ color: "#991b1b" }}>⚠️ Usage abusif</strong>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 6 }}>
          Les signalements abusifs ou répétés sans fondement sont tracés et peuvent entraîner
          des restrictions sur votre compte. Utilisez cette fonction de façon responsable.
        </p>
      </div>
    </div>
  );
}
