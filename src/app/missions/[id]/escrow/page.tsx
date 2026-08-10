"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Mission = { id: string; titre: string; budget: number; currency: string; status: string; isOwner: boolean };
type Jalon = { id: string; ordre: number; titre: string; montant: number; status: string; revisionCount: number; rejectionReason: string | null };

const JALON_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: "En attente de financement", color: "var(--muted)" },
  fonds_sous_sequestre: { label: "Fonds sous séquestre", color: "var(--primary)" },
  livrable_soumis: { label: "Livrable soumis — à vérifier", color: "var(--warning, #b45309)" },
  valide: { label: "Validé — libération en cours", color: "var(--secondary)" },
  rejete: { label: "Rejeté — en attente de resoumission", color: "var(--danger)" },
  libere: { label: "Payé", color: "var(--secondary)" },
};

// Reprend public/flexwork-ui/payment-escrow.html — instruction HOLD au PSP (US-501), puis
// RELEASE une fois le livrable soumis (US-504). La plateforme ne détient jamais les fonds :
// c'est une instruction transmise, jamais un mouvement de solde interne.
// Paiement fractionné (2026-08-06) : si le contrat a des jalons, cette page pilote chaque
// jalon indépendamment (financer / vérifier / rejeter) au lieu du HOLD/RELEASE unique.
export default function EscrowPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const router = useRouter();
  const [mission, setMission] = useState<Mission | null>(null);
  const [jalons, setJalons] = useState<Jalon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function reload() {
    fetch(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then(setMission);
    fetch(`/api/missions/${missionId}/jalons`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setJalons(d.items));
  }

  useEffect(reload, [missionId]);

  async function handleHold(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting("whole");
    const res = await fetch(`/api/missions/${missionId}/escrow/hold`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "psp_not_enabled"
          ? "Le montage PSP n'est pas encore activé pour cette zone (prérequis juridique en cours de validation)."
          : data.error === "effective_insurance_required"
            ? "Une assurance effective est requise avant de démarrer cette mission à risque élevé."
            : "Échec de la mise sous séquestre."
      );
      return;
    }
    router.push("/dashboard/client");
  }

  async function handleRelease() {
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/escrow/release`, { method: "POST" });
    if (!res.ok) {
      setError("Échec de la libération des fonds — vérifiez qu'un livrable a été soumis.");
      return;
    }
    router.push("/dashboard/client");
  }

  async function holdJalon(jalonId: string) {
    setError(null);
    setSubmitting(jalonId);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/hold`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "psp_not_enabled"
          ? "Le montage PSP n'est pas encore activé pour cette zone."
          : data.error === "effective_insurance_required"
            ? "Une assurance effective est requise avant de démarrer cette mission à risque élevé."
            : "Échec de la mise sous séquestre de ce jalon."
      );
      return;
    }
    reload();
  }

  async function validateJalon(jalonId: string) {
    setError(null);
    setSubmitting(jalonId);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/validate`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      setError("Échec de la validation — vérifiez qu'un livrable a été soumis pour ce jalon.");
      return;
    }
    reload();
  }

  async function rejectJalon(jalonId: string) {
    if (!rejectReason.trim()) {
      setError("Le motif du rejet est obligatoire.");
      return;
    }
    setError(null);
    setSubmitting(jalonId);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectionReason: rejectReason }),
    });
    setSubmitting(null);
    if (!res.ok) {
      setError("Échec du rejet.");
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    reload();
  }

  if (!mission || jalons === null) return <div className="container">Chargement...</div>;

  const usesJalons = jalons.length > 0;

  return (
    <div className="container" style={{ maxWidth: 620 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Paiement sous séquestre</span>
          <span className="badge badge-info">Phase 5{usesJalons ? " — paiement par jalons" : ""}</span>
        </div>

        <div className="alert alert-info">
          <strong>Flexwork ne détient jamais les fonds.</strong> Votre paiement est séquestré chez notre prestataire
          de paiement agréé. Les fonds ne seront libérés au prestataire que sur validation de la livraison{usesJalons ? ", jalon par jalon" : " ou acceptation tacite après 7 jours"}.
        </div>

        <div style={{ background: "var(--light)", padding: 16, borderRadius: 8, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Mission</span><strong>{mission.titre}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem" }}>
            <span>Total</span><strong style={{ color: "var(--primary)" }}>{mission.budget.toLocaleString("fr-FR")} {mission.currency}</strong>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {!usesJalons && mission.status === "contrat_signe" && mission.isOwner && (
          <form onSubmit={handleHold}>
            <div className="alert alert-warning" style={{ fontSize: "0.85rem" }}>
              En validant, vous autorisez le PSP agréé à mettre sous séquestre le montant indiqué. Flexwork
              n&apos;apparaît pas comme bénéficiaire de ce paiement.
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting === "whole"}>
              {submitting === "whole" ? "Envoi..." : "Payer et séquestrer les fonds"}
            </button>
          </form>
        )}

        {!usesJalons && mission.status === "livrable_soumis" && mission.isOwner && (
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleRelease}>
            Valider le livrable et libérer les fonds
          </button>
        )}

        {!usesJalons && !mission.isOwner && <p style={{ color: "var(--muted)" }}>Seul le client peut déclencher les mouvements d&apos;escrow.</p>}
      </div>

      {usesJalons && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          {jalons.map((j) => {
            const st = JALON_STATUS[j.status] ?? { label: j.status, color: "var(--muted)" };
            return (
              <div key={j.id} className="card" style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>Jalon {j.ordre} — {j.titre}</strong>
                    <div style={{ fontSize: "0.85rem", color: st.color, marginTop: 2 }}>{st.label}</div>
                    {j.status === "rejete" && j.rejectionReason && (
                      <div style={{ fontSize: "0.8rem", color: "var(--danger)", marginTop: 2 }}>
                        Motif du rejet (révision n°{j.revisionCount}) : {j.rejectionReason}
                      </div>
                    )}
                  </div>
                  <strong style={{ color: "var(--primary)" }}>{j.montant.toLocaleString("fr-FR")} {mission.currency}</strong>
                </div>

                {mission.isOwner && j.status === "en_attente" && (
                  <button className="btn btn-primary" style={{ width: "100%", marginTop: 10 }} disabled={submitting === j.id} onClick={() => holdJalon(j.id)}>
                    {submitting === j.id ? "Envoi..." : "Financer ce jalon"}
                  </button>
                )}

                {mission.isOwner && j.status === "livrable_soumis" && rejectingId !== j.id && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={submitting === j.id} onClick={() => validateJalon(j.id)}>
                      Vérifier et libérer
                    </button>
                    <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setRejectingId(j.id); setRejectReason(""); }}>
                      Révision
                    </button>
                  </div>
                )}

                {mission.isOwner && rejectingId === j.id && (
                  <div style={{ marginTop: 10 }}>
                    <textarea
                      className="form-control"
                      placeholder="Motif du rejet (obligatoire)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      style={{ width: "100%", minHeight: 60, marginBottom: 8 }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-danger" style={{ flex: 1 }} disabled={submitting === j.id} onClick={() => rejectJalon(j.id)}>
                        Confirmer le rejet
                      </button>
                      <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRejectingId(null)}>Annuler</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
