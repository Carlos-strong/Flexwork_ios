"use client";

import { useEffect, useState } from "react";

type Profile = {
  mainDomain: string;
  subSpecialty?: string | null;
  secondaryDomain?: string | null;
  sector?: string | null;
  modeDevis?: string | null;
  indicativeRate?: number | null;
};

type Garant = { id: string; nom: string; tel: string; obligatoire: boolean };

// Profil prestataire aligné sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : secteur (BTP / AUTRES), modes de devis A/B/C
// pour le BTP, sous-spécialité, domaine secondaire.
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [garants, setGarants] = useState<Garant[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState(profile?.sector ?? "");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setProfile(data);
        if (data?.sector) setSector(data.sector);
      })
      .finally(() => setLoading(false));
    fetch("/api/profile/garants")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGarants(d.items ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      mainDomain: form.get("mainDomain"),
      subSpecialty: form.get("subSpecialty") || undefined,
      secondaryDomain: form.get("secondaryDomain") || undefined,
      sector: form.get("sector") || undefined,
      modeDevis: form.get("modeDevis") || undefined,
      indicativeRate: form.get("indicativeRate")
        ? Number(form.get("indicativeRate"))
        : undefined,
    };
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMsg(res.ok ? "Profil enregistré." : "Échec de l'enregistrement.");
  }

  async function handleAddGarant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/profile/garants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: form.get("nom"), tel: form.get("tel") }),
    });
    if (res.ok) {
      const garant = await res.json();
      setGarants((prev) => [...prev, garant]);
      e.currentTarget.reset();
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="text-[14px] text-zinc-500">Chargement...</div>
    </div>
  );

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition";
  const btnSecondary = "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition";

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[700px] space-y-5">
        {/* Domaine d'intervention */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Domaine d&apos;intervention</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaratif</span>
          </div>
          {msg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{msg}</div>}
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine principal <span className="text-[#E8112D]">*</span></label>
              <input type="text" name="mainDomain" required defaultValue={profile?.mainDomain ?? ""} placeholder="Plomberie, Développement web..." className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Sous-spécialité</label>
                <input type="text" name="subSpecialty" defaultValue={profile?.subSpecialty ?? ""} placeholder="Ex : Chauffage / Sanitaire" className={inputClass} />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine secondaire</label>
                <input type="text" name="secondaryDomain" defaultValue={profile?.secondaryDomain ?? ""} placeholder="Ex : Électricité" className={inputClass} />
              </div>
            </div>

            {/* Secteur */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Secteur <span className="text-[#E8112D]">*</span></label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                  <input type="radio" name="sector" value="BTP" defaultChecked={profile?.sector === "BTP"} onChange={(e) => setSector(e.target.value)} /> BTP
                </label>
                <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                  <input type="radio" name="sector" value="AUTRES" defaultChecked={profile?.sector === "AUTRES"} onChange={(e) => setSector(e.target.value)} /> Autres
                </label>
              </div>
            </div>

            {/* Mode de devis BTP */}
            {sector === "BTP" && (
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mode de devis (BTP)</label>
                <select name="modeDevis" defaultValue={profile?.modeDevis ?? ""} className={inputClass}>
                  <option value="">Sélectionner un mode</option>
                  <option value="A">Mode A — Devis sur photos directes</option>
                  <option value="B">Mode B — Devis sur plans / cahier des charges (.dwg accepté)</option>
                  <option value="C">Mode C — Devis après visite technique</option>
                </select>
                <p className="text-[11px] text-zinc-400 mt-1">La visite technique du mode C est conduite de façon autonome par le professionnel.</p>
              </div>
            )}

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Tarif indicatif (XOF / jour)</label>
              <input type="number" name="indicativeRate" defaultValue={profile?.indicativeRate ?? ""} className={inputClass} />
            </div>
            <button type="submit" className={btnPrimary}>Enregistrer les modifications</button>
          </form>
        </div>

        {/* Garants */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Personnes ressources (garants)</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">1 obligatoire + 2 optionnelles</span>
          </div>
          <div className="px-6 py-5 space-y-4">
            {garants.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="bg-zinc-50 text-zinc-500 text-[11px] font-semibold uppercase tracking-wider"><th className="text-left px-4 py-2.5">Nom</th><th className="text-left px-4 py-2.5">Téléphone</th><th className="text-left px-4 py-2.5">Statut</th></tr></thead>
                  <tbody>
                    {garants.map((g) => (
                      <tr key={g.id} className="border-t border-zinc-100">
                        <td className="px-4 py-2.5">{g.nom}</td>
                        <td className="px-4 py-2.5">{g.tel}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${g.obligatoire ? "bg-[#f0fdf4] text-[#166534]" : "bg-zinc-100 text-zinc-500"}`}>
                            {g.obligatoire ? "Obligatoire" : "Optionnelle"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {garants.length < 3 && (
              <form onSubmit={handleAddGarant} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Nom</label>
                    <input type="text" name="nom" required className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Téléphone</label>
                    <input type="tel" name="tel" required className={inputClass} />
                  </div>
                </div>
                <button type="submit" className={btnSecondary}>Ajouter</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
