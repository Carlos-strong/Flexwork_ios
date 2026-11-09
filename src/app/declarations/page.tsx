"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { currentCallbackUrl } from "@/lib/safe-callback";
import { BackLink } from "@/components/BackLink";

// Page d'où l'on vient d'habitude : l'onglet Expérience du profil, qui renvoie ici pour
// l'assurance, les références et l'historique. Un `?returnTo=` sûr (ex. /badge) l'emporte.
const DEFAULT_BACK = { href: "/profile?tab=experience", label: "Retour à mon profil" };

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

// Sections repliables : chaque titre ouvre/ferme son contenu. Le contenu replié reste monté
// (attribut `hidden`) pour ne pas perdre une saisie en cours. L'ancre de l'URL
// (/declarations#qualifications, lien du BadgePanel) ouvre et fait défiler la section visée.
const SECTION_IDS = ["qualifications", "assurance", "niveau", "experiences", "badge"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function isSectionId(v: string): v is SectionId {
  return (SECTION_IDS as readonly string[]).includes(v);
}

function Section({
  id,
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: ReactNode;
  badge: ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <h2>
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          aria-controls={`${id}-content`}
          className={`w-full px-6 py-4 flex items-center gap-3 text-left hover:bg-zinc-50 transition-colors ${
            open ? "border-b border-zinc-100" : ""
          }`}
        >
          <span className="flex-1 text-[15px] font-bold text-zinc-900">{title}</span>
          {badge}
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      <div id={`${id}-content`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

const POSTES_BTP = ["Chef de Projet", "Chef de Chantier", "Conducteur de Travaux", "Architecte", "Ingénieur", "Électricien", "Autre"];

export default function DeclarationsPage() {
  // Par défaut, seule la première section est ouverte ; l'ancre de l'URL l'emporte.
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set<SectionId>(["qualifications"]));
  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const allOpen = openSections.size === SECTION_IDS.length;

  const [back, setBack] = useState(DEFAULT_BACK);
  useEffect(() => {
    const returnTo = currentCallbackUrl("returnTo");
    if (returnTo) setBack({ href: returnTo, label: "Revenir à la page précédente" });
  }, []);

  useEffect(() => {
    function openFromHash() {
      const target = window.location.hash.slice(1);
      if (!isSectionId(target)) return;
      setOpenSections((prev) => new Set(prev).add(target));
      // Après le rendu : la section dépliée a sa hauteur réelle.
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
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
    if (res.ok) {
      setXpMsg("Expériences enregistrées et horodatées.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setXpMsg(data.message ?? "Échec de l'enregistrement — vérifiez que chaque expérience porte un poste.");
  }

  async function submitBadge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBadgeMsg(null);
    const res = await fetch("/api/declarations/badge", { method: "POST" });
    if (res.ok) {
      setBadgeMsg("Demande de vérification envoyée — elle sera instruite par un administrateur.");
      return;
    }
    // Le serveur dit ce qui manque (diplôme d'État absent, demande déjà en cours...) : on
    // affiche SON motif. L'ancien message « Échec — complétez toutes les sections » accusait
    // le prestataire alors que la route appelée n'existait même pas.
    const data = await res.json().catch(() => ({}));
    setBadgeMsg(data.message ?? "La demande n'a pas pu être envoyée.");
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
        ? `${diplomes.length} qualification(s) enregistrée(s) et horodatée(s).`
        : "Échec de l'enregistrement — chaque diplôme doit porter un intitulé."
    );
  }

  async function submitInsurance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInsuranceMsg(null);
    // Capturé avant le await : React remet e.currentTarget à null une fois la phase
    // synchrone de l'événement terminée — l'appeler après un await levait
    // "null is not an object" (voir le même correctif sur src/app/profile/page.tsx).
    const formEl = e.currentTarget;
    const formData = new FormData(formEl);
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
    if (res.ok) formEl.reset();
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
      <div className="mx-auto fluid-form [--fw:700px] space-y-5">
        {/* En-tête : retour vers la page d'origine, titre, objet de la page. */}
        <header className="space-y-4">
          <BackLink href={back.href} label={back.label} />
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[#0A1931]">Mes déclarations professionnelles</h1>
            <p className="mt-1 text-[14px] text-zinc-500">
              Diplômes, assurance, niveau et expériences : les éléments que vous déclarez pour votre profil et votre badge.
            </p>
          </div>
        </header>

        {/* Le seul avertissement de la page : nature déclarative et engagement de responsabilité. */}
        <div role="note" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600">
            <path
              d="M10 3.2l7.4 13.1H2.6L10 3.2zM10 8.2v3.6M10 14.2v.1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-[13px] leading-relaxed text-zinc-700">
            <p className="font-semibold text-zinc-900">Informations déclarées sous votre responsabilité</p>
            <p className="mt-1">
              FlexWork ne vérifie pas ces informations : vous en garantissez l&apos;exactitude. Une déclaration inexacte
              constitue une fausse déclaration contractuelle — votre compte peut être suspendu sur signalement d&apos;un
              tiers, et vous assumez l&apos;entière responsabilité civile d&apos;un éventuel dommage.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-zinc-400">Sections</p>
          <button
            type="button"
            onClick={() => setOpenSections(allOpen ? new Set() : new Set(SECTION_IDS))}
            className="text-[13px] font-medium text-[#008751] hover:underline"
          >
            {allOpen ? "Tout replier" : "Tout déplier"}
          </button>
        </div>

        {/* Qualifications / Diplômes */}
        <Section
          id="qualifications"
          title={<>Qualifications &amp; Diplômes</>}
          badge={<span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaré</span>}
          open={openSections.has("qualifications")}
          onToggle={toggleSection}
        >
          {qualifMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{qualifMsg}</div>}
          <form onSubmit={submitQualifications} className="px-6 py-5 space-y-4">
            {diplomes.map((d) => (
              <div key={d.id} className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50">
                <div className="grid sm:grid-cols-2 gap-4">
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
                <div className="grid sm:grid-cols-2 gap-4 mt-4">
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
        </Section>

        {/* Assurance RC Pro */}
        <Section
          id="assurance"
          title={<>Assurance RC Pro</>}
          badge={<span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Déclaré</span>}
          open={openSections.has("assurance")}
          onToggle={toggleSection}
        >
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
        </Section>

        {/* Niveau / Expérience */}
        <Section
          id="niveau"
          title={<>Expérience et niveau professionnel</>}
          badge={<span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Auto-déclaré</span>}
          open={openSections.has("niveau")}
          onToggle={toggleSection}
        >
          {expMsg && <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] text-[13px] text-[#166534] font-medium">{expMsg}</div>}
          <form onSubmit={submitLevel} className="px-6 py-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
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
        </Section>

        {/* Expériences professionnelles (spec §8, §14, §17, §21) */}
        <Section
          id="experiences"
          title={<>Expériences professionnelles</>}
          badge={<span className="text-[11px] px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 font-medium">Module critique — badge</span>}
          open={openSections.has("experiences")}
          onToggle={toggleSection}
        >
          <p className="px-6 pt-4 text-[12px] text-zinc-500">
            Seules les expériences validées par vos références comptent pour le badge. 20 % des déclarations sont
            contrôlées manuellement.
          </p>
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
                  <div className="grid sm:grid-cols-2 gap-4">
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
                  <div className="grid sm:grid-cols-2 gap-4">
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
                  <div className="grid sm:grid-cols-2 gap-4">
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
                          <div className="grid sm:grid-cols-2 gap-3">
                            <input type="text" value={ref.nom} onChange={(e) => updateRef(ref.id, "nom", e.target.value)} placeholder="Nom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                            <input type="text" value={ref.prenom} onChange={(e) => updateRef(ref.id, "prenom", e.target.value)} placeholder="Prénom" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#008751]/20" />
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
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
                          <div className="grid sm:grid-cols-2 gap-3">
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
                          <div className="grid sm:grid-cols-2 gap-3">
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
        </Section>

        {/* Badge & VAE (spec §10, §19, §22) */}
        <Section
          id="badge"
          title={<>Badge &amp; VAE</>}
          badge={<span className="text-[11px] px-2 py-1 rounded-full bg-[#008751] text-white font-bold">Vérification</span>}
          open={openSections.has("badge")}
          onToggle={toggleSection}
        >
          <p className="px-6 pt-4 text-[12px] text-zinc-500">
            Le badge n&apos;est accordé qu&apos;après réussite du test, même si l&apos;identité, les expériences et le
            diplôme sont validés.
          </p>
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
        </Section>
      </div>
    </div>
  );
}
