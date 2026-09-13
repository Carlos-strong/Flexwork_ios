"use client";

import { useEffect, useState } from "react";

type ViewerDoc = {
  id: string;
  type: string;
  fileName: string;
  size: number | null;
  status: string;
  rejectionReason: string | null;
  url: string;
};

const DOC_LABEL: Record<string, string> = {
  piece_identite_recto: "Pièce d'identité — Recto",
  piece_identite_verso: "Pièce d'identité — Verso",
  selfie: "Selfie",
  selfie_avec_piece: "Selfie avec pièce",
};

function isImage(name: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
}

// Visualiseur/lecteur des documents KYC d'un compte (côté admin). Charge les documents via
// /api/admin/kyc/[userId]/documents (URL signées, 5 min), affiche une vignette par document
// (image ou PDF) et permet d'ouvrir un plein écran (lightbox) pour lire le document : image
// agrandie ou PDF embarqué (iframe), avec bouton de téléchargement.
export function KycDocsViewer({
  userId,
  email,
  onClose,
  onDecide,
}: {
  userId: string;
  email: string;
  onClose: () => void;
  /** Appelé après une décision (validation/rejet) pour que la page parente rafraîchisse sa file. */
  onDecide?: () => void;
}) {
  const [docs, setDocs] = useState<ViewerDoc[] | null>(null);
  const [lightbox, setLightbox] = useState<ViewerDoc | null>(null);
  // Un seul champ par document — auparavant "Justification" et "Motif de rejet" étaient
  // deux inputs distincts, redondants dans la quasi-totalité des cas (on retape la même
  // idée deux fois). Ce texte sert à la fois de `justification` (exigée par le serveur
  // pour toute décision, validation comprise) et de `rejectionReason` (visible par
  // l'utilisateur) quand la décision est un rejet.
  const [docInputs, setDocInputs] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Document dont le motif est manquant — mis en surbrillance rouge.
  const [missingFieldDocId, setMissingFieldDocId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/kyc/${userId}/documents`)
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d) => setDocs(d.documents))
      .catch(() => setDocs([]));
  }, [userId]);

  async function decideDoc(docId: string, status: "verifie" | "rejete") {
    const reason = (docInputs[docId] ?? "").trim();
    // Le motif n'est obligatoire que pour un rejet — valider un document conforme n'a pas
    // besoin d'être justifié.
    if (status === "rejete" && !reason) {
      setMissingFieldDocId(docId);
      setFeedback("⚠️ Motif de rejet obligatoire : saisissez-le dans le champ, puis cliquez à nouveau.");
      return;
    }
    setMissingFieldDocId(null);
    setFeedback(null);
    setDecidingId(docId);
    try {
      const res = await fetch(`/api/admin/kyc/${userId}/documents/${docId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejete" ? reason : undefined,
          justification: reason,
        }),
      });
      setDecidingId(null);
      if (res.ok) {
        setFeedback(`✅ Document ${status === "verifie" ? "validé" : "rejeté"} et journalisé.`);
        setDocInputs((prev) => ({ ...prev, [docId]: "" }));
        const r2 = await fetch(`/api/admin/kyc/${userId}/documents`);
        if (r2.ok) setDocs((await r2.json()).documents);
        onDecide?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback(data.error === "kyc_rate_limit_exceeded" ? "Quota de 30 validations/heure atteint." : `Échec de la décision du document (${res.status}).`);
      }
    } catch {
      setDecidingId(null);
      setFeedback("Erreur réseau lors de la décision.");
    }
  }

  return (
    <>
      {/* Modal de liste des documents */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(10,25,49,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ background: "#fff", borderRadius: 16, maxWidth: 880, width: "100%", maxHeight: "92vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#0A1931" }}>Documents KYC — {email}</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Cliquez sur un document pour l&apos;ouvrir en plein écran (image ou PDF).
              </p>
            </div>
            <button onClick={onClose} style={{ border: "none", background: "#f3f4f6", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer", color: "#374151" }}>✕</button>
          </div>

          {feedback && (
            <div style={{ padding: "8px 12px", borderRadius: 10, marginBottom: 12, fontSize: 12, fontWeight: 600, background: feedback.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: feedback.startsWith("✅") ? "#166534" : "#b91c1c", border: feedback.startsWith("✅") ? "1px solid #bbf7d0" : "1px solid #fecaca" }}>{feedback}</div>
          )}

          {docs === null ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>Chargement des documents…</p>
          ) : docs.length === 0 ? (
            <p style={{ fontSize: 13, color: "#6b7280" }}>Aucun document déposé pour ce compte.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
              {docs.map((d) => {
                const input = docInputs[d.id] ?? "";
                const isVerified = d.status === "verifie";
                const isRejected = d.status === "rejete";
                const badgeStyle = {
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  color: isVerified ? "#166534" : isRejected ? "#b91c1c" : "#854D0E",
                  background: isVerified ? "#dcfce7" : isRejected ? "#fee2e2" : "#fef9c3",
                } as const;
                return (
                  <div key={d.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" }}>
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{DOC_LABEL[d.type] ?? d.type}</span>
                      <span style={badgeStyle}>{isVerified ? "Validé" : isRejected ? "Rejeté" : "En attente"}</span>
                    </div>
                    <div onClick={() => setLightbox(d)} style={{ padding: 10, background: "#fafafa", minHeight: 110, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Ouvrir en plein écran">
                      {isImage(d.fileName) ? (
                        <img src={d.url} alt={d.fileName} style={{ maxWidth: "100%", maxHeight: 130, borderRadius: 8, objectFit: "contain" }} />
                      ) : (
                        <span style={{ fontSize: 26 }}>📄</span>
                      )}
                    </div>
                    <div onClick={() => setLightbox(d)} style={{ padding: "6px 12px", borderTop: "1px solid #f3f4f6", fontSize: 11, color: "#008751", fontWeight: 600, cursor: "pointer" }}>
                      Ouvrir en plein écran →
                    </div>
                    {!isVerified && (
                      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #f3f4f6" }}>
                        <input
                          type="text"
                          placeholder="Motif de rejet (obligatoire seulement pour rejeter)"
                          value={input}
                          onChange={(e) => { setMissingFieldDocId(null); setDocInputs((prev) => ({ ...prev, [d.id]: e.target.value })); }}
                          style={{ height: 32, padding: "0 10px", borderRadius: 8, border: missingFieldDocId === d.id ? "2px solid #dc2626" : "1px solid #e5e7eb", fontSize: 12 }}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" disabled={decidingId === d.id} onClick={() => decideDoc(d.id, "verifie")}
                            style={{ flex: 1, padding: "7px 0", borderRadius: 999, border: "none", background: "#008751", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {decidingId === d.id ? "…" : "Valider"}
                          </button>
                          <button type="button" disabled={decidingId === d.id} onClick={() => decideDoc(d.id, "rejete")}
                            style={{ flex: 1, padding: "7px 0", borderRadius: 999, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {decidingId === d.id ? "…" : "Rejeter"}
                          </button>
                        </div>
                        {d.rejectionReason && <small style={{ fontSize: 11, color: "#dc2626" }}>Motif précédent : {d.rejectionReason}</small>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox plein écran (visualiseur/lecteur) */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 24, flexDirection: "column" }}
        >
          <div style={{ position: "absolute", top: 16, right: 20, display: "flex", gap: 10, alignItems: "center" }}>
            <a
              href={lightbox.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#fff", fontSize: 13, border: "1px solid rgba(255,255,255,.4)", padding: "6px 14px", borderRadius: 999, textDecoration: "none" }}
            >
              Télécharger
            </a>
            <button onClick={() => setLightbox(null)} style={{ border: "none", background: "rgba(255,255,255,.15)", color: "#fff", borderRadius: 8, width: 36, height: 36, fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ marginBottom: 12, color: "#fff", fontSize: 13, textAlign: "center" }}>{DOC_LABEL[lightbox.type] ?? lightbox.type} — {lightbox.fileName}</div>
          {isImage(lightbox.fileName) ? (
            <img src={lightbox.url} alt={lightbox.fileName} style={{ maxWidth: "100%", maxHeight: "82vh", objectFit: "contain", borderRadius: 8 }} />
          ) : (
            <iframe src={lightbox.url} title={lightbox.fileName} style={{ width: "100%", maxWidth: 900, height: "80vh", border: "none", borderRadius: 8, background: "#fff" }} />
          )}
        </div>
      )}
    </>
  );
}
