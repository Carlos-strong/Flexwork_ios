"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-ui";

type AgeEntry = { id: string; country: string; profileType: string; domain: string | null; minimumAge: number };

const inputClass = "w-full h-10 px-3 rounded-lg border border-[#E2E0D9] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5BE3]/20 focus:border-[#2D5BE3]";

// Seuils d'âge minimum par pays (A13).
//
// Cet écran gérait aussi les paliers de risque par domaine — il ne le fait plus (2026-09-24).
// Le risque était indexé sur un libellé LIBRE et un pays, si bien que sur 220 métiers du
// catalogue, 4 trouvaient une ligne et les 4 lignes « high » n'en désignaient aucun : le palier
// élevé n'était jamais atteint, et l'obligation d'assurance qui en dépend ne se déclenchait
// jamais. Il vit maintenant sur le métier lui-même (Metier.riskLevel), où il ne peut plus être
// orphelin — saisie dans « Taxonomie », au moment où l'on décrit le métier.
//
// Le seuil d'âge, lui, varie réellement d'un pays à l'autre : il reste ici.
export default function AdminAgeRequirementsPage() {
  const [ages, setAges] = useState<AgeEntry[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadAges() {
    const res = await fetch("/api/admin/country-age-requirements");
    if (res.ok) setAges((await res.json()).items);
  }

  useEffect(() => {
    loadAges();
  }, []);

  async function submitAge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    // Capturé AVANT le await : React remet `e.currentTarget` à null une fois la phase synchrone
    // de l'événement terminée — l'appeler après un await levait "null is not an object".
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
    <div className="text-[#1A1916]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="🌍"
          title="Localisation"
          subtitle="Réglages par pays : âge minimum des filières chantier. Ce projet ne tient pas de référentiel de villes ni de régions — le seuil d'âge est le seul réglage de cet écran qui varie réellement d'un pays à l'autre."
        />

        <div className="rounded-xl border border-[#E2E0D9] bg-white p-3.5 text-[12.5px] text-[#5A5750] leading-relaxed">
          <strong className="text-[#1A1916]">Les paliers de risque ne sont plus ici.</strong> Ils sont portés par le métier
          lui-même et se règlent dans <a href="/backoffice/catalog" className="underline">Taxonomie</a>, au moment où l&apos;on décrit
          le métier. Indexé sur un libellé libre, le risque ne correspondait qu&apos;à 4 métiers sur 220 — et jamais à un palier
          « élevé », si bien que l&apos;assurance obligatoire ne se déclenchait jamais. Sur le métier, il ne peut plus être
          orphelin. La règle reste la même :{" "}
          <code className="px-1 py-0.5 rounded bg-[#F4F3EF] text-[12px]">riskLevel = high</code> entraîne{" "}
          <code className="px-1 py-0.5 rounded bg-[#F4F3EF] text-[12px]">insurance_required = true</code>, sans dérogation possible.
        </div>

        {feedback && <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{feedback}</div>}

        <div id="age" className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden scroll-mt-6">
          <div className="p-4 lg:p-5 border-b border-[#E2E0D9]"><h3 className="text-[13px] font-semibold font-mono">country_age_requirements (A13)</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#5A5750] uppercase bg-[#FAFAF8] border-b border-[#E2E0D9]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Pays</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Filière</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Domaine</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Âge minimum</th>
                </tr>
              </thead>
              <tbody>
                {ages.map((a) => (
                  <tr key={a.id} className="border-b border-[#F4F3EF] last:border-0">
                    <td className="py-2.5 px-4 lg:px-5 text-[#5A5750]">{a.country}</td>
                    <td className="py-2.5 px-3 text-[#5A5750]">{a.profileType}</td>
                    <td className="py-2.5 px-3 text-[#5A5750]">{a.domain ?? "—"}</td>
                    <td className="py-2.5 px-4 lg:px-5 text-[#5A5750]">{a.minimumAge} ans</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#E2E0D9] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Ajouter / Modifier un seuil d&apos;âge</h3>
          <form onSubmit={submitAge} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#5A5750] mb-1">Pays</label>
                <select name="country" defaultValue="BJ" className={inputClass}>
                  <option value="BJ">BJ</option><option value="CI">CI</option><option value="SN">SN</option><option value="TG">TG</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#5A5750] mb-1">Filière chantier</label>
                <select name="profileType" defaultValue="manoeuvre" className={inputClass}>
                  <option value="manoeuvre">Manœuvre</option>
                  <option value="artisan">Artisan</option>
                  <option value="expert_btp_autres">Entreprise</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#5A5750] mb-1">Domaine (optionnel — ex. conduite d&apos;engins)</label>
                <input type="text" name="domain" className={inputClass} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#5A5750] mb-1">Âge minimum (18 ans plancher légal)</label>
                <input type="number" name="minimumAge" min={18} required defaultValue={18} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#5A5750] mb-1">Justification (obligatoire)</label>
              <input type="text" name="justification" required className={inputClass} />
            </div>
            <button type="submit" className="h-10 px-5 rounded-lg bg-[#2D5BE3] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">Enregistrer</button>
          </form>
        </div>
      </div>
    </div>
  );
}
