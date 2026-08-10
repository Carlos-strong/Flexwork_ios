"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Jalon = { id: string; ordre: number; titre: string; montant: number; status: string; revisionCount: number; rejectionReason: string | null };

const JALON_STATUS_LABEL: Record<string, string> = {
  en_attente: "En attente de financement",
  fonds_sous_sequestre: "Financé — prêt pour le livrable",
  livrable_soumis: "Livrable soumis, en attente du client",
  valide: "Validé — libération en cours",
  rejete: "Rejeté — à resoumettre",
  libere: "Payé",
};

// Soumission de livrable — réservé au prestataire. Si le contrat a des jalons (paiement
// fractionné, 2026-08-06), la soumission se fait jalon par jalon ; sinon comportement
// historique inchangé (un seul livrable pour toute la mission).
export default function DeliverablePage() {
  const params = useParams();
  const missionId = params.id as string;

  const [jalons, setJalons] = useState<Jalon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null); // "whole" ou l'id du jalon en cours d'envoi

  useEffect(() => {
    fetch(`/api/missions/${missionId}/jalons`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setJalons(d.items))
      .catch(() => setJalons([]));
  }, [missionId]);

  async function submitWhole(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file") as File;
    if (!file || file.size === 0) {
      setError("Sélectionnez un fichier à envoyer.");
      return;
    }
    setSubmitting("whole");
    const res = await fetch(`/api/missions/${missionId}/deliverable`, { method: "POST", body: formData });
    setSubmitting(null);
    if (res.ok) {
      setSuccess(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "mission_not_ready" ? "La mission n'est pas prête pour la soumission du livrable." : "Échec de l'envoi du livrable.");
    }
  }

  async function submitJalon(jalonId: string, file: File) {
    setError(null);
    setSubmitting(jalonId);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/deliverable`, { method: "POST", body: formData });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "jalon_not_ready" ? "Ce jalon n'est pas encore financé ou son livrable est déjà soumis." : "Échec de l'envoi du livrable.");
      return;
    }
    const listRes = await fetch(`/api/missions/${missionId}/jalons`);
    if (listRes.ok) setJalons((await listRes.json()).items);
  }

  if (success) {
    return (
      <div className="container" style={{ maxWidth: 560 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: 16 }}>✅</div>
          <h1 style={{ color: "var(--secondary)", marginBottom: 10 }}>Livrable soumis avec succès !</h1>
          <p style={{ color: "var(--muted)", marginBottom: 20 }}>
            Le client va être notifié. La mission passe en statut &quot;Livrable soumis&quot;.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Link href={`/missions/${missionId}`} className="btn btn-primary">Voir la mission</Link>
            <Link href="/missions" className="btn btn-outline">Toutes les missions</Link>
          </div>
        </div>
      </div>
    );
  }

  if (jalons === null) return <div className="container">Chargement...</div>;

  // ── Contrat à jalons : un formulaire d'envoi par jalon éligible ──
  if (jalons.length > 0) {
    return (
      <div className="container" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Soumettre les livrables — paiement par jalons</span></div>
          {error && <div className="alert alert-danger">{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jalons.map((j) => {
              const canSubmit = j.status === "fonds_sous_sequestre" || j.status === "rejete";
              return (
                <div key={j.id} style={{ border: "1px solid var(--border, #eee)", borderRadius: 8, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>Jalon {j.ordre} — {j.titre}</strong>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{j.montant.toLocaleString("fr-FR")} XOF</span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 4 }}>
                    {JALON_STATUS_LABEL[j.status] ?? j.status}
                    {j.status === "rejete" && j.rejectionReason && (
                      <span style={{ color: "var(--danger)" }}> — motif : {j.rejectionReason} (révision n°{j.revisionCount})</span>
                    )}
                  </div>
                  {canSubmit && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        type="file"
                        accept=".pdf,.zip,.jpg,.jpeg,.png,.doc,.docx"
                        disabled={submitting === j.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) submitJalon(j.id, file);
                        }}
                      />
                      {submitting === j.id && <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}> Envoi...</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Link href={`/missions/${missionId}`} style={{ color: "var(--muted)", fontSize: "0.85rem" }}>← Retour au détail de la mission</Link>
        </div>
      </div>
    );
  }

  // ── Comportement historique : un seul livrable pour toute la mission ──
  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Soumettre le livrable</span>
        </div>

        <div className="info-box">
          <strong>Important :</strong> la soumission du livrable fait passer la mission en
          statut &quot;Livrable soumis&quot;. Le client pourra alors valider et libérer le
          paiement.
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={submitWhole}>
          <div className="form-group">
            <label>Fichier du livrable <span className="required">*</span></label>
            <div className="file-input-wrapper">
              <div className="file-trigger">
                + Déposer le fichier (PDF, ZIP, JPG, PNG — max 20 Mo)
              </div>
              <input
                type="file"
                name="file"
                accept=".pdf,.zip,.jpg,.jpeg,.png,.doc,.docx"
                required
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              />
            </div>
            <p className="help-text">Formats acceptés : PDF, ZIP, JPG, PNG, DOC/DOCX. Taille max : 20 Mo.</p>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting === "whole"}>
            {submitting === "whole" ? "Envoi..." : "Soumettre le livrable"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 10 }}>
        <Link href={`/missions/${missionId}`} style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
