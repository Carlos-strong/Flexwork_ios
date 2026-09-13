"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";

type RiskEntry = { id: string; domain: string; country: string; riskLevel: string; insuranceRequired: boolean; amountThreshold: number | null };
type AgeEntry = { id: string; country: string; profileType: string; domain: string | null; minimumAge: number };

const RISK_BADGE: Record<string, string> = {
  low: "bg-[#DCFCE7] text-[#166534]",
  medium: "bg-[#FEF3C7] text-[#D97706]",
  high: "bg-[#FEE2E2] text-[#B91C1C]",
};

const inputClass = "w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

// Gestion des paliers de risque + seuils d'âge — aligné sur
// formulaires-flexwork-tous-profils.html, onglet Administration.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
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
    // Capturé avant le await : React remet e.currentTarget à null une fois la phase
    // synchrone de l'événement terminée — l'appeler après un await levait
    // "null is not an object" (voir le même correctif sur src/app/profile/page.tsx).
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
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
      formEl.reset();
    } else {
      setFeedback("Échec de l'enregistrement.");
    }
  }

  async function submitAge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    // Idem submitRisk ci-dessus : capturé avant le await.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
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
      formEl.reset();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(data.error === "minimum_age_below_legal_floor" ? "Refusé : le seuil ne peut jamais descendre sous 18 ans." : "Échec de l'enregistrement.");
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[1000px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Gestion des paliers de risque</h1>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
          <strong className="text-[#0f172a]">Exception assumée du modèle.</strong> Sur le risque élevé, l&apos;assurance effective est bloquante
          sans fenêtre de tolérance. <code className="px-1 py-0.5 rounded bg-[#F1F5F9] text-[12px]">insurance_required</code> est automatiquement <code className="px-1 py-0.5 rounded bg-[#F1F5F9] text-[12px]">true</code> pour
          <code className="px-1 py-0.5 rounded bg-[#F1F5F9] text-[12px]"> risk_level = HIGH</code> — non configurable à <code className="px-1 py-0.5 rounded bg-[#F1F5F9] text-[12px]">false</code>.
        </div>

        {feedback && <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{feedback}</div>}

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]"><h3 className="text-[13px] font-semibold font-mono">domain_risk_levels</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Domaine</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Pays</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Palier</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Assurance obligatoire</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Seuil avertissement</th>
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.id} className="border-b border-[#F1F5F9] last:border-0">
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{r.domain}</td>
                    <td className="py-2.5 px-3 text-[#475569]">{r.country}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${RISK_BADGE[r.riskLevel]}`}>{r.riskLevel.toUpperCase()}</span></td>
                    <td className="py-2.5 px-3 text-[#475569]">{r.insuranceRequired ? "✓ Oui (bloquant)" : "Non (déclaratif)"}</td>
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{r.amountThreshold ? `${r.amountThreshold.toLocaleString("fr-FR")} XOF` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Ajouter / Modifier un domaine</h3>
          <form onSubmit={submitRisk} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Domaine</label>
                <input type="text" name="domain" required placeholder="Nom du domaine" className={inputClass} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Pays</label>
                <select name="country" defaultValue="BJ" className={inputClass}>
                  <option value="BJ">BJ</option><option value="CI">CI</option><option value="SN">SN</option><option value="TG">TG</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Palier de risque</label>
                <select name="riskLevel" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className={inputClass}>
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Seuil avertissement (XOF) — Moyen uniquement</label>
                <input type="number" name="amountThreshold" placeholder="100000" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Justification</label>
              <input type="text" name="justification" className={inputClass} />
            </div>
            {riskLevel === "high" && (
              <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E]">
                Palier HIGH : <code className="px-1 py-0.5 rounded bg-white/60 text-[12px]">insurance_required</code> sera automatiquement fixé à <code className="px-1 py-0.5 rounded bg-white/60 text-[12px]">true</code> et
                verrouillé. Aucune dérogation possible.
              </div>
            )}
            <button type="submit" className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">Enregistrer</button>
          </form>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]"><h3 className="text-[13px] font-semibold font-mono">country_age_requirements (A13)</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Pays</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Filière</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Domaine</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Âge minimum</th>
                </tr>
              </thead>
              <tbody>
                {ages.map((a) => (
                  <tr key={a.id} className="border-b border-[#F1F5F9] last:border-0">
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{a.country}</td>
                    <td className="py-2.5 px-3 text-[#475569]">{a.profileType}</td>
                    <td className="py-2.5 px-3 text-[#475569]">{a.domain ?? "—"}</td>
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{a.minimumAge} ans</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Ajouter / Modifier un seuil d&apos;âge</h3>
          <form onSubmit={submitAge} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Pays</label>
                <select name="country" defaultValue="BJ" className={inputClass}>
                  <option value="BJ">BJ</option><option value="CI">CI</option><option value="SN">SN</option><option value="TG">TG</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Filière chantier</label>
                <select name="profileType" defaultValue="manoeuvre" className={inputClass}>
                  <option value="manoeuvre">Manœuvre</option>
                  <option value="artisan">Artisan</option>
                  <option value="expert_btp_autres">Expert BTP / Autres</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Domaine (optionnel — ex. conduite d&apos;engins)</label>
                <input type="text" name="domain" className={inputClass} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Âge minimum (18 ans plancher légal)</label>
                <input type="number" name="minimumAge" min={18} required defaultValue={18} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Justification (obligatoire)</label>
              <input type="text" name="justification" required className={inputClass} />
            </div>
            <button type="submit" className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">Enregistrer</button>
          </form>
        </div>
      </div>
    </div>
  );
}
