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

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasRequiredGarants } from "@/lib/garant-rules";
import {
  canReachStep,
  experienceSteps,
  isSectionComplete,
  resumeStep,
  validateYears,
  type ExperienceStepKey,
} from "@/lib/experience-steps";
import { useUserIdentity } from "@/components/user-identity";
import { QualificationPicker } from "@/components/profile/tabs/QualificationPicker";
import { PortfolioEditor } from "@/components/profile/PortfolioEditor";
import { countryName, diplomaCountryGroups } from "@/lib/world-countries";

// Année d'obtention : de l'année en cours à 1950 (borne du schéma serveur).
const DIPLOMA_YEARS = Array.from({ length: new Date().getFullYear() - 1949 }, (_, i) => String(new Date().getFullYear() - i));
const DIPLOMA_COUNTRY_GROUPS = diplomaCountryGroups();
import {
  Field,
  ProfileCard,
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
  location?: string | null;
  institution: string | null;
  specialty?: string | null;
  country?: string | null;
  isStateIssued: boolean;
};

type DeclaredReference = {
  kind: string;
  nom: string;
  prenom: string | null;
  tel: string | null;
  email: string | null;
  lien: string | null;
};

type DeclaredExperience = {
  id: string;
  clientType: string;
  role: string;
  clientName: string | null;
  startDate: string | null;
  endDate: string | null;
  domain: string | null;
  description: string | null;
  technologies?: string | null;
  projectUrl?: string | null;
  livrables?: string | null;
  references?: DeclaredReference[];
};

// Plafond du schéma serveur (`declarationSchema.experiences`, src/lib/validation.ts).
const MAX_EXPERIENCES = 20;

// ── Déclaration = ÉTAT COMPLET, pas un ajout (2026-11-07) ──────────────────────────────────
// GET /api/declarations ne renvoie que la déclaration la PLUS RÉCENTE par type : c'est elle
// qui fait foi (l'historique reste consultable, une correction crée une nouvelle déclaration).
// « Ajouter » ne postait QUE la nouvelle ligne — la deuxième expérience effaçait donc la
// première de l'affichage, du barème et du profil public. Chaque ajout redéclare désormais
// l'ensemble : les lignes existantes, telles que le serveur les a scellées, plus la nouvelle.
// C'est déjà ce que fait /declarations, qui envoie toujours la liste entière.
const orUndef = (v: string | null | undefined) => (v ? v : undefined);

function experiencePayload(existing: DeclaredExperience[], added: Record<string, string | undefined>) {
  // `id` = indice CLIENT (1, 2, …) : la route s'en sert pour rattacher chaque personne
  // ressource à SON expérience (declaredReferenceSchema.experienceId). Les renvoyer avec les
  // lignes existantes évite de perdre « qui atteste de quoi ».
  const experiences = [
    ...existing.map((xp, i) => ({
      id: i + 1,
      clientType: xp.clientType === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
      clientName: orUndef(xp.clientName),
      role: xp.role,
      domain: orUndef(xp.domain),
      description: orUndef(xp.description),
      startDate: orUndef(xp.startDate),
      endDate: orUndef(xp.endDate),
      technologies: orUndef(xp.technologies),
      projectUrl: orUndef(xp.projectUrl),
      livrables: orUndef(xp.livrables),
    })),
    { id: existing.length + 1, ...added },
  ];
  const references = existing.flatMap((xp, i) =>
    (xp.references ?? []).map((r) => ({
      experienceId: i + 1,
      kind: r.kind === "secondary" || r.kind === "cross" ? r.kind : "primary",
      nom: r.nom,
      prenom: orUndef(r.prenom),
      tel: orUndef(r.tel),
      email: orUndef(r.email),
      lien: orUndef(r.lien),
    })),
  );
  return { experiences, references };
}

/**
 * Message d'échec de POST /api/declarations (2026-11-07). Un « Échec de l'enregistrement »
 * unique ne disait pas si la faute venait d'une valeur saisie ou du serveur — la seconde ne se
 * corrige pas en retouchant le formulaire.
 */
function declarationErrorMessage(body: { error?: string }, status: number, what: string): string {
  if (body.error === "profile_required") return "Enregistrez d'abord votre métier principal (onglet Domaines).";
  if (body.error === "unauthenticated" || status === 401) return "Votre session a expiré — reconnectez-vous puis réessayez.";
  if (body.error === "invalid_payload") return `Une valeur saisie n'est pas acceptée : vérifiez ${what} puis réessayez.`;
  if (status >= 500) return `Erreur serveur : ${what} n'a pas été enregistré${what === "l'expérience" ? "e" : ""}. Réessayez dans un instant.`;
  return "Échec de l'enregistrement. Réessayez.";
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 2022-03 » → « mars 2022 » ; valeur inattendue rendue telle quelle. */
function formatMonth(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function formatPeriod(start: string | null, end: string | null): string | null {
  const a = formatMonth(start);
  const b = formatMonth(end);
  if (a && b) return `${a} → ${b}`;
  if (a) return `depuis ${a}`;
  if (b) return `jusqu'en ${b}`;
  return null;
}

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
  showPortfolio = true,
  onFinished,
}: {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
  onCompletionChanged: () => void;
  /** Appelé par « Valider la section », une fois toutes les étapes obligatoires faites. */
  onFinished?: () => void;
  /** Faux dans la vue « profil complet », où « Portfolio et CV » est une rubrique à part. */
  showPortfolio?: boolean;
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
  // Type de client du formulaire d'ajout : piloté, car il décide des champs affichés.
  const [xpClientType, setXpClientType] = useState<"COMPANY" | "INDIVIDUAL">("COMPANY");
  // Période saisie au sélecteur mois/année (« AAAA-MM », ou "" si non renseignée).
  const [xpStart, setXpStart] = useState("");
  const [xpEnd, setXpEnd] = useState("");
  const [xpOngoing, setXpOngoing] = useState(false);
  // Incrémenté après chaque ajout : remonte les sélecteurs mois/année, vidés avec le formulaire.
  const [xpFormKey, setXpFormKey] = useState(0);
  const [declFormKey, setDeclFormKey] = useState(0);
  // Comparaison lexicographique valable : « AAAA-MM » se trie comme une date.
  const periodInvalid = !!xpStart && !!xpEnd && !xpOngoing && xpEnd < xpStart;


  // ── Garants (personnes ressources) ────────────────────────────────────────────────────
  const [garants, setGarants] = useState<Garant[]>([]);
  const [garantsLoaded, setGarantsLoaded] = useState(false);
  const [declLoaded, setDeclLoaded] = useState(false);
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
      .catch(() => setGarants([]))
      .finally(() => setGarantsLoaded(true));
  }, []);

  // Les déclarations ne se chargent qu'une fois le profil connu : `GET /api/declarations`
  // exige un `profileId`, et sans profil il n'y a rien à lire.
  useEffect(() => {
    if (!profile?.id) {
      setDeclLoaded(true);
      return;
    }
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
      })
      .finally(() => setDeclLoaded(true));
  }, [profile?.id]);

  // ── Parcours en étapes (2026-11-09) ───────────────────────────────────────────────────
  // Une rubrique à la fois, validée avant la suivante, jusqu'à l'étape « Validation ». Les
  // règles sont celles du barème serveur (src/lib/experience-steps.ts).
  const identity = useUserIdentity();
  const steps = useMemo(
    () =>
      experienceSteps({
        declaredLevel: profile?.declaredLevel,
        declaredExperienceYears: profile?.declaredExperienceYears,
        experiencesCount: experiences.length,
        diplomasCount: diplomas.length,
        portfolioCount: profile?.portfolioUrls?.length ?? 0,
        hasCv: !!profile?.cvUrl,
        garants,
        garantRequired: identity?.garantRequired ?? false,
        showPortfolio,
      }),
    [profile, experiences.length, diplomas.length, garants, identity?.garantRequired, showPortfolio],
  );
  const [step, setStep] = useState<ExperienceStepKey | null>(null);
  const wizardRef = useRef<HTMLDivElement>(null);
  // Reprise : une fois les déclarations et les garants chargés, on ouvre la première étape
  // obligatoire non faite — ou la validation si tout est fait.
  useEffect(() => {
    if (step === null && declLoaded && garantsLoaded) setStep(resumeStep(steps));
  }, [step, declLoaded, garantsLoaded, steps]);
  const current = step ?? "niveau";
  const currentIndex = steps.findIndex((s) => s.key === current);
  const currentStep = steps[currentIndex];
  const prevStep = currentIndex > 0 ? steps[currentIndex - 1] : null;
  const nextStep = currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;
  const complete = isSectionComplete(steps);

  function goTo(key: ExperienceStepKey) {
    if (!canReachStep(steps, key)) return;
    setStep(key);
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    // Années OBLIGATOIRES (2026-11-09) : c'est le critère que compte le barème serveur ; un
    // niveau seul laissait l'étape « enregistrée » mais jamais comptée comme faite.
    const yearsCheck = validateYears(years);
    if (!yearsCheck.ok) {
      setLevelMsg({ text: yearsCheck.message, ok: false });
      return;
    }
    // Déjà enregistré tel quel : on passe à la suite sans requête.
    if (declaredLevel === (profile?.declaredLevel ?? "") && yearsCheck.value === profile?.declaredExperienceYears) {
      setLevelMsg(null);
      if (nextStep) goTo(nextStep.key);
      return;
    }
    setLevelSaving(true);
    setLevelMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declaredLevel,
        // `0` est une réponse valide (« débutant »).
        declaredExperienceYears: yearsCheck.value,
      }),
    });
    setLevelSaving(false);
    if (res.ok) {
      onSaved(await res.json());
      onCompletionChanged();
      setLevelMsg(null);
      // Étape suivante : l'étape « Niveau » est faite dès cet enregistrement.
      setStep("experiences");
      wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (periodInvalid) {
      setExpMsg({ text: "La date de fin précède la date de début.", ok: false });
      return;
    }
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setDeclSaving(true);
    setExpMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declarationType: "experience",
        ...experiencePayload(experiences, {
          clientType: form.get("clientType") === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
          clientName: (form.get("clientName") as string | null) || undefined,
          role: String(form.get("role") ?? ""),
          domain: (form.get("domain") as string | null) || undefined,
          description: (form.get("description") as string | null) || undefined,
          // Dates « AAAA-MM » (sélecteur mois/année) : les convertir en date complète
          // inventerait un jour qui n'a pas été saisi. Particulier : ni l'une ni l'autre.
          startDate: xpClientType === "COMPANY" ? xpStart || undefined : undefined,
          endDate: xpClientType === "COMPANY" && !xpOngoing ? xpEnd || undefined : undefined,
        }),
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
      setXpClientType("COMPANY");
      setXpStart("");
      setXpEnd("");
      setXpOngoing(false);
      setXpFormKey((k) => k + 1);
      onCompletionChanged();
      // Identifiant renvoyé pour que l'utilisateur voie laquelle des déclarations est la
      // dernière scellée, sans avoir à la chercher dans l'historique.
      setExpMsg({ text: `Expérience déclarée et horodatée (réf. ${String(created.id).slice(-6)}).`, ok: true });
      return;
    }
    setExpMsg({ text: declarationErrorMessage(await res.json().catch(() => ({})), res.status, "l'expérience"), ok: false });
  }

  async function addDiploma(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    if (!String(form.get("qualificationName") ?? "").trim()) {
      setDeclMsg({ text: "Choisissez ou saisissez l'intitulé.", ok: false });
      return;
    }
    setDeclSaving(true);
    setDeclMsg(null);
    const res = await fetch("/api/declarations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        declarationType: "qualification",
        // État COMPLET, comme pour les expériences (voir experiencePayload) : sans les
        // diplômes déjà déclarés, un deuxième diplôme effaçait le premier — y compris un
        // diplôme d'État, pivot du badge « Vérifié ».
        diplomes: [
          ...diplomas.map((d) => ({
            qualificationName: d.qualificationName,
            year: d.year ?? undefined,
            location: orUndef(d.location),
            institution: orUndef(d.institution),
            specialty: orUndef(d.specialty),
            country: orUndef(d.country),
            isStateIssued: d.isStateIssued,
          })),
          {
            qualificationName: form.get("qualificationName"),
            year: form.get("year") ? Number(form.get("year")) : undefined,
            country: (form.get("country") as string | null) || undefined,
            specialty: form.get("specialty") || undefined,
            // Domaine de la spécialité : classe une spécialité NOUVELLE dans le registre partagé.
            categorieId: (form.get("specialtyCategorieId") as string | null) || undefined,
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
      setDeclFormKey((k) => k + 1);
      onCompletionChanged();
      setDeclMsg({ text: "Diplôme déclaré et horodaté.", ok: true });
      return;
    }
    setDeclMsg({ text: declarationErrorMessage(await res.json().catch(() => ({})), res.status, "le titre"), ok: false });
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







      {/* Parcours en étapes : une rubrique à la fois, validée avant la suivante. */}
      <div ref={wizardRef} className="scroll-mt-20">
        <ol aria-label="Étapes de l'expérience" className="flex flex-wrap gap-2">
          {steps.map((s, i) => {
            const active = s.key === current;
            const reachable = canReachStep(steps, s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => goTo(s.key)}
                  disabled={!reachable}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "border-[#4C1D95] bg-[#4C1D95] text-white"
                      : s.done
                        ? "border-[#4C1D95]/30 bg-[#4C1D95]/5 text-[#3B1578] hover:bg-[#4C1D95]/10"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      active ? "bg-white/20" : s.done ? "bg-[#047857] text-white" : "bg-zinc-100"
                    }`}
                  >
                    {s.done && !active ? "✓" : i + 1}
                  </span>
                  {s.label}
                  {!s.required && s.key !== "validation" && <span className={active ? "text-white/70" : "text-zinc-400"}>(facultatif)</span>}
                  <span className="sr-only">{s.done ? " — faite" : s.required ? " — obligatoire" : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100" aria-hidden>
          <div className="h-full rounded-full bg-[#4C1D95] transition-all" style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-zinc-500">
          {/* « Expérience · » : distinct du compteur des étapes du profil, affiché au-dessus. */}
          Expérience · étape {currentIndex + 1} sur {steps.length}
        </p>
      </div>

      {step === null ? (
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 text-[13px] text-zinc-400">Chargement…</div>
      ) : (
        <>
          {current === "niveau" && (
      <ProfileCard title="Niveau et années d'expérience">
        <form id="xp-level-form" onSubmit={saveLevel} noValidate className="space-y-4">
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
            <Field label="Années d'expérience" htmlFor="years" required hint="0 si vous débutez.">
              <input
                id="years"
                type="number"
                min={0}
                max={60}
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className={inputClass}
                placeholder="5"
                required
              />
            </Field>
          </div>
          {levelMsg && (
            <p role={levelMsg.ok ? "status" : "alert"} className={`text-[13px] ${levelMsg.ok ? "text-emerald-700" : "text-red-600"}`}>
              {levelMsg.text}
            </p>
          )}
        </form>
      </ProfileCard>
          )}
          {current === "experiences" && (
      <ProfileCard
        title="Expériences professionnelles"
        description="Chaque ajout crée une déclaration horodatée et chaînée. Une correction crée une nouvelle déclaration, l'ancienne reste consultable."
      >
        {/* Toutes les expériences de la déclaration en vigueur, chacune dans son bandeau. */}
        {experiences.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
              {experiences.length} expérience{experiences.length > 1 ? "s" : ""} déclarée{experiences.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-2">
              {experiences.map((xp) => {
                const period = formatPeriod(xp.startDate, xp.endDate);
                const ongoing = !!xp.startDate && !xp.endDate;
                return (
                  <li key={xp.id} className="rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-[#191224]">{xp.role}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          xp.clientType === "COMPANY" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {xp.clientType === "COMPANY" ? "Entreprise" : "Particulier"}
                      </span>
                      {ongoing && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">En cours</span>
                      )}
                    </div>
                    {(xp.clientName || xp.domain || period) && (
                      <p className="mt-0.5 text-[13px] text-zinc-500">
                        {[xp.clientName, xp.domain, period].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {xp.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-zinc-600">{xp.description}</p>}
                    {(xp.references?.length ?? 0) > 0 && (
                      <p className="mt-1.5 text-[12px] text-zinc-400">
                        Attestée par {xp.references!.map((r) => [r.prenom, r.nom].filter(Boolean).join(" ")).join(", ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {experiences.length >= MAX_EXPERIENCES ? (
          <p className="text-[13px] text-zinc-500">
            Limite de {MAX_EXPERIENCES} expériences atteinte. Pour en modifier la liste, passez par{" "}
            <Link href="/declarations" className="font-medium text-[#4C1D95] underline">
              mes déclarations
            </Link>
            .
          </p>
        ) : (
        <form onSubmit={addExperience} className="space-y-4">
          {experiences.length > 0 && (
            <p className="text-[13px] font-semibold text-[#191224]">Ajouter une expérience</p>
          )}
          {/* Type de client EN TÊTE : il décide des champs qui suivent. Pour un Particulier,
              employeur et période sont retirés du formulaire (2026-11-07) — un chantier chez un
              particulier n'a ni employeur à nommer ni contrat daté. Retirés, pas seulement
              masqués : absents du FormData, ils partent `undefined` et rien n'est déclaré. */}
          <Field label="Type de client" htmlFor="clientType">
            <select
              id="clientType"
              name="clientType"
              className={inputClass}
              value={xpClientType}
              onChange={(e) => setXpClientType(e.target.value === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY")}
            >
              <option value="COMPANY">Entreprise</option>
              <option value="INDIVIDUAL">Particulier</option>
            </select>
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Poste" htmlFor="role" required>
              <input id="role" name="role" required maxLength={200} className={inputClass} placeholder="Électricien" />
            </Field>
            {/* Domaine pré-rempli avec le métier principal (onglet Domaines) : c'est le cas
                courant, et il reste modifiable. `defaultValue` : `reset()` le restaure. */}
            <Field label="Domaine" htmlFor="domain" hint={profile?.mainDomain ? "Votre métier principal, modifiable." : undefined}>
              <input
                id="domain"
                name="domain"
                maxLength={200}
                defaultValue={profile?.mainDomain ?? ""}
                className={inputClass}
                placeholder="BTP"
              />
            </Field>
            {xpClientType === "COMPANY" && (
              <>
                <Field label="Employeur / client" htmlFor="clientName">
                  <input id="clientName" name="clientName" maxLength={200} className={inputClass} placeholder="Entreprise X" />
                </Field>
                <div className="hidden sm:block" aria-hidden />
                <MonthYearField key={`start-${xpFormKey}`} id="startDate" label="Début" value={xpStart} onChange={setXpStart} />
                <div>
                  <MonthYearField
                    key={`end-${xpFormKey}`}
                    id="endDate"
                    label="Fin"
                    value={xpOngoing ? "" : xpEnd}
                    onChange={setXpEnd}
                    disabled={xpOngoing}
                    invalid={periodInvalid}
                  />
                  <label className="mt-2 flex items-center gap-2 text-[13px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={xpOngoing}
                      onChange={(e) => setXpOngoing(e.target.checked)}
                      className="accent-[#4C1D95]"
                    />
                    Expérience en cours
                  </label>
                  {periodInvalid && <p className="mt-1 text-[12px] text-red-600">La fin doit suivre le début.</p>}
                </div>
              </>
            )}
          </div>
          <Field label="Description" htmlFor="xpDescription">
            <textarea
              id="xpDescription"
              name="description"
              rows={3}
              maxLength={3000}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95] transition"
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
        )}
      </ProfileCard>
          )}
          {current === "diplomes" && (
      <ProfileCard
        title="Diplômes et certifications"
        description="Le diplôme d'État est le pivot du badge « Vérifié » : il rend une demande éligible."
      >
        {diplomas.length > 0 && (
          <ul className="mb-4 space-y-2">
            {diplomas.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-[#191224]">{d.qualificationName}</p>
                  <p className="text-[12px] text-zinc-500">
                    {[d.specialty, countryName(d.country) ?? d.institution, d.year].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                    d.isStateIssued ? "bg-[#4C1D95]/10 text-[#4C1D95]" : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {d.isStateIssued ? "Diplôme d'État" : "Déclaratif"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addDiploma} className="space-y-4">
          {diplomas.length > 0 && <p className="text-[13px] font-semibold text-[#191224]">Ajouter un diplôme ou une certification</p>}
          {/* `key` : remonté après chaque ajout, le sélecteur repart vide (type, intitulé…). */}
          <QualificationPicker key={declFormKey} metierId={profile?.metierId} mainDomain={profile?.mainDomain} />
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Liste d'années (2026-11-07) : de l'année en cours à 1950, borne basse du schéma
                serveur (declaredDiplomaSchema.year) — plus de saisie hors bornes refusée en 400. */}
            <Field label="Année d'obtention" htmlFor="year">
              <select id="year" name="year" className={inputClass} defaultValue="">
                <option value="">Sélectionner l&apos;année</option>
                {DIPLOMA_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
            {/* Pays d'obtention à la place de l'établissement (2026-11-07) — pré-réglé sur le
                pays d'intervention du profil. Les diplômes déjà déclarés gardent leur
                établissement : il est renvoyé tel quel à chaque nouvelle déclaration. */}
            <Field label="Pays d'obtention" htmlFor="diplomaCountry">
              <select id="diplomaCountry" name="country" className={inputClass} defaultValue={profile?.zonePays ?? ""}>
                <option value="">Sélectionner le pays</option>
                {DIPLOMA_COUNTRY_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>
          <button type="submit" disabled={declSaving} className={btnPrimary}>
            {declSaving ? "Enregistrement..." : "Ajouter ce titre"}
          </button>
          {declMsg && (
            <p className={`text-[12px] ${declMsg.ok ? "text-emerald-700" : "text-red-600"}`}>{declMsg.text}</p>
          )}
        </form>
      </ProfileCard>
          )}
          {current === "portfolio" && (
              <ProfileCard title="Portfolio et CV" description="Photos de réalisations, liens externes et CV au format PDF.">
          <PortfolioEditor profile={profile} onSaved={onSaved} />
        </ProfileCard>
          )}
          {current === "garants" && (
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
                      <p className="text-[13px] font-medium text-[#191224]">
                        {g.nom}
                        {g.obligatoire && <span className="ml-2 text-[11px] font-semibold text-[#4C1D95]">Obligatoire</span>}
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
          )}
          {current === "validation" && (
            <ProfileCard title="Validation de la section Expérience" description="Vérifiez chaque rubrique avant de valider.">
              <ul className="space-y-2">
                {steps
                  .filter((s) => s.key !== "validation")
                  .map((s) => (
                    <li key={s.key} className="flex items-start justify-between gap-3 rounded-xl border border-zinc-100 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            s.done ? "bg-[#047857] text-white" : s.required ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {s.done ? "✓" : s.required ? "!" : "–"}
                        </span>
                        <div>
                          <p className="text-[14px] font-medium text-[#191224]">
                            {s.label}
                            {!s.required && <span className="ml-1.5 text-[12px] font-normal text-zinc-400">facultatif</span>}
                          </p>
                          <p className={`text-[12.5px] ${s.done ? "text-zinc-500" : s.required ? "text-red-600" : "text-zinc-500"}`}>
                            {s.done ? "Complété." : (s.missing ?? "Non renseigné.")}
                          </p>
                        </div>
                      </div>
                      <button type="button" onClick={() => goTo(s.key)} className="shrink-0 text-[12.5px] font-medium text-[#4C1D95] hover:underline">
                        {s.done ? "Modifier" : "Compléter"}
                      </button>
                    </li>
                  ))}
              </ul>
              {complete ? (
                <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
                  <p className="font-semibold">Toutes les rubriques obligatoires sont complètes.</p>
                  <p className="mt-0.5">Validez la section pour passer à la suite de votre profil.</p>
                </div>
              ) : (
                <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                  Complétez les rubriques marquées « ! » pour valider la section.
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!complete}
                  onClick={() => {
                    onCompletionChanged();
                    onFinished?.();
                  }}
                  className={btnPrimary}
                >
                  Valider la section Expérience
                </button>
                <Link href="/declarations" className={btnSecondary}>
                  Déclarations détaillées (assurance, références…)
                </Link>
              </div>
            </ProfileCard>
          )}

          {/* Navigation entre les étapes */}
          {current !== "validation" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {prevStep ? (
                <button type="button" onClick={() => goTo(prevStep.key)} className={btnSecondary}>
                  ← Précédent
                </button>
              ) : (
                <span />
              )}
              <div className="flex flex-col items-end gap-1">
                {current === "niveau" ? (
                  <button type="submit" form="xp-level-form" disabled={levelSaving} className={btnPrimary}>
                    {levelSaving ? "Enregistrement..." : "Enregistrer et continuer →"}
                  </button>
                ) : (
                  nextStep && (
                    <button
                      type="button"
                      onClick={() => goTo(nextStep.key)}
                      disabled={currentStep.required && !currentStep.done}
                      className={btnPrimary}
                    >
                      {/* Libellé explicite : le profil a son propre « Continuer » (étape suivante du
                          profil) ; celui-ci mène à la sous-étape suivante de l'Expérience. */}
                      {currentStep.done || currentStep.required ? "Suivant" : "Passer"} : {nextStep.label} →
                    </button>
                  )
                )}
                {currentStep.required && !currentStep.done && current !== "niveau" && currentStep.missing && (
                  <p className="text-[12px] text-zinc-500">{currentStep.missing}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/**
 * Sélecteur mois + année produisant « AAAA-MM » — le format exigé par l'API
 * (declaredExperienceSchema). Remplace <input type="month"> (2026-11-07), qui n'existe ni
 * sous Safari ni sous Firefox : on y voyait un champ texte libre, et toute saisie autre que
 * « 2022-03 » repartait en 400. Deux listes fonctionnent partout, au clavier comme au doigt.
 */
function MonthYearField({
  id,
  label,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [year, month] = value ? value.split("-") : ["", ""];
  // Mois et année gardés séparément tant que l'un manque : la valeur n'est émise qu'entière.
  const [draft, setDraft] = useState({ year, month });
  const current = value ? { year, month } : draft;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1969 }, (_, i) => String(thisYear - i));

  function update(next: { year: string; month: string }) {
    setDraft(next);
    onChange(next.year && next.month ? `${next.year}-${next.month}` : "");
  }

  const selectClass = `${inputClass} ${invalid ? "border-red-300" : ""} disabled:bg-zinc-50 disabled:text-zinc-400`;
  return (
    <fieldset disabled={disabled}>
      <legend className="block text-[14px] font-medium text-zinc-700 mb-1.5">{label}</legend>
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <select
          id={id}
          aria-label={`${label} — mois`}
          className={selectClass}
          value={current.month}
          onChange={(e) => update({ ...current, month: e.target.value })}
        >
          <option value="">Mois</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={String(i + 1).padStart(2, "0")}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} — année`}
          className={selectClass}
          value={current.year}
          onChange={(e) => update({ ...current, year: e.target.value })}
        >
          <option value="">Année</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
