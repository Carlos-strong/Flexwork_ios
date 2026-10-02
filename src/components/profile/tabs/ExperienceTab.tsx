"use client";

// Onglet 3 — Expérience (20 % du profil prestataire).
//
// Critères du barème : années d'expérience + au moins une expérience déclarée + au moins un
// diplôme déclaré. Les trois viennent de deux sources différentes :
//
//   - les ANNÉES et le NIVEAU vivent sur `Profile` (PATCH /api/profile) ;
//   - les expériences et les diplômes vivent dans les DÉCLARATIONS append-only, rattachés à
//     la déclaration qui les scelle (POST /api/declarations). Une correction crée une
//     nouvelle déclaration, l'ancienne reste consultable — on ne modifie ni ne supprime une
//     déclaration.
//
// ── Pourquoi les formulaires détaillés restent sur /declarations ────────────────────────
//
// Cet onglet couvre ce que le barème exige et rien de plus : une expérience et un diplôme,
// dans leur forme la plus simple. L'assurance RC Pro, les références détaillées, les pièces
// jointes et la lecture de l'historique complet sont sur /declarations, où ils existent déjà.
// Les redévelopper ici aurait créé deux écrans de déclaration à maintenir, avec deux façons
// de sceller la même chose.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasRequiredGarants } from "@/lib/garant-rules";
import {
  Field,
  ProfileCard,
  SaveRow,
  btnPrimary,
  btnSecondary,
  inputClass,
  PROFILE_ERROR_MESSAGES,
  type ProviderProfile,
} from "@/components/profile/profile-shared";

type DeclaredDiploma = {
  id: string;
  qualificationName: string;
  year: number | null;
  institution: string | null;
  isStateIssued: boolean;
};

type DeclaredExperience = {
  id: string;
  role: string;
  clientName: string | null;
  startDate: string | null;
  endDate: string | null;
  domain: string | null;
};

type Garant = { id: string; nom: string; tel: string; obligatoire: boolean };

const LEVELS = [
  { value: "debutant", label: "Débutant" },
  { value: "intermediaire", label: "Intermédiaire" },
  { value: "senior", label: "Senior" },
  { value: "expert", label: "Expert" },
];

const GARANT_ERROR_MESSAGES: Record<string, string> = {
  duplicate_garant_tel: "Ce numéro est déjà utilisé par un autre de vos garants.",
  max_garants_reached: "Maximum 3 garants (1 obligatoire + 2 optionnelles) atteint.",
  invalid_payload: "Nom et téléphone sont requis (téléphone : 8 à 20 caractères).",
  profile_required: "Enregistrez d'abord votre domaine d'intervention (onglet Domaines).",
  not_found: "Ce garant n'existe plus — la liste a été actualisée.",
};

export function ExperienceTab({
  profile,
  onSaved,
  onCompletionChanged,
}: {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
  onCompletionChanged: () => void;
}) {
  const router = useRouter();

  // ── Niveau et années ──────────────────────────────────────────────────────────────────
  const [declaredLevel, setDeclaredLevel] = useState(profile?.declaredLevel ?? "");
  const [years, setYears] = useState(
    typeof profile?.declaredExperienceYears === "number" ? String(profile.declaredExperienceYears) : "",
  );
  const [levelMsg, setLevelMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [levelSaving, setLevelSaving] = useState(false);

  // ── Déclarations (expériences, diplômes) ──────────────────────────────────────────────
  const [experiences, setExperiences] = useState<DeclaredExperience[]>([]);
  const [diplomas, setDiplomas] = useState<DeclaredDiploma[]>([]);
  const [declMsg, setDeclMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Message de l'expérience, DISTINCT de celui du diplôme (2026-09-24). Les deux formulaires
  // partageaient le même état, rendu dans le seul formulaire d'expérience : ajouter un diplôme
  // affichait sa confirmation sous l'expérience, et le diplôme lui-même n'en montrait aucune.
  // Deux actions distinctes, deux messages distincts, chacun sous son formulaire.
  const [expMsg, setExpMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [declSaving, setDeclSaving] = useState(false);

  // ── Portfolio & CV ────────────────────────────────────────────────────────────────────
  const [portfolioUrls, setPortfolioUrls] = useState<string[]>(profile?.portfolioUrls ?? []);
  const [cvUrl, setCvUrl] = useState<string | null>(profile?.cvUrl ?? null);
  const [linkDraft, setLinkDraft] = useState("");
  const [portfolioMsg, setPortfolioMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const cvRef = useRef<HTMLInputElement>(null);

  // ── Garants (personnes ressources) ────────────────────────────────────────────────────
  const [garants, setGarants] = useState<Garant[]>([]);
  const [garantMsg, setGarantMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editingGarantId, setEditingGarantId] = useState<string | null>(null);
  const [editNom, setEditNom] = useState("");
  const [editTel, setEditTel] = useState("");

  // Présent quand on arrive ici depuis une candidature bloquée par un profil incomplet
  // (garant obligatoire manquant, voir DevisForm) : on revient automatiquement dès que la
  // condition est satisfaite, plutôt que d'obliger à retrouver la mission à la main.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [autoReturning, setAutoReturning] = useState(false);
  // ⚠️ Le garde anti-relance est un ref, PAS le state : en dépendances, `setAutoReturning`
  // redéclenchait l'effet, dont le nettoyage annulait le minuteur qu'on venait de programmer.
  const redirectStartedRef = useRef(false);

  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }, []);

  useEffect(() => {
    fetch("/api/profile/garants")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setGarants(d.items ?? []))
      .catch(() => setGarants([]));
  }, []);

  // Les déclarations ne se chargent qu'une fois le profil connu : `GET /api/declarations`
  // exige un `profileId`, et sans profil il n'y a rien à lire.
  useEffect(() => {
    if (!profile?.id) return;
    fetch(`/api/declarations?profileId=${encodeURIComponent(profile.id)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items = (d.items ?? []) as Array<{ declarationType: string; diplomas?: DeclaredDiploma[]; experiences?: DeclaredExperience[] }>;
        // Même règle que côté serveur : seule la déclaration la PLUS RÉCENTE par type est
        // affichée (le serveur ne renvoie déjà que celle-là, on aplatit simplement).
        setDiplomas(items.flatMap((d) => d.diplomas ?? []));
        setExperiences(items.flatMap((d) => d.experiences ?? []));
      })
      .catch(() => {
        setDiplomas([]);
        setExperiences([]);
      });
  }, [profile?.id]);

  useEffect(() => {
    if (!returnTo || redirectStartedRef.current || !hasRequiredGarants(garants)) return;
    redirectStartedRef.current = true;
    setAutoReturning(true);
    const timer = setTimeout(() => router.push(returnTo), 1500);
    return () => clearTimeout(timer);
  }, [returnTo, garants, router]);

  async function saveLevel(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!declaredLevel) {
      setLevelMsg({ text: "Choisissez votre niveau professionnel.", ok: false });
      return;
    }
    setLevelSaving(true);
    setLevelMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declaredLevel,
        // `0` est une réponse valide (« débutant ») : on n'omet la clé que si le champ est
        // réellement vide.
        declaredExperienceYears: years === "" ? undefined : Number(years),
      }),
    });
    setLevelSaving(false);
    if (res.ok) {
      onSaved(await res.json());
      onCompletionChanged();
      setLevelMsg({ text: "Niveau et expérience enregistrés.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setLevelMsg({
      text:
        data.error === "profile_required"
          ? "Enregistrez d'abord votre métier principal (onglet Domaines)."
          : (PROFILE_ERROR_MESSAGES[data.error] ?? "Échec de l'enregistrement."),
      ok: false,
    });
  }

  async function addExperience(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setDeclSaving(true);
    setExpMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declarationType: "experience",
        experiences: [
          {
            clientType: form.get("clientType") === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
            clientName: form.get("clientName") || undefined,
            role: form.get("role"),
            domain: form.get("domain") || undefined,
            description: form.get("description") || undefined,
            // Dates « AAAA-MM » telles que <input type="month"> les produit : les convertir en
            // date complète inventerait un jour qui n'a pas été saisi.
            startDate: form.get("startDate") || undefined,
            endDate: form.get("endDate") || undefined,
          },
        ],
      }),
    });
    setDeclSaving(false);
    if (res.ok) {
      const created = await res.json();
      // Rechargement depuis le serveur plutôt qu'ajout local : la déclaration est scellée et
      // chaînée, c'est la version serveur qui fait foi.
      const items = await fetch(`/api/declarations?profileId=${encodeURIComponent(profile!.id)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => (d.items ?? []) as Array<{ diplomas?: DeclaredDiploma[]; experiences?: DeclaredExperience[] }>);
      setExperiences(items.flatMap((d) => d.experiences ?? []));
      setDiplomas(items.flatMap((d) => d.diplomas ?? []));
      formEl.reset();
      onCompletionChanged();
      // Identifiant renvoyé pour que l'utilisateur voie laquelle des déclarations est la
      // dernière scellée, sans avoir à la chercher dans l'historique.
      setExpMsg({ text: `Expérience déclarée et horodatée (réf. ${String(created.id).slice(-6)}).`, ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setExpMsg({
      text:
        data.error === "profile_required"
          ? "Enregistrez d'abord votre métier principal (onglet Domaines)."
          : "Échec de l'enregistrement de l'expérience.",
      ok: false,
    });
  }

  async function addDiploma(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setDeclSaving(true);
    setDeclMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declarationType: "qualification",
        diplomes: [
          {
            qualificationName: form.get("qualificationName"),
            year: form.get("year") ? Number(form.get("year")) : undefined,
            institution: form.get("institution") || undefined,
            specialty: form.get("specialty") || undefined,
            // Le diplôme d'État est le PIVOT du badge : c'est lui, et lui seul, qui rend une
            // demande de badge éligible.
            isStateIssued: form.get("isStateIssued") === "on",
          },
        ],
      }),
    });
    setDeclSaving(false);
    if (res.ok) {
      const items = await fetch(`/api/declarations?profileId=${encodeURIComponent(profile!.id)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => (d.items ?? []) as Array<{ diplomas?: DeclaredDiploma[] }>);
      setDiplomas(items.flatMap((d) => d.diplomas ?? []));
      formEl.reset();
      onCompletionChanged();
      setDeclMsg({ text: "Diplôme déclaré et horodaté.", ok: true });
      return;
    }
    setDeclMsg({ text: "Échec de l'enregistrement du diplôme.", ok: false });
  }

  async function uploadPortfolio(kind: "photo" | "cv", e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setPortfolioBusy(true);
    setPortfolioMsg(null);
    const added: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);
      const res = await fetch("/api/profile/portfolio", { method: "POST", body: formData });
      if (res.ok) added.push((await res.json()).relPath);
    }
    setPortfolioBusy(false);
    if (!added.length) {
      setPortfolioMsg({ text: "Échec de l'envoi.", ok: false });
      return;
    }
    const nextPhotos = kind === "photo" ? [...portfolioUrls, ...added].slice(0, 10) : portfolioUrls;
    const nextCv = kind === "cv" ? added[0] : cvUrl;
    // Sauvegarde immédiate : le fichier est déjà sur le disque, mais il ne compte pour le
    // profil que lorsque la référence est enregistrée.
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioUrls: nextPhotos, cvUrl: nextCv ?? undefined }),
    });
    if (res.ok) {
      setPortfolioUrls(nextPhotos);
      setCvUrl(nextCv);
      onSaved(await res.json());
      setPortfolioMsg({ text: kind === "cv" ? "CV enregistré." : `${added.length} photo(s) enregistrée(s).`, ok: true });
    } else {
      setPortfolioMsg({ text: "Fichier(s) téléversé(s) mais profil non enregistré — réessayez.", ok: false });
    }
  }

  async function savePortfolioLinks(nextUrls: string[]) {
    setPortfolioBusy(true);
    setPortfolioMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioUrls: nextUrls, cvUrl: cvUrl ?? undefined }),
    });
    setPortfolioBusy(false);
    if (res.ok) {
      setPortfolioUrls(nextUrls);
      onSaved(await res.json());
      setPortfolioMsg({ text: "Portfolio enregistré.", ok: true });
    } else {
      setPortfolioMsg({ text: "Échec de l'enregistrement du portfolio.", ok: false });
    }
  }

  async function addGarant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const res = await fetch("/api/profile/garants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: form.get("nom"), tel: form.get("tel") }),
    });
    if (res.ok) {
      const garant = await res.json();
      setGarants((prev) => [...prev, garant]);
      setGarantMsg(null);
      formEl.reset();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de l'ajout du garant.", ok: false });
  }

  async function saveEditGarant(id: string) {
    setGarantMsg(null);
    const res = await fetch(`/api/profile/garants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: editNom.trim(), tel: editTel.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setGarants((prev) => prev.map((g) => (g.id === id ? updated : g)));
      setEditingGarantId(null);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de la modification.", ok: false });
  }

  async function deleteGarant(g: Garant) {
    if (!window.confirm(`Supprimer le garant « ${g.nom} » ?`)) return;
    setGarantMsg(null);
    const res = await fetch(`/api/profile/garants/${g.id}`, { method: "DELETE" });
    if (res.ok) {
      // Relecture serveur : supprimer le garant obligatoire promeut automatiquement le plus
      // ancien restant, et un filtre local afficherait un état « obligatoire » périmé.
      const list = await fetch("/api/profile/garants").then((r) => (r.ok ? r.json() : { items: [] }));
      setGarants(list.items ?? []);
      return;
    }
    const data = await res.json().catch(() => ({}));
    setGarantMsg({ text: GARANT_ERROR_MESSAGES[data.error] ?? "Échec de la suppression.", ok: false });
  }

  return (
    <div className="space-y-5">
      {returnTo && (
        <div
          className={`rounded-2xl border p-4 text-[13px] ${
            autoReturning ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {autoReturning ? (
            <>
              <p className="font-semibold">✓ Garant ajouté — retour à votre candidature...</p>
              <p className="mt-1">Votre devis vous attend, restauré tel quel.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Complétez votre profil pour reprendre votre candidature.</p>
              <p className="mt-1">
                Ajoutez au moins un garant obligatoire ci-dessous (et une assurance déclarée si la mission l&apos;exige) :
                vous serez ramené automatiquement à votre candidature dès que le garant obligatoire est enregistré.
              </p>
            </>
          )}
          <Link
            href={returnTo}
            className={`mt-3 inline-block rounded-full px-4 py-2 text-[13px] font-semibold text-white ${
              autoReturning ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            Y aller maintenant
          </Link>
        </div>
      )}

      <ProfileCard title="Niveau et années d'expérience">
        <form onSubmit={saveLevel} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Niveau professionnel" htmlFor="declaredLevel" required>
              <select
                id="declaredLevel"
                value={declaredLevel}
                onChange={(e) => setDeclaredLevel(e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Sélectionner</option>
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Années d'expérience" htmlFor="years">
              <input
                id="years"
                type="number"
                min={0}
                max={60}
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className={inputClass}
                placeholder="5"
              />
            </Field>
          </div>
          <SaveRow saving={levelSaving} message={levelMsg} label="Enregistrer le niveau" />
        </form>
      </ProfileCard>

      <ProfileCard
        title="Expériences professionnelles"
        description="Chaque ajout crée une déclaration horodatée et chaînée. Une correction crée une nouvelle déclaration, l'ancienne reste consultable."
      >
        {experiences.length > 0 && (
          <ul className="mb-4 space-y-2">
            {experiences.map((xp) => (
              <li key={xp.id} className="rounded-xl bg-zinc-50 px-4 py-3">
                <p className="text-[13px] font-medium text-[#0A1931]">{xp.role}</p>
                <p className="text-[12px] text-zinc-500">
                  {[xp.clientName, xp.domain, [xp.startDate, xp.endDate].filter(Boolean).join(" → ")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addExperience} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Poste" htmlFor="role" required>
              <input id="role" name="role" required maxLength={200} className={inputClass} placeholder="Électricien" />
            </Field>
            <Field label="Employeur / client" htmlFor="clientName">
              <input id="clientName" name="clientName" maxLength={200} className={inputClass} placeholder="Entreprise X" />
            </Field>
            <Field label="Type de client" htmlFor="clientType">
              <select id="clientType" name="clientType" className={inputClass} defaultValue="COMPANY">
                <option value="COMPANY">Entreprise</option>
                <option value="INDIVIDUAL">Particulier</option>
              </select>
            </Field>
            <Field label="Domaine" htmlFor="domain">
              <input id="domain" name="domain" maxLength={200} className={inputClass} placeholder="BTP" />
            </Field>
            <Field label="Début" htmlFor="startDate">
              <input id="startDate" name="startDate" type="month" className={inputClass} />
            </Field>
            <Field label="Fin" htmlFor="endDate" hint="Laissez vide si l'expérience est en cours.">
              <input id="endDate" name="endDate" type="month" className={inputClass} />
            </Field>
          </div>
          <Field label="Description" htmlFor="description">
            <textarea
              id="description"
              name="description"
              rows={3}
              maxLength={3000}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition"
              placeholder="Ce que vous avez réalisé, avec quels moyens."
            />
          </Field>
          <button type="submit" disabled={declSaving} className={btnPrimary}>
            {declSaving ? "Enregistrement..." : "Ajouter l'expérience"}
          </button>
          {expMsg && (
            <p className={`text-[12px] ${expMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{expMsg.text}</p>
          )}
        </form>
      </ProfileCard>

      <ProfileCard
        title="Diplômes et certifications"
        description="Le diplôme d'État est le pivot du badge « Vérifié » : il rend une demande éligible."
      >
        {diplomas.length > 0 && (
          <ul className="mb-4 space-y-2">
            {diplomas.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-[#0A1931]">{d.qualificationName}</p>
                  <p className="text-[12px] text-zinc-500">{[d.institution, d.year].filter(Boolean).join(" · ")}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                    d.isStateIssued ? "bg-[#008751]/10 text-[#008751]" : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {d.isStateIssued ? "Diplôme d'État" : "Déclaratif"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addDiploma} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Intitulé" htmlFor="qualificationName" required>
              <input
                id="qualificationName"
                name="qualificationName"
                required
                maxLength={200}
                className={inputClass}
                placeholder="CQP Plomberie"
              />
            </Field>
            <Field label="Année" htmlFor="year">
              <input id="year" name="year" type="number" min={1950} max={2100} className={inputClass} placeholder="2021" />
            </Field>
            <Field label="Établissement" htmlFor="institution">
              <input id="institution" name="institution" maxLength={200} className={inputClass} placeholder="Lycée technique" />
            </Field>
            <Field label="Spécialité" htmlFor="specialty">
              <input id="specialty" name="specialty" maxLength={200} className={inputClass} placeholder="Sanitaire" />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-[13px] text-zinc-700">
            <input type="checkbox" name="isStateIssued" className="accent-[#008751]" />
            Diplôme d&apos;État
          </label>
          <button type="submit" disabled={declSaving} className={btnPrimary}>
            {declSaving ? "Enregistrement..." : "Ajouter le diplôme"}
          </button>
          {declMsg && (
            <p className={`text-[12px] ${declMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{declMsg.text}</p>
          )}
        </form>
      </ProfileCard>

      <ProfileCard title="Portfolio et CV" description="Photos de réalisations, CV au format PDF, ou liens externes.">
        <div className="flex flex-wrap gap-2">
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => uploadPortfolio("photo", e)}
          />
          <input ref={cvRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => uploadPortfolio("cv", e)} />
          <button type="button" disabled={portfolioBusy} className={btnSecondary} onClick={() => photoRef.current?.click()}>
            Ajouter des photos
          </button>
          <button type="button" disabled={portfolioBusy} className={btnSecondary} onClick={() => cvRef.current?.click()}>
            {cvUrl ? "Remplacer le CV" : "Ajouter un CV"}
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            maxLength={500}
            className={inputClass}
            placeholder="https://..."
          />
          <button
            type="button"
            disabled={portfolioBusy || !linkDraft.trim()}
            className={`${btnSecondary} whitespace-nowrap disabled:opacity-50`}
            onClick={() => {
              const next = [...portfolioUrls, linkDraft.trim()].slice(0, 10);
              setLinkDraft("");
              void savePortfolioLinks(next);
            }}
          >
            Ajouter un lien
          </button>
        </div>

        {portfolioUrls.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {portfolioUrls.map((url) => (
              <li key={url} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2">
                <span className="truncate text-[12px] text-zinc-600">{url}</span>
                <button
                  type="button"
                  disabled={portfolioBusy}
                  onClick={() => void savePortfolioLinks(portfolioUrls.filter((u) => u !== url))}
                  className="shrink-0 text-[12px] text-red-500 hover:underline"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
        {portfolioMsg && (
          <p className={`mt-3 text-[12px] ${portfolioMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{portfolioMsg.text}</p>
        )}
      </ProfileCard>

      <ProfileCard
        title="Personnes ressources (garants)"
        description="Un garant obligatoire est exigé pour candidater aux missions en présentiel ou hybride quand l'Admin KYC l'a activé pour votre compte."
      >
        {garants.length > 0 && (
          <ul className="mb-4 space-y-2">
            {garants.map((g) => (
              <li key={g.id} className="rounded-xl bg-zinc-50 px-4 py-3">
                {editingGarantId === g.id ? (
                  <div className="space-y-2">
                    <input value={editNom} onChange={(e) => setEditNom(e.target.value)} className={inputClass} />
                    <input value={editTel} onChange={(e) => setEditTel(e.target.value)} className={inputClass} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void saveEditGarant(g.id)} className={btnPrimary}>
                        Enregistrer
                      </button>
                      <button type="button" onClick={() => setEditingGarantId(null)} className={btnSecondary}>
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-[#0A1931]">
                        {g.nom}
                        {g.obligatoire && <span className="ml-2 text-[11px] font-semibold text-[#008751]">Obligatoire</span>}
                      </p>
                      <p className="text-[12px] text-zinc-500">{g.tel}</p>
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGarantId(g.id);
                          setEditNom(g.nom);
                          setEditTel(g.tel);
                        }}
                        className="text-[12px] text-zinc-600 hover:underline"
                      >
                        Modifier
                      </button>
                      <button type="button" onClick={() => void deleteGarant(g)} className="text-[12px] text-red-500 hover:underline">
                        Supprimer
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {garants.length < 3 && (
          <form onSubmit={addGarant} className="grid sm:grid-cols-3 gap-3">
            <Field label="Nom" htmlFor="nom" required>
              <input id="nom" name="nom" required maxLength={120} className={inputClass} />
            </Field>
            <Field label="Téléphone" htmlFor="tel" required>
              <input id="tel" name="tel" required minLength={8} maxLength={20} className={inputClass} placeholder="+229..." />
            </Field>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary}>
                Ajouter
              </button>
            </div>
          </form>
        )}
        {garantMsg && <p className="mt-3 text-[12px] text-red-600">{garantMsg.text}</p>}
      </ProfileCard>

      <ProfileCard title="Déclarations détaillées" description="Assurance RC Pro, références, pièces jointes et historique complet.">
        <Link href="/declarations" className={btnSecondary}>
          Ouvrir mes déclarations
        </Link>
      </ProfileCard>
    </div>
  );
}
