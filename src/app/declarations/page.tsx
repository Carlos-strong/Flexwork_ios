"use client";

import { useState } from "react";

// Qualifications / Diplômes + Expériences + Personnes ressources + Badge/VAE
// Aligné sur implementation-skillafrica-securise-v3.md et formulaires-flexwork-tous-profils.html.
type Diplome = {
  id: number;
  qualificationName: string;
  year: string;
  location: string;
  institution: string;
  specialty: string;
  isStateIssued: boolean;
};

type Experience = {
  id: number;
  clientType: "INDIVIDUAL" | "COMPANY";
  clientName: string;
  role: string;
  domain: string;
  description: string;
  startDate: string;
  endDate: string;
  technologies: string;
  projectUrl: string;
  livrables: string;
};

type PersonneRessource = {
  id: number;
  experienceId: number;
  kind: "primary" | "secondary" | "cross";
  nom: string;
  prenom: string;
  tel: string;
  email: string;
  lien: string;
};

const DIPLOME_TYPES = [
  { value: "LICENCE", label: "Licence (État)" },
  { value: "MASTER", label: "Master (État)" },
  { value: "BTS", label: "BTS (État)" },
  { value: "BAC", label: "Baccalauréat (État)" },
  { value: "CQM", label: "CQM — Certificat de Qualification aux Métiers (État)" },
  { value: "CQP", label: "CQP — Certificat de Qualification Professionnelle (État)" },
  { value: "DTS", label: "DTS" },
  { value: "BEP", label: "BEP" },
  { value: "CAP", label: "CAP" },
  { value: "CERT", label: "Certification technique" },
  { value: "AUTRE", label: "Autre" },
];

const POSTES_BTP = ["Chef de Projet", "Chef de Chantier", "Conducteur de Travaux", "Architecte", "Ingénieur", "Électricien", "Autre"];

export default function DeclarationsPage() {
  const [insuranceMsg, setInsuranceMsg] = useState<string | null>(null);
  const [qualifMsg, setQualifMsg] = useState<string | null>(null);
  const [expMsg, setExpMsg] = useState<string | null>(null);
  const [xpMsg, setXpMsg] = useState<string | null>(null);
  const [badgeMsg, setBadgeMsg] = useState<string | null>(null);
  const [diplomes, setDiplomes] = useState<Diplome[]>([{ id: 1, qualificationName: "", year: "", location: "", institution: "", specialty: "", isStateIssued: false }]);
  const [experiences, setExperiences] = useState<Experience[]>([{ id: 1, clientType: "INDIVIDUAL", clientName: "", role: "", domain: "", description: "", startDate: "", endDate: "", technologies: "", projectUrl: "", livrables: "" }]);
  const [refs, setRefs] = useState<PersonneRessource[]>([]);

  function addDiplome() {
    setDiplomes((prev) => [
      ...prev,
      {
        id: Math.max(0, ...prev.map((d) => d.id)) + 1,
        qualificationName: "",
        year: "",
        location: "",
        institution: "",
        specialty: "",
        isStateIssued: false,
      },
    ]);
  }

  function updateDiplome(id: number, field: keyof Diplome, value: string | boolean) {
    setDiplomes((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  function addExperience() {
    setExperiences((prev) => [...prev, { id: Math.max(0, ...prev.map((x) => x.id)) + 1, clientType: "INDIVIDUAL", clientName: "", role: "", domain: "", description: "", startDate: "", endDate: "", technologies: "", projectUrl: "", livrables: "" }]);
  }

  function updateExperience(id: number, field: keyof Experience, value: string) {
    setExperiences((prev) => prev.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  }

  function addRef(experienceId: number, kind: PersonneRessource["kind"]) {
    setRefs((prev) => [...prev, { id: Math.max(0, ...prev.map((r) => r.id)) + 1, experienceId, kind, nom: "", prenom: "", tel: "", email: "", lien: "" }]);
  }

  function updateRef(id: number, field: keyof PersonneRessource, value: string) {
    setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function submitExperiences(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setXpMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declarationType: "experience", experiences, references: refs }),
    });
    setXpMsg(res.ok ? "Expériences enregistrées et horodatées." : "Échec de l'enregistrement.");
  }

  async function submitBadge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBadgeMsg(null);
    const res = await fetch("/api/declarations/badge", { method: "POST" });
    setBadgeMsg(res.ok ? "Demande de vérification du badge envoyée." : "Échec — complétez toutes les sections.");
  }

  async function submitQualifications(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQualifMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declarationType: "qualification",
        diplomes: diplomes.map((d) => ({
          qualificationName: d.qualificationName,
          year: d.year ? Number(d.year) : undefined,
          location: d.location,
          institution: d.institution,
          specialty: d.specialty,
          isStateIssued: d.isStateIssued,
        })),
      }),
    });
    setQualifMsg(
      res.ok
        ? "Qualifications enregistrées et horodatées."
        : "Échec de l'enregistrement."
    );
  }

  async function submitInsurance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInsuranceMsg(null);
    const formData = new FormData(e.currentTarget);
    formData.set("declarationType", "insurance");
    const res = await fetch("/api/declarations", {
      method: "POST",
      body: formData,
    });
    setInsuranceMsg(
      res.ok
        ? "Déclaration enregistrée et horodatée."
        : "Échec de l'enregistrement."
    );
    if (res.ok) e.currentTarget.reset();
  }

  async function submitLevel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setExpMsg(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declaredLevel: form.get("declaredLevel"),
        declaredExperienceYears: form.get("declaredExperienceYears")
          ? Number(form.get("declaredExperienceYears"))
          : undefined,
      }),
    });
    setExpMsg(
      res.ok
        ? "Niveau enregistré."
        : "Échec — complétez d'abord votre profil."
    );
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] disabled:opacity-50 transition";

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[700px] space-y-5">
        {/* Warning banner */}
        <div className="bg-[#FEF9C3] border border-[#FCD116] rounded-2xl p-5">
          <div className="text-[14px] font-bold text-zinc-800">⚠️ Important</div>
          <p className="text-[13px] text-zinc-600 mt-1">
            Toutes les informations ci-dessous sont <strong>déclarées par vous</strong>. FlexWork ne les vérifie pas.
            Vous en garantissez l&apos;exactitude. Le diplôme d&apos;État est le pivot du badge.
          </p>
        </div>

        {/* Qualifications / Diplômes */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Qualifications &amp; Diplômes</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaré</span>
          </div>
          {qualifMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{qualifMsg}</div>}
          <form onSubmit={submitQualifications} className="px-6 py-5 space-y-4">
            {diplomes.map((d) => (
              <div key={d.id} className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Type de diplôme / certificat <span className="text-[#E8112D]">*</span></label>
                    <select value={d.qualificationName} onChange={(e) => updateDiplome(d.id, "qualificationName", e.target.value)} required className={inputClass}>
                      <option value="">Sélectionner</option>
                      {DIPLOME_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Année d&apos;obtention <span className="text-[#E8112D]">*</span></label>
                    <input type="number" placeholder="2018" min={1950} max={2026} value={d.year} onChange={(e) => updateDiplome(d.id, "year", e.target.value)} required className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Lieu d&apos;obtention <span className="text-[#E8112D]">*</span></label>
                    <input type="text" placeholder="Établissement, ville" value={d.location} onChange={(e) => updateDiplome(d.id, "location", e.target.value)} required className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Organisme émetteur</label>
                    <input type="text" placeholder="Nom de l'organisme" value={d.institution} onChange={(e) => updateDiplome(d.id, "institution", e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Spécialité</label>
                  <input type="text" placeholder="Spécialité / filière" value={d.specialty} onChange={(e) => updateDiplome(d.id, "specialty", e.target.value)} className={inputClass} />
                </div>
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Délivré par l&apos;État ? <span className="text-[#E8112D]">*</span></label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name={`isStateIssued_${d.id}`} checked={d.isStateIssued === true} onChange={() => updateDiplome(d.id, "isStateIssued", true)} /> Oui — pivot du badge
                    </label>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name={`isStateIssued_${d.id}`} checked={d.isStateIssued === false} onChange={() => updateDiplome(d.id, "isStateIssued", false)} /> Non — déclaratif
                    </label>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">Seul un diplôme d&apos;État validé permet de sortir définitivement de la VAE.</p>
                </div>
              </div>
            ))}
            <button type="button" onClick={addDiplome}
              className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-zinc-300 rounded-xl text-[13px] font-medium text-zinc-500 hover:border-[#008751] hover:text-[#008751] transition">
              + Ajouter un diplôme / certificat
            </button>
            <button type="submit" className={btnPrimary}>Soumettre les qualifications</button>
          </form>
        </div>

        {/* Assurance RC Pro */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Assurance RC Pro</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaré</span>
          </div>
          {insuranceMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{insuranceMsg}</div>}
          <form onSubmit={submitInsurance} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Assureur</label>
              <input type="text" name="insurerName" placeholder="NSIA, SUNU, SAHAM..." className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Numéro de police</label>
              <input type="text" name="policyNumber" placeholder="POL-123456-2026" className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Plafond de couverture (XOF)</label>
              <input type="number" name="coverageCeiling" placeholder="5000000" className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Valide jusqu&apos;au</label>
              <input type="date" name="validUntil" className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Document (police d&apos;assurance)</label>
              <div className="relative">
                <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                  + Téléverser le justificatif (PDF, JPG, PNG)
                </div>
                <input type="file" name="file" accept=".pdf,.jpg,.png" className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
            </div>
            <button type="submit" className={btnPrimary}>Enregistrer la déclaration</button>
          </form>
        </div>

        {/* Niveau / Expérience */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Expérience et niveau professionnel</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Auto-déclaré</span>
          </div>
          {expMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{expMsg}</div>}
          <form onSubmit={submitLevel} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Niveau auto-déclaré</label>
                <select name="declaredLevel" defaultValue="debutant" className={inputClass}>
                  <option value="debutant">Débutant</option>
                  <option value="junior">Junior</option>
                  <option value="intermediaire">Intermédiaire</option>
                  <option value="senior">Senior</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Années d&apos;expérience</label>
                <input type="number" name="declaredExperienceYears" placeholder="8" className={inputClass} />
              </div>
            </div>
            <button type="submit" className={btnPrimary}>Enregistrer</button>
          </form>
        </div>

        {/* Expériences professionnelles (spec §8, §14, §17, §21) */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Expériences professionnelles</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Module critique — badge</span>
          </div>
          <div className="px-6 py-3 bg-[#f0fdf4] border-b border-[#bbf7d0] text-[12px] text-[#166534]">
            Seul le statut <code className="bg-[#bbf7d0] px-1 rounded">VALIDATED</code> intervient dans l&apos;attribution du badge.
            Échantillon de 20 % audité manuellement.
          </div>
          {xpMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{xpMsg}</div>}
          <form onSubmit={submitExperiences} className="px-6 py-5 space-y-5">
            {experiences.map((xp) => {
              const xpRefs = refs.filter((r) => r.experienceId === xp.id);
              const hasPrimary = xpRefs.some((r) => r.kind === "primary");
              return (
                <div key={xp.id} className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50 space-y-4">
                  {/* Client type */}
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Type de client <span className="text-[#E8112D]">*</span></label>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                        <input type="radio" name={`clientType_${xp.id}`} checked={xp.clientType === "INDIVIDUAL"} onChange={() => updateExperience(xp.id, "clientType", "INDIVIDUAL")} /> Particulier
                      </label>
                      <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                        <input type="radio" name={`clientType_${xp.id}`} checked={xp.clientType === "COMPANY"} onChange={() => updateExperience(xp.id, "clientType", "COMPANY")} /> Entreprise
                      </label>
                    </div>
                  </div>

                  {/* Client name + Role */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Nom du client / entreprise <span className="text-[#E8112D]">*</span></label>
                      <input type="text" value={xp.clientName} onChange={(e) => updateExperience(xp.id, "clientName", e.target.value)} placeholder="Nom" required className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Poste / fonction <span className="text-[#E8112D]">*</span></label>
                      <select value={xp.role} onChange={(e) => updateExperience(xp.id, "role", e.target.value)} required className={inputClass}>
                        <option value="">Sélectionner</option>
                        {POSTES_BTP.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Domain */}
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine d&apos;intervention</label>
                    <input type="text" value={xp.domain} onChange={(e) => updateExperience(xp.id, "domain", e.target.value)} placeholder="Ex : Développement Web" className={inputClass} />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Description <span className="text-[#E8112D]">*</span></label>
                    <textarea value={xp.description} onChange={(e) => updateExperience(xp.id, "description", e.target.value)} placeholder="Description..." required rows={2} className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                  </div>

                  {/* Technologies */}
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Technologies utilisées</label>
                    <input type="text" value={xp.technologies} onChange={(e) => updateExperience(xp.id, "technologies", e.target.value)} placeholder="React, Node.js, PostgreSQL..." className={inputClass} />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Période — début</label>
                      <input type="month" value={xp.startDate} onChange={(e) => updateExperience(xp.id, "startDate", e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Période — fin</label>
                      <input type="month" value={xp.endDate} onChange={(e) => updateExperience(xp.id, "endDate", e.target.value)} className={inputClass} />
                    </div>
                  </div>

                  {/* Livrables + Project URL */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Livrables / Réalisation</label>
                      <input type="text" value={xp.livrables} onChange={(e) => updateExperience(xp.id, "livrables", e.target.value)} placeholder="Photos, documents..." className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Lien vers le projet</label>
                      <input type="url" value={xp.projectUrl} onChange={(e) => updateExperience(xp.id, "projectUrl", e.target.value)} placeholder="https://..." className={inputClass} />
                    </div>
                  </div>

                  {/* Portfolio */}
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Portfolio (images, documents)</label>
                    <div className="relative">
                      <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                        + Ajouter des fichiers au portfolio
                      </div>
                      <input type="file" multiple accept="image/jpeg,image/png,application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">Modération automatique appliquée (moderation_status).</p>
                  </div>

                  {/* Personnes ressources — Artisan / Manœuvre (spec §17, §21) */}
                  <div className="border-t border-zinc-200 pt-4 mt-2">
                    <div className="text-[13px] font-bold text-zinc-700 mb-3">Personnes ressources — vérification de terrain</div>

                    {/* Référent principal */}
                    <div className="border border-[#008751]/20 rounded-xl p-3 bg-[#f0fdf4] mb-3">
                      <div className="text-[12px] font-bold text-[#008751] mb-2">Référent principal (obligatoire)</div>
                      {xpRefs.filter((r) => r.kind === "primary").map((ref) => (
                        <div key={ref.id} className="space-y-2">
                          <div className="grid grid-cols-2 gap-3">
                            <input type="text" value={ref.nom} onChange={(e) => updateRef(ref.id, "nom", e.target.value)} placeholder="Nom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                            <input type="text" value={ref.prenom} onChange={(e) => updateRef(ref.id, "prenom", e.target.value)} placeholder="Prénom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <input type="tel" value={ref.tel} onChange={(e) => updateRef(ref.id, "tel", e.target.value)} placeholder="+229 XX XX XX XX" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                            <input type="email" value={ref.email} onChange={(e) => updateRef(ref.id, "email", e.target.value)} placeholder="email (optionnel)" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                          </div>
                          <input type="text" value={ref.lien} onChange={(e) => updateRef(ref.id, "lien", e.target.value)} placeholder="Lien avec l'expérience (client, chef de chantier...)" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                        </div>
                      ))}
                      {!hasPrimary && (
                        <button type="button" onClick={() => addRef(xp.id, "primary")}
                          className="text-[12px] text-[#008751] font-medium hover:underline">+ Ajouter le référent principal</button>
                      )}
                    </div>

                    {/* Référent secondaire */}
                    <div className="border border-zinc-200 rounded-xl p-3 bg-white mb-3">
                      <div className="text-[12px] font-bold text-zinc-600 mb-2">Référent secondaire (recommandé)</div>
                      {xpRefs.filter((r) => r.kind === "secondary").map((ref) => (
                        <div key={ref.id} className="space-y-2">
                          <div className="grid grid-cols-2 gap-3">
                            <input type="text" value={ref.nom} onChange={(e) => updateRef(ref.id, "nom", e.target.value)} placeholder="Nom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                            <input type="text" value={ref.prenom} onChange={(e) => updateRef(ref.id, "prenom", e.target.value)} placeholder="Prénom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                          </div>
                          <input type="tel" value={ref.tel} onChange={(e) => updateRef(ref.id, "tel", e.target.value)} placeholder="Téléphone" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                        </div>
                      ))}
                      <button type="button" onClick={() => addRef(xp.id, "secondary")}
                        className="text-[12px] text-[#008751] font-medium hover:underline">+ Ajouter un référent secondaire</button>
                    </div>

                    {/* Référent croisé */}
                    <div className="border border-zinc-200 rounded-xl p-3 bg-white">
                      <div className="text-[12px] font-bold text-zinc-600 mb-2">Référent croisé (optionnel — client final)</div>
                      {xpRefs.filter((r) => r.kind === "cross").map((ref) => (
                        <div key={ref.id} className="space-y-2">
                          <div className="grid grid-cols-2 gap-3">
                            <input type="text" value={ref.nom} onChange={(e) => updateRef(ref.id, "nom", e.target.value)} placeholder="Nom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                            <input type="text" value={ref.prenom} onChange={(e) => updateRef(ref.id, "prenom", e.target.value)} placeholder="Prénom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                          </div>
                          <input type="tel" value={ref.tel} onChange={(e) => updateRef(ref.id, "tel", e.target.value)} placeholder="Téléphone" className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1" />
                        </div>
                      ))}
                      <button type="button" onClick={() => addRef(xp.id, "cross")}
                        className="text-[12px] text-[#008751] font-medium hover:underline">+ Ajouter un référent croisé</button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addExperience}
              className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-zinc-300 rounded-xl text-[13px] font-medium text-zinc-500 hover:border-[#008751] hover:text-[#008751] transition">
              + Ajouter une expérience
            </button>
            <button type="submit" className={btnPrimary}>Soumettre les expériences</button>
          </form>
        </div>

        {/* Badge & VAE (spec §10, §19, §22) */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-zinc-900">Badge &amp; VAE</h2>
            <span className="text-[11px] px-2 py-1 rounded-full bg-[#008751] text-white font-bold">Vérification</span>
          </div>
          <div className="px-6 py-3 bg-[#FEF9C3] border-b border-[#FCD116] text-[12px] text-zinc-700">
            <strong>Règle :</strong> <code className="bg-[#FCD116]/30 px-1 rounded">TEST != PASSED → BADGE NON VÉRIFIÉ</code>, même si KYC, expériences et diplôme sont validés.
          </div>
          {badgeMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{badgeMsg}</div>}
          <form onSubmit={submitBadge} className="px-6 py-5 space-y-4">
            {/* Matrice badge */}
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="bg-zinc-50 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
                  <th className="text-left px-3 py-2">KYC</th><th className="text-left px-3 py-2">Expériences</th>
                  <th className="text-left px-3 py-2">Diplôme pivot</th><th className="text-left px-3 py-2">Test</th>
                  <th className="text-left px-3 py-2">Badge</th><th className="text-left px-3 py-2">VAE</th>
                </tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  <tr><td className="px-3 py-2"><span className="w-2 h-2 inline-block rounded-full bg-[#E8112D] mr-1" />❌</td><td className="px-3 py-2">❌</td><td className="px-3 py-2">❌</td><td className="px-3 py-2">❌</td><td className="px-3 py-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Non vérifié</span></td><td className="px-3 py-2">—</td></tr>
                  <tr><td className="px-3 py-2">❌</td><td className="px-3 py-2"><span className="w-2 h-2 inline-block rounded-full bg-[#008751] mr-1" />✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">Non vérifié</span></td><td className="px-3 py-2">—</td></tr>
                  <tr><td className="px-3 py-2">✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2">❌</td><td className="px-3 py-2">✅</td><td className="px-3 py-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-[#008751]/10 text-[#008751] font-medium">Vérifié</span></td><td className="px-3 py-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Active</span></td></tr>
                  <tr><td className="px-3 py-2">✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2">✅</td><td className="px-3 py-2"><span className="text-[11px] px-1.5 py-0.5 rounded bg-[#008751]/10 text-[#008751] font-bold">Vérifié</span></td><td className="px-3 py-2">—</td></tr>
                </tbody>
              </table>
            </div>

            {/* VAE info */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-[12px] text-zinc-600 space-y-2">
              <p><strong>VAE Expert (annuelle) :</strong> formation certifiante renouvelable chaque année — plafond mou à 4 ans avec audit.</p>
              <p><strong>VAE Artisan/Manœuvre (3 mois) :</strong> restrictions missions &gt; 500 000 XOF / 7 jours, escrow obligatoire.</p>
              <p className="text-[11px] text-zinc-400">Anti-triche test : 3 tentatives max (7j → 30j → 90j). Filet humain après 3 échecs.</p>
            </div>

            <button type="submit" className={btnPrimary}>Vérifier le badge</button>
          </form>
        </div>

        {/* False declaration warning */}
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <div className="text-[14px] font-bold text-red-800">⚠️ Conséquence d&apos;une fausse déclaration</div>
          <p className="text-[13px] text-zinc-600 mt-1">
            Toute déclaration inexacte constitue une fausse déclaration contractuelle. Votre compte peut être suspendu
            sur signalement d&apos;un tiers. En cas de dommage, vous en assumez l&apos;entière responsabilité civile.
          </p>
        </div>
      </div>
    </div>
  );
}
