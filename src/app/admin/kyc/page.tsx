"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";

type KycDoc = { id: string; type: string; status: string };
type QueueItem = { userId: string; email: string; tel: string; createdAt: string; documents: KycDoc[] };

const DOC_LABEL: Record<string, string> = {
  piece_identite_recto: "Recto",
  piece_identite_verso: "Verso",
  selfie: "Selfie",
  selfie_avec_piece: "Selfie+pièce",
};

// Validation KYC — aligné sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : 5 rôles admin séparés, double validation pour les rejets,
// quota 30 validations/heure, justification obligatoire.
export default function AdminKycPage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/kyc/queue");
    if (res.ok) setQueue((await res.json()).items);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(userId: string, status: "verifie" | "rejete") {
    const justification = justifications[userId];
    if (!justification) {
      setFeedback("Justification obligatoire avant toute décision.");
      return;
    }
    setFeedback(null);
    const res = await fetch(`/api/admin/kyc/${userId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        rejectionReason: status === "rejete" ? justification : undefined,
        justification,
        dateNaissance: dates[userId] || undefined,
      }),
    });
    if (res.ok) {
      setFeedback(`Décision ${status.toUpperCase()} enregistrée et journalisée.`);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(data.error === "kyc_rate_limit_exceeded" ? "Quota de 30 validations/heure atteint." : "Échec de la décision.");
    }
  }

  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Admin KYC — Validation d&apos;identité</h1>

        <div className="info-box">
          <strong>Seule vérification effective de Flexwork.</strong> Max 30 validations/heure. Justification
          obligatoire à chaque décision. La date de naissance saisie ici est la seule donnée d&apos;âge faisant foi (A13).
          Les rejets requièrent une <strong>double validation</strong>.
        </div>

        {feedback && <div className="alert alert-warning">{feedback}</div>}

        <div className="card">
          <div className="card-header"><span className="card-title">Dossiers en attente ({queue?.length ?? "…"})</span></div>
          <table>
            <thead>
              <tr><th>Utilisateur</th><th>Documents</th><th>Date de naissance (lue sur pièce)</th><th>Justification</th><th>Décision</th></tr>
            </thead>
            <tbody>
              {queue?.map((item) => (
                <tr key={item.userId}>
                  <td>{item.email}<br /><small>{item.tel}</small></td>
                  <td>{item.documents.map((d) => DOC_LABEL[d.type] ?? d.type).join(" · ")}</td>
                  <td>
                    <input
                      type="date"
                      value={dates[item.userId] ?? ""}
                      onChange={(e) => setDates((prev) => ({ ...prev, [item.userId]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="Justification"
                      style={{ minWidth: 160 }}
                      value={justifications[item.userId] ?? ""}
                      onChange={(e) => setJustifications((prev) => ({ ...prev, [item.userId]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button className="btn btn-sm btn-secondary" style={{ padding: "4px 10px", fontSize: "0.8rem" }} onClick={() => decide(item.userId, "verifie")}>
                      Valider
                    </button>{" "}
                    <button className="btn btn-sm btn-outline" style={{ padding: "4px 10px", fontSize: "0.8rem" }} onClick={() => decide(item.userId, "rejete")}>
                      Rejeter
                    </button>
                  </td>
                </tr>
              ))}
              {queue?.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Aucun dossier en attente.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
