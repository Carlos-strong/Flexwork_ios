"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";

type RiskEntry = { id: string; domain: string; country: string; riskLevel: string; insuranceRequired: boolean; amountThreshold: number | null };
type AgeEntry = { id: string; country: string; profileType: string; domain: string | null; minimumAge: number };

const RISK_BADGE: Record<string, string> = { low: "badge-verified", medium: "badge-declared", high: "badge-unverified" };

// Gestion des paliers de risque + seuils d'âge — aligné sur
// formulaires-flexwork-tous-profils.html, onglet Administration.
export default function AdminRiskPage() {
  const [risks, setRisks] = useState<RiskEntry[]>([]);
  const [ages, setAges] = useState<AgeEntry[]>([]);
  const [riskLevel, setRiskLevel] = useState("low");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadRisks() {
    const res = await fetch("/api/admin/domain-risk");
    if (res.ok) setRisks((await res.json()).items);
  }
  async function loadAges() {
    const res = await fetch("/api/admin/country-age-requirements");
    if (res.ok) setAges((await res.json()).items);
  }

  useEffect(() => {
    loadRisks();
    loadAges();
  }, []);

  async function submitRisk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/domain-risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: form.get("domain"),
        country: form.get("country"),
        riskLevel: form.get("riskLevel"),
        amountThreshold: form.get("amountThreshold") ? Number(form.get("amountThreshold")) : undefined,
        justification: form.get("justification") || undefined,
      }),
    });
    if (res.ok) {
      setFeedback("Palier enregistré.");
      loadRisks();
      e.currentTarget.reset();
    } else {
      setFeedback("Échec de l'enregistrement.");
    }
  }

  async function submitAge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/country-age-requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        country: form.get("country"),
        profileType: form.get("profileType"),
        domain: form.get("domain") || undefined,
        minimumAge: Number(form.get("minimumAge")),
        justification: form.get("justification"),
      }),
    });
    if (res.ok) {
      setFeedback("Seuil d'âge enregistré.");
      loadAges();
      e.currentTarget.reset();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(data.error === "minimum_age_below_legal_floor" ? "Refusé : le seuil ne peut jamais descendre sous 18 ans." : "Échec de l'enregistrement.");
    }
  }

  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Gestion des paliers de risque</h1>

        <div className="info-box">
          <strong>Exception assumée du modèle.</strong> Sur le risque élevé, l&apos;assurance effective est bloquante
          sans fenêtre de tolérance. <code>insurance_required</code> est automatiquement <code>true</code> pour
          <code> risk_level = HIGH</code> — non configurable à <code>false</code>.
        </div>

        {feedback && <div className="alert alert-info">{feedback}</div>}

        <div className="card">
          <div className="card-header"><span className="card-title">domain_risk_levels</span></div>
          <table>
            <thead>
              <tr><th>Domaine</th><th>Pays</th><th>Palier</th><th>Assurance obligatoire</th><th>Seuil avertissement</th></tr>
            </thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.id}>
                  <td>{r.domain}</td>
                  <td>{r.country}</td>
                  <td><span className={`badge ${RISK_BADGE[r.riskLevel]}`}>{r.riskLevel.toUpperCase()}</span></td>
                  <td>{r.insuranceRequired ? "✓ Oui (bloquant)" : "Non (déclaratif)"}</td>
                  <td>{r.amountThreshold ? `${r.amountThreshold.toLocaleString("fr-FR")} XOF` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Ajouter / Modifier un domaine</span></div>
          <form onSubmit={submitRisk}>
            <div className="grid-2">
              <div className="form-group"><label>Domaine</label><input type="text" name="domain" required placeholder="Nom du domaine" /></div>
              <div className="form-group">
                <label>Pays</label>
                <select name="country" defaultValue="BJ">
                  <option value="BJ">BJ</option><option value="CI">CI</option><option value="SN">SN</option><option value="TG">TG</option>
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Palier de risque</label>
                <select name="riskLevel" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              </div>
              <div className="form-group">
                <label>Seuil avertissement (XOF) — Moyen uniquement</label>
                <input type="number" name="amountThreshold" placeholder="100000" />
              </div>
            </div>
            <div className="form-group">
              <label>Justification</label>
              <input type="text" name="justification" />
            </div>
            {riskLevel === "high" && (
              <div className="warn-box">
                Palier HIGH : <code>insurance_required</code> sera automatiquement fixé à <code>true</code> et
                verrouillé. Aucune dérogation possible.
              </div>
            )}
            <button type="submit" className="btn btn-primary">Enregistrer</button>
          </form>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">country_age_requirements (A13)</span></div>
          <table>
            <thead>
              <tr><th>Pays</th><th>Filière</th><th>Domaine</th><th>Âge minimum</th></tr>
            </thead>
            <tbody>
              {ages.map((a) => (
                <tr key={a.id}>
                  <td>{a.country}</td>
                  <td>{a.profileType}</td>
                  <td>{a.domain ?? "—"}</td>
                  <td>{a.minimumAge} ans</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Ajouter / Modifier un seuil d&apos;âge</span></div>
          <form onSubmit={submitAge}>
            <div className="grid-2">
              <div className="form-group">
                <label>Pays</label>
                <select name="country" defaultValue="BJ">
                  <option value="BJ">BJ</option><option value="CI">CI</option><option value="SN">SN</option><option value="TG">TG</option>
                </select>
              </div>
              <div className="form-group">
                <label>Filière chantier</label>
                <select name="profileType" defaultValue="manoeuvre">
                  <option value="manoeuvre">Manœuvre</option>
                  <option value="artisan">Artisan</option>
                  <option value="expert_btp_autres">Expert BTP / Autres</option>
                </select>
              </div>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>Domaine (optionnel — ex. conduite d&apos;engins)</label><input type="text" name="domain" /></div>
              <div className="form-group"><label>Âge minimum (18 ans plancher légal)</label><input type="number" name="minimumAge" min={18} required defaultValue={18} /></div>
            </div>
            <div className="form-group">
              <label>Justification (obligatoire)</label>
              <input type="text" name="justification" required />
            </div>
            <button type="submit" className="btn btn-primary">Enregistrer</button>
          </form>
        </div>
      </div>
    </div>
  );
}
