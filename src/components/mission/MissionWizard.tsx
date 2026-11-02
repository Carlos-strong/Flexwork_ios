"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PROFESSIONAL_TYPE_LABELS } from "@/lib/provider-options";
import { allowedProfessionalTypes, isProfessionalTypeAllowed } from "@/lib/secteur";
import { ATTENDANCE_VALIDATION_LABEL, RATE_UNIT_LABEL, type AttendanceValidation, type RateUnit } from "@/lib/spot-time";
import { COUNTRIES } from "@/lib/countries";
import { citiesFor } from "@/lib/cities";
import { CURRENCIES, DEFAULT_CURRENCY } from "@/lib/currencies";
import {
  MISSION_CAHIER_MAX,
  MISSION_DELAI_MAX,
  MISSION_DELAI_MIN,
  MISSION_DESCRIPTION_MAX,
  MISSION_DESCRIPTION_MIN,
  MISSION_DESCRIPTION_SAISIE_MIN,
  MISSION_MAX_CANDIDATURES_MAX,
  MISSION_TITRE_MAX,
  MISSION_TITRE_MIN,
  MISSION_TITRE_SAISIE_MIN,
} from "@/lib/mission-limits";
import { TaxonomyCascade, type TaxonomySelection } from "@/components/mission/TaxonomyCascade";
import { loadMissionDraft, saveMissionDraft, clearMissionDraft } from "@/lib/mission-draft";
import { DraftAttachments } from "@/components/mission/DraftAttachments";
import { VALIDATION_MODE_LABEL, type ValidationMode } from "@/lib/validation-mode";

// Tunnel de création de mission en quatre étapes (M2 → M6), 2026-09-23.
//
// Remplace le formulaire d'une seule page. La maquette dont il est issu portait trois erreurs
// que le code contredit, et qui ne sont donc PAS reprises ici :
//
//  1. « Taux → F2/J1/J3/J4, Devis → QUOTE, Fixe → FIXED ». `QUOTE` et `FIXED` ne sont pas des
//     modes de financement mais des valeurs de `budgetType`, et F2 est de famille `fixe`,
//     J1/J3/J4 de famille `jalon` : la table désigne toutes les familles SAUF celle du temps.
//     La dérivation réelle est l'inverse et n'est totale que pour le taux — voir
//     `derivedTimeMode` plus bas.
//  2. « Taux hebdomadaire ». Ajouté depuis (2026-09-23) : `RateUnit` porte `week` et le
//     catalogue un mode S2W. La semaine est ISO — du lundi au dimanche, indépendamment de la
//     date de début du contrat — pour qu'un relevé soit identifiable sans connaître le
//     contrat (voir `weekPeriod`).
//  3. « Supervision → nom + téléphone ». `SpotTimeTerms.siteManagerId` est une clé étrangère
//     vers un compte utilisateur, portée par le CONTRAT et non par la mission. Deux champs
//     texte ne peuvent pas la renseigner : le bloc est absent tant que ce rôle n'est pas
//     branché.

type FinancingModeOption = {
  key: string;
  label: string;
  badge: string;
  definition: string;
  available: boolean;
  usesJalons: boolean;
  fundingGranularity: "per_jalon" | "upfront";
  family: string;
  rateUnit: RateUnit | null;
};

// Formulation du geste de paiement, du point de vue du CLIENT qui va payer. Dérivée des
// primitives, jamais écrite mode par mode : un mode ajouté au catalogue hérite de la bonne
// phrase, et aucun texte ne peut se désynchroniser du comportement réel.
function paymentCadence(m: FinancingModeOption): string {
  if (m.family === "temps") {
    return "Vous séquestrez le plafond une seule fois : chaque période constatée y est prélevée, et le solde non consommé vous revient à la clôture.";
  }
  if (!m.usesJalons) return "Vous payez une seule fois, à la signature du contrat.";
  return m.fundingGranularity === "upfront"
    ? "Vous payez une seule fois : le total est séquestré d'emblée, et chaque poste validé y est prélevé."
    : "Vous financez chaque jalon séparément, au fur et à mesure de leur avancement.";
}

const PROFESSIONAL_TYPES = [
  { value: "EXPERT_DIGITAL", label: PROFESSIONAL_TYPE_LABELS.EXPERT_DIGITAL },
  { value: "EXPERT_BTP", label: PROFESSIONAL_TYPE_LABELS.EXPERT_BTP },
  { value: "ARTISAN", label: PROFESSIONAL_TYPE_LABELS.ARTISAN },
  { value: "MANOEUVRE", label: PROFESSIONAL_TYPE_LABELS.MANOEUVRE },
];

// Le niveau requis n'a de sens que pour une personne ciblée : ni pour une entreprise, ni pour
// un ciblage « Indifférent » (2026-10-06) — le champ est alors masqué et sa valeur effacée.
function levelApplies(professionalType: string): boolean {
  return professionalType !== "" && professionalType !== "EXPERT_BTP";
}

const LEVELS = ["Débutant", "Junior", "Intermédiaire", "Senior", "Expert"];

const MISSION_MODES = [
  { value: "presentiel", label: "Présentiel", hint: "Sur site, supervision possible" },
  { value: "distance", label: "À distance", hint: "Livrables numériques, aucun déplacement" },
  { value: "hybride", label: "Hybride", hint: "Sur site et à distance, à définir" },
];

// Modèle de contrat (2026-09-28) — les trois modèles du parcours, dans l'ordre où le client se
// les représente. Aucun n'est présélectionné : chacun ouvre ses propres champs (montant, taux
// et plafond, fourchette de devis) ET son propre choix de financement, qui n'ont de sens
// qu'une fois le modèle connu.
const BUDGET_TYPES = [
  { value: "FIXED", label: "Prix fixe", hint: "Vous fixez le prix ; le prestataire l'accepte ou non." },
  { value: "RATE", label: "Au temps", hint: "Vous payez le temps réellement constaté, sous un plafond." },
  { value: "QUOTE", label: "Devis", hint: "Le prix vient des devis détaillés des prestataires." },
];

// Seules unités que le schéma connaît (`enum RateUnit`), et chacune a son mode au catalogue.
const RATE_UNITS: { value: RateUnit; modeKey: string }[] = [
  { value: "hour", modeKey: "S2H" },
  { value: "day", modeKey: "S2J" },
  { value: "week", modeKey: "S2W" },
  { value: "month", modeKey: "S2M" },
];

// `CURRENCIES` et `DEFAULT_CURRENCY` viennent de `@/lib/currencies` (2026-09-23) : la liste
// était recopiée à l'identique ici, dans le profil client et dans le profil prestataire. Une
// devise ajoutée au catalogue doit apparaître partout sans être retapée trois fois.

const STEPS = ["Décrire", "Lieu et dates", "Rémunération", "Récapitulatif"];

const SAVE_ERRORS: Record<string, string> = {
  kyc_not_verified: "Votre identité doit être vérifiée avant de publier une mission.",
  professional_type_incompatible: "Ce type de professionnel ne peut pas être ciblé pour le secteur de cette catégorie.",
  budget_required_to_publish: "Le budget est obligatoire pour publier la mission (sauf en mode « Demande de devis »).",
  time_terms_required_to_publish: "Indiquez le tarif et la quantité maximale : ils fixent le plafond du contrat au temps.",
  budget_range_inverted: "Le budget minimum ne peut pas dépasser le maximum.",
  domaine_required: "Choisissez une catégorie et un métier.",
  opr_not_allowed_for_category: "Cette catégorie ne propose pas la vérification par un OPR / responsable chantier.",
  site_manager_user_not_found: "Aucun compte actif ne correspond à cet e-mail ou téléphone de responsable chantier.",
  site_manager_not_a_site_manager: "Ce compte n'est pas un compte « Responsable chantier ».",
  site_manager_invalid_site_manager: "Vous ne pouvez pas vous désigner vous-même comme responsable chantier.",
  metier_not_found: "Ce métier n'existe plus — reprenez la catégorisation.",
  metier_categorie_mismatch: "Le métier choisi n'appartient pas à cette catégorie.",
  // 400 du schéma : dire CE QUI manque plutôt que « échec de l'enregistrement ». Sans cette
  // entrée, un refus parfaitement explicite du serveur devenait un message générique.
  invalid_payload: "Certains champs ne sont pas encore remplis. Complétez le titre, la description et le métier.",
};

const emptyState = {
  titre: "",
  description: "",
  cahierDesCharges: "",
  professionalType: "",
  level: "",
  maxCandidatures: "",
  urgent: false,
  pays: "BJ",
  ville: "",
  quartier: "",
  mode: "presentiel",
  dateDebut: "",
  delaiJours: "",
  materiel: "",
  // Vérification / validation (2026-10-01) — choix explicite, sans défaut : il décide qui
  // constate le travail avant tout paiement.
  validationMode: "" as "" | ValidationMode,
  siteManagerIdentifier: "",
  budgetType: "",
  amount: "",
  budgetMin: "",
  budgetMax: "",
  timeRate: "",
  timeMaxQuantity: "",
  rateUnit: "day" as RateUnit,
  // Mode de pointage (2026-10-01) — choisi explicitement par le client, pas de défaut affiché :
  // il décide si un relevé peut être validé en partie, ce qui touche directement au paiement.
  attendanceValidation: "" as "" | "totale" | "partielle",
  maxRevisionRounds: "3",
  dateExpiration: "",
  currency: DEFAULT_CURRENCY,
};

const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

// Aperçu d'un texte long dans le récapitulatif : assez pour reconnaître ce qu'on a écrit,
// pas assez pour noyer la page.
const preview = (text: string, max = 120) =>
  text.trim().length > max ? `${text.trim().slice(0, max)}…` : text.trim();

export function MissionWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyState);
  const [taxonomy, setTaxonomy] = useState<TaxonomySelection>({ categorieId: "", categorieLabel: "", metierId: "", metierLabel: "", competences: [] });
  const [financingModes, setFinancingModes] = useState<FinancingModeOption[]>([]);
  // Seul un mode au TEMPS se pose à la publication, dérivé de l'unité de taux. Fixe ou par
  // jalons, c'est le devis du prestataire qui le propose (2026-10-01).
  const [financingModeKey, setFinancingModeKey] = useState("");
  const [kycVerified, setKycVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [published, setPublished] = useState<{ id: string; status: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [attachmentCount, setAttachmentCount] = useState(0);
  // Identifiant de brouillon, stable pour toute la durée du tunnel : il rattache les pièces
  // jointes déposées à l'étape 1 à la mission créée à l'étape 4. Restauré avec le brouillon
  // pour qu'un retour après fermeture d'onglet retrouve ses fichiers.
  const [draftId] = useState(() => loadMissionDraft()?.draftId || crypto.randomUUID());
  const hydrated = useRef(false);

  const set = useCallback(<K extends keyof typeof emptyState>(key: K, value: (typeof emptyState)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  // Changer de catégorie peut changer de secteur : un professionnel ciblé que le nouveau
  // secteur n'admet pas (artisan ou manœuvre pour une mission Digital) est remis à
  // « Indifférent » au lieu de rester sélectionné en silence. Callback stable : la cascade est
  // mémoïsée et ne doit pas se re-rendre à chaque frappe (voir TaxonomyCascade).
  const handleTaxonomy = useCallback((next: TaxonomySelection) => {
    setTaxonomy(next);
    setForm((f) => (isProfessionalTypeAllowed(next.secteur, f.professionalType) ? f : { ...f, professionalType: "", level: "" }));
  }, []);

  // Secteur choisi dans la cascade (2026-10-06). Le type de professionnel se saisit désormais
  // ENTRE le secteur et la catégorie : il doit donc être filtré par le secteur dès son choix,
  // sans attendre la catégorie — qui, une fois choisie, fait foi (`taxonomy.secteur`).
  const [secteurChoice, setSecteurChoice] = useState<string | null>(null);
  const handleSecteur = useCallback((secteur: string | null) => {
    setSecteurChoice(secteur);
    setForm((f) => (isProfessionalTypeAllowed(secteur, f.professionalType) ? f : { ...f, professionalType: "", level: "" }));
  }, []);

  // ── Chargements ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/kyc/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKycVerified(d?.kycStatus === "verifie"))
      .catch(() => {});

    // Pays et ville viennent du compte : les redemander serait une saisie en double.
    fetch("/api/profile/client")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) return;
        setForm((f) => ({
          ...f,
          pays: f.pays === "BJ" && d.user.country ? d.user.country : f.pays,
          ville: f.ville || d.user.city || "",
          // Devise par défaut = celle du profil client, comme le veut le principe. Elle
          // reste modifiable ici : une mission peut se régler dans une autre devise que
          // celle habituelle du donneur d'ordre.
          currency: d.profile?.currency ?? f.currency,
        }));
      })
      .catch(() => {});

    fetch("/api/financing-modes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setFinancingModes(d.modes);
      })
      .catch(() => {});
  }, []);

  // Restauration du brouillon local — proposée, jamais imposée.
  useEffect(() => {
    const draft = loadMissionDraft();
    hydrated.current = true;
    if (!draft) return;
    setForm((f) => ({
      ...f,
      titre: draft.titre,
      description: draft.description,
      cahierDesCharges: draft.cahierDesCharges,
      professionalType: draft.professionalType,
      level: draft.level,
      maxCandidatures: draft.maxCandidatures,
      urgent: draft.urgent,
      pays: draft.pays || f.pays,
      ville: draft.ville || f.ville,
      quartier: draft.quartier,
      mode: draft.mode || f.mode,
      dateDebut: draft.dateDebut,
      delaiJours: draft.delaiJours,
      materiel: draft.materiel,
      validationMode: draft.validationMode ?? "",
      siteManagerIdentifier: draft.siteManagerIdentifier ?? "",
      budgetType: draft.budgetType || f.budgetType,
      amount: draft.amount,
      budgetMin: draft.budgetMin,
      budgetMax: draft.budgetMax,
      timeRate: draft.timeRate,
      timeMaxQuantity: draft.timeMaxQuantity,
      attendanceValidation: draft.attendanceValidation ?? "",
      maxRevisionRounds: draft.maxRevisionRounds || "3",
      dateExpiration: draft.dateExpiration,
      currency: draft.currency || f.currency,
    }));
    setTaxonomy({
      categorieId: draft.categorieId,
      categorieLabel: draft.categorieLabel ?? "",
      metierId: draft.metierId,
      metierLabel: draft.metierLabel ?? "",
      competences: draft.competences ?? [],
      secteurLabel: draft.secteurLabel ?? "",
      secteur: draft.secteur ?? null,
      allowsOprVerification: draft.allowsOprVerification ?? false,
    });
    setStep(Math.min(Math.max(draft.step ?? 0, 0), STEPS.length - 1));
    setRestored(true);
  }, []);

  // Sauvegarde continue, DIFFÉRÉE de 600 ms. `localStorage.setItem` est synchrone et
  // sérialise tout l'état : l'écrire à chaque frappe bloquait le fil principal une trentaine
  // de fois pendant la seule saisie d'un titre. Le délai se réarme à chaque modification, si
  // bien qu'une rafale de frappes ne produit qu'une écriture, à la pause.
  //
  // `hydrated` empêche par ailleurs d'écraser le brouillon avec l'état vide du premier rendu,
  // avant que la restauration ait eu lieu.
  useEffect(() => {
    if (!hydrated.current || published) return;
    const timer = setTimeout(() => {
      saveMissionDraft({
        step,
        draftId,
        ...form,
        categorieId: taxonomy.categorieId,
        categorieLabel: taxonomy.categorieLabel,
        metierId: taxonomy.metierId,
        metierLabel: taxonomy.metierLabel,
        competences: taxonomy.competences,
        secteurLabel: taxonomy.secteurLabel,
        secteur: taxonomy.secteur,
        allowsOprVerification: taxonomy.allowsOprVerification,
        financingModeKey,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [step, form, taxonomy, financingModeKey, published, draftId]);

  // ── Dérivations ────────────────────────────────────────────────────────────────────────
  const selectedMode = useMemo(
    () => financingModes.find((m) => m.key === financingModeKey) ?? null,
    [financingModes, financingModeKey],
  );
  const isTimeMode = form.budgetType === "RATE";
  const isQuote = form.budgetType === "QUOTE";
  const unitLabel = RATE_UNIT_LABEL[form.rateUnit];
  const timeCeiling =
    Number(form.timeRate) > 0 && Number(form.timeMaxQuantity) > 0
      ? Math.round(Number(form.timeRate) * Number(form.timeMaxQuantity))
      : null;

  // Dérivation EXACTE et totale, la seule que le catalogue autorise : l'unité de taux
  // choisie désigne un et un seul mode de la famille `temps`.
  const derivedTimeMode = useMemo(
    () => RATE_UNITS.find((u) => u.value === form.rateUnit)?.modeKey ?? "S2J",
    [form.rateUnit],
  );

  // Hors taux, aucun mode n'est choisi ici : un montant fixe ou un devis peut être payé d'un
  // bloc (F2) ou par jalons (J1, J3, J4, S1), et c'est le prestataire qui le propose dans son
  // devis — le client l'accepte avec le prix (2026-10-01).
  useEffect(() => {
    setFinancingModeKey(isTimeMode ? derivedTimeMode : "");
  }, [isTimeMode, derivedTimeMode]);

  const villes = useMemo(() => citiesFor(form.pays), [form.pays]);
  // Vérification « OPR » proposée seulement si la catégorie l'autorise. Changer pour une
  // catégorie qui ne l'autorise pas efface un choix OPR devenu impossible.
  const oprAutorise = taxonomy.allowsOprVerification === true;
  useEffect(() => {
    if (!oprAutorise && form.validationMode === "opr") set("validationMode", "");
  }, [oprAutorise, form.validationMode, set]);
  const needsPlace = form.mode !== "distance";

  // ── Validation par étape ───────────────────────────────────────────────────────────────
  // Bloquer au passage d'étape plutôt qu'à la soumission : découvrir à l'étape 4 qu'il
  // manque un titre imposerait de remonter tout le tunnel.
  const stepErrors = useMemo(() => {
    const e: string[] = [];
    if (step === 0) {
      // Mêmes bornes que la route, lues depuis la même source : l'écran et le serveur ne
      // peuvent plus diverger sur ce qu'est une mission publiable.
      if (form.titre.trim().length < MISSION_TITRE_MIN) e.push(`Le titre doit faire au moins ${MISSION_TITRE_MIN} caractères.`);
      if (form.description.trim().length < MISSION_DESCRIPTION_MIN) e.push(`La description doit faire au moins ${MISSION_DESCRIPTION_MIN} caractères.`);
      if (!taxonomy.categorieId || !taxonomy.metierId) e.push("Choisissez une catégorie et un métier.");
      // Obligatoires au même titre que la catégorie et le métier : ce sont elles qui
      // alimentent `tags`, que `Profile.tags` compare par `hasSome` — une mission sans
      // compétence perd le rapprochement le plus fin.
      if (taxonomy.metierId && taxonomy.competences.length === 0) {
        e.push("Choisissez au moins une compétence recherchée.");
      }
      // Cas d'un brouillon repris après un reclassement de la catégorie : le choix enregistré
      // peut ne plus être admis par son secteur.
      if (!isProfessionalTypeAllowed(taxonomy.secteur, form.professionalType)) {
        e.push("Ce type de professionnel ne peut pas être ciblé pour une mission de ce secteur.");
      }
      // Saisie libre (entier naturel) : vide = illimité ; sinon mêmes bornes que la route.
      if (form.maxCandidatures) {
        const n = Number(form.maxCandidatures);
        if (!Number.isInteger(n) || n < 1 || n > MISSION_MAX_CANDIDATURES_MAX) {
          e.push(`Candidatures souhaitées : un nombre entier entre 1 et ${MISSION_MAX_CANDIDATURES_MAX}, ou vide pour illimité.`);
        }
      }
    }
    if (step === 1) {
      if (needsPlace && !form.ville.trim()) e.push("Indiquez la ville de la mission.");
      // Exigé uniquement quand le lieu a un sens : une mission à distance n'a pas de
      // quartier, et le réclamer bloquerait sa publication.
      if (needsPlace && !form.quartier.trim()) e.push("Indiquez le quartier de la mission.");
      if (!form.delaiJours || Number(form.delaiJours) < MISSION_DELAI_MIN) e.push("Indiquez la durée estimée, en jours.");
      else if (Number(form.delaiJours) > MISSION_DELAI_MAX) e.push(`La durée estimée ne peut pas dépasser ${MISSION_DELAI_MAX} jours.`);
      if (oprAutorise && !form.validationMode) e.push("Indiquez qui vérifie et valide : vous-même, ou un OPR / responsable chantier.");
    }
    if (step === 2) {
      if (!form.budgetType) e.push("Choisissez un modèle de contrat.");
      if (isTimeMode && !timeCeiling) e.push(`Indiquez le tarif par ${unitLabel.one} et la quantité maximale.`);
      if (isTimeMode && !form.attendanceValidation) e.push("Choisissez le mode de pointage : validation totale ou partielle des relevés.");
      if (!isTimeMode && form.budgetType === "FIXED" && !form.amount) e.push("Indiquez le montant de la mission.");
      if (isQuote && form.budgetMin && form.budgetMax && Number(form.budgetMin) > Number(form.budgetMax)) {
        e.push("Le budget minimum ne peut pas dépasser le maximum.");
      }
      if (isTimeMode && !financingModeKey) e.push("Choisissez un mode de financement.");
    }
    return e;
  }, [step, form, taxonomy, needsPlace, isTimeMode, isQuote, timeCeiling, unitLabel, financingModeKey, oprAutorise]);

  const canContinue = stepErrors.length === 0;

  // ── Le brouillon a sa PROPRE barre, plus basse ────────────────────────────────────
  //
  // Le bouton n'était désactivé que si le titre était vide : il restait donc cliquable dans
  // un état où l'enregistrement ÉCHOUAIT à coup sûr, puisque `missionSchema` exige une
  // description (≥ 10) et un métier (ou un domaine). L'utilisateur recevait « Échec de
  // l'enregistrement de la mission » pendant que l'écran lui listait les manques de la
  // PUBLICATION (50 caractères, catégorie ET métier) — deux barres différentes, et c'est la
  // plus stricte qui était montrée. Constaté en parcours réel (2026-09-23).
  //
  // On active donc sur ce que le SCHÉMA accepte réellement, jamais sur `canContinue` : un
  // brouillon est inachevé par nature, et le refuser serait le seul moyen de perdre le travail
  // que le client venait de commencer.
  const canSaveDraft =
    form.titre.trim().length >= MISSION_TITRE_SAISIE_MIN &&
    form.description.trim().length >= MISSION_DESCRIPTION_SAISIE_MIN &&
    Boolean(taxonomy.metierId);

  // ── Soumission ─────────────────────────────────────────────────────────────────────────
  async function submit(publish: boolean) {
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre: form.titre,
        description: form.description,
        cahierDesCharges: form.cahierDesCharges || undefined,
        draftId,
        categorieId: taxonomy.categorieId || undefined,
        metierId: taxonomy.metierId || undefined,
        tags: taxonomy.competences,
        professionalType: form.professionalType || undefined,
        level: (levelApplies(form.professionalType) && form.level) || undefined,
        maxCandidatures: form.maxCandidatures ? Number(form.maxCandidatures) : null,
        urgent: form.urgent,
        mode: form.mode,
        pays: needsPlace ? form.pays : undefined,
        ville: needsPlace ? form.ville || undefined : undefined,
        quartier: needsPlace ? form.quartier || undefined : undefined,
        dateDebut: form.dateDebut ? new Date(form.dateDebut).toISOString() : undefined,
        delaiJours: Math.max(1, Number(form.delaiJours) || 1),
        materiel: form.materiel || undefined,
        // Hors catégorie autorisée, le mode n'est pas proposé : la mission est en « Moi-même ».
        validationMode: oprAutorise ? form.validationMode || undefined : "client",
        siteManagerIdentifier:
          oprAutorise && form.validationMode === "opr" && form.siteManagerIdentifier.trim()
            ? form.siteManagerIdentifier.trim()
            : undefined,
        budgetType: form.budgetType,
        financingModeKey: isTimeMode && financingModeKey ? financingModeKey : undefined,
        // Seuls les champs du modèle CHOISI partent (2026-09-28). Les champs des autres modèles
        // sont masqués mais gardent leur saisie — utile si le client revient en arrière, faux
        // si on les envoyait : un montant tapé en « Prix fixe » partait avec une mission
        // passée ensuite en « Devis ».
        budget: form.budgetType === "FIXED" && form.amount ? Number(form.amount) : undefined,
        budgetMin: isQuote && form.budgetMin ? Number(form.budgetMin) : undefined,
        budgetMax: isQuote && form.budgetMax ? Number(form.budgetMax) : undefined,
        timeRate: isTimeMode && Number(form.timeRate) > 0 ? Math.round(Number(form.timeRate)) : undefined,
        timeMaxQuantity: isTimeMode && Number(form.timeMaxQuantity) > 0 ? Number(form.timeMaxQuantity) : undefined,
        attendanceValidation: isTimeMode && form.attendanceValidation ? form.attendanceValidation : undefined,
        maxRevisionRounds: isQuote ? Number(form.maxRevisionRounds || 3) : undefined,
        dateExpiration: isQuote && form.dateExpiration ? new Date(`${form.dateExpiration}T23:59:59`).toISOString() : undefined,
        // La devise était choisie à l'écran, pré-remplie depuis le profil, affichée au
        // récapitulatif… et jamais envoyée : la route retombait donc sur « XOF ». Un client
        // réglant en NGN voyait le récapitulatif annoncer NGN et la mission partir en XOF.
        currency: form.currency,
        status: publish ? "publiee" : "brouillon",
      }),
    });

    if (!res.ok) {
      setSubmitting(false);
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "financing_mode_unavailable"
          ? (data.reason ?? "Ce mode de financement n'est pas encore disponible à la publication.")
          : (SAVE_ERRORS[data.error] ?? "Échec de l'enregistrement de la mission."),
      );
      return;
    }

    const mission = await res.json();
    clearMissionDraft();
    // Publication (2026-10-06) :
    //  - publiée → page des missions publiées, avec la confirmation ;
    //  - publication retenue par les contrôles d'identité (KYC rejeté, plafond de missions non
    //    vérifiées) → la route a ENREGISTRÉ la mission en brouillon marqué « publication
    //    demandée » : retour au tableau de bord, qui explique le blocage et proposera
    //    « Publier maintenant » une fois débloquée.
    // Le bouton reste désactivé pendant la navigation (pas de double envoi).
    if (publish && mission.status === "publiee") {
      router.push(`/client/missions?publiee=${encodeURIComponent(mission.id)}`);
      return;
    }
    if (publish && mission.publicationPending === "kyc") {
      router.push("/client/dashboard?publication=kyc");
      return;
    }
    setSubmitting(false);
    setPublished({ id: mission.id, status: mission.status });
  }

  // ── Styles partagés ────────────────────────────────────────────────────────────────────
  const inputClass =
    "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const areaClass =
    "w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const labelClass = "block text-[13px] font-semibold text-zinc-700 mb-1.5";
  // Type de professionnel, intercalé dans la cascade juste après le secteur. Mémoïsé : la
  // cascade l'est aussi, et un nœud recréé à chaque frappe dans le titre la ferait se re-rendre.
  const effectiveSecteur = taxonomy.secteur ?? secteurChoice;
  const professionalTypeField = useMemo(
    () => (
      <div>
        <label htmlFor="professionalType" className={labelClass}>Type de professionnel</label>
        <select
          id="professionalType"
          value={form.professionalType}
          // Passer à « Entreprise » ou « Indifférent » masque le niveau requis : on l'efface
          // pour qu'une valeur invisible ne parte pas avec la mission.
          onChange={(e) => {
            const value = e.target.value;
            setForm((f) => ({ ...f, professionalType: value, level: levelApplies(value) ? f.level : "" }));
          }}
          className={inputClass}
        >
          <option value="">Indifférent</option>
          {PROFESSIONAL_TYPES.filter((p) => allowedProfessionalTypes(effectiveSecteur).includes(p.value)).map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {/* Préférence, pas barrière (A16) : la filière dit QUI exerce, le secteur QUEL
            travail — les deux ne se déduisent pas l'un de l'autre. */}
        <p className="text-[11px] text-zinc-400 mt-1">
          {effectiveSecteur === "digital"
            ? "Secteur Digital : seuls un prestataire indépendant ou une entreprise peuvent être ciblés."
            : "Cible le type de professionnel, sans définir le secteur ni exclure les autres profils."}
        </p>
      </div>
    ),
    [form.professionalType, effectiveSecteur, inputClass, labelClass],
  );

  const card = "bg-white rounded-2xl border border-zinc-200 shadow-sm p-6";
  const btnPrimary =
    "h-10 px-6 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition";
  const btnSecondary =
    "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 disabled:opacity-50 transition";

  // ── M6 — Confirmation ──────────────────────────────────────────────────────────────────
  if (published) {
    const isPublished = published.status === "publiee";
    return (
      <div className="min-h-screen bg-zinc-50 py-16 px-4">
        <div className="mx-auto max-w-[560px] text-center">
          <div className="text-5xl mb-4">{isPublished ? "✅" : "📝"}</div>
          <h1 className="text-[24px] font-bold text-[#0A1931]">
            {isPublished ? "Mission publiée avec succès !" : "Brouillon enregistré"}
          </h1>
          <p className="text-[14px] text-zinc-500 mt-2">
            {isPublished
              ? "Votre mission est maintenant visible par les prestataires de ce métier."
              : "Votre mission est enregistrée. Elle ne sera visible qu'une fois publiée."}
          </p>
          {/* Cette phrase n'est écrite que parce que le plafond est RÉELLEMENT appliqué
              (checkCandidatureEligibility) : sans mécanisme derrière, elle serait une
              promesse que le produit ne tient pas. */}
          {isPublished && form.maxCandidatures && (
            <p className="text-[14px] text-zinc-700 font-medium mt-1">
              Vous recevrez jusqu&apos;à {form.maxCandidatures} candidatures.
            </p>
          )}

          {isPublished && (
            <div className={`${card} mt-8 text-left`}>
              <h2 className="text-[13px] font-bold text-zinc-900 mb-3">Prochaines étapes</h2>
              <ul className="space-y-2 text-[13px] text-zinc-600">
                <li>• Recevoir des propositions des prestataires du métier</li>
                <li>• Comparer les devis reçus</li>
                <li>• Choisir un prestataire et signer le contrat</li>
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3 justify-center mt-8">
            {/* Destination : la page de la MISSION, et non `/contract`.
                Une mission vient d'être créée — aucun prestataire n'a été choisi, donc aucun
                contrat n'existe, et `/missions/[id]/contract` n'a rien à afficher. C'est aussi
                la convention du reste de l'app : la liste « Mes Missions » (MesMissions.tsx)
                pointe vers `/missions/[id]`, page qui décide elle-même quoi montrer selon le
                statut et le rôle. La page contrat reste réservée aux écrans où un contrat
                existe réellement (onglet « Contrats signés », DevisContratsSection.tsx). */}
            <Link href={`/missions/${published.id}`} className={btnPrimary + " inline-flex items-center"} style={{ textDecoration: "none" }}>
              Voir ma mission
            </Link>
            <Link href="/client/dashboard" className={btnSecondary + " inline-flex items-center"} style={{ textDecoration: "none" }}>
              Retour au tableau de bord
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto fluid-form [--fw:760px] space-y-5">
        {/* Progression */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => (step === 0 ? router.push("/client/dashboard") : setStep(step - 1))}
              className="text-[13px] text-zinc-500 hover:text-zinc-800"
            >
              ← {step === 0 ? "Tableau de bord" : STEPS[step - 1]}
            </button>
            <span className="text-[12px] font-semibold text-zinc-500">
              Étape {step + 1} sur {STEPS.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#008751] transition-all"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          <h1 className="text-[22px] font-bold text-[#0A1931] mt-4">{STEPS[step]}</h1>
        </div>

        {restored && step === 0 && (
          <div className="px-4 py-3 rounded-xl bg-[#eefaf4] border border-[#008751]/20 text-[13px] text-zinc-700 flex items-center justify-between gap-3">
            <span>Brouillon restauré — vous reprenez où vous en étiez.</span>
            <button
              type="button"
              onClick={() => {
                clearMissionDraft();
                setForm(emptyState);
                setTaxonomy({ categorieId: "", categorieLabel: "", metierId: "", metierLabel: "", competences: [] });
                setRestored(false);
                setStep(0);
              }}
              className="text-[12px] font-semibold text-[#008751] hover:underline shrink-0"
            >
              Repartir de zéro
            </button>
          </div>
        )}

        {kycVerified === false && (
          <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
            Votre identité n&apos;est pas encore vérifiée : vous pouvez publier votre mission et recevoir des candidatures.
            La vérification sera exigée avant de retenir un prestataire, de signer le contrat et de verser les fonds.
          </div>
        )}

        {error && (
          <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* ── M2 — Décrire et catégoriser ──────────────────────────────────────────── */}
        {step === 0 && (
          // Ordre de saisie (2026-10-06) : Secteur → Type de professionnel → Catégorie → Métier
          // → Compétences → Niveau requis → Titre → Description → Cahier des charges → Plans
          // et documents → Candidatures souhaitées → Urgence. On cible d'abord QUI et QUOI,
          // puis on décrit le besoin.
          <div className={`${card} space-y-5`}>
            <TaxonomyCascade
              value={taxonomy}
              onChange={handleTaxonomy}
              onSecteurChange={handleSecteur}
              inputClass={inputClass}
              labelClass={labelClass}
              afterSecteur={professionalTypeField}
            />

            {/* Niveau requis : sans objet pour une entreprise ou un ciblage « Indifférent ». */}
            {levelApplies(form.professionalType) && (
              <div className="md:w-1/2 md:pr-2">
                <label htmlFor="level" className={labelClass}>Niveau requis</label>
                <select id="level" value={form.level} onChange={(e) => set("level", e.target.value)} className={inputClass}>
                  <option value="">Indifférent</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="titre" className={labelClass}>
                Titre de la mission <span className="text-[#E8112D]">*</span>
              </label>
              <input
                id="titre"
                value={form.titre}
                onChange={(e) => set("titre", e.target.value)}
                maxLength={MISSION_TITRE_MAX}
                placeholder="Ex : Rénovation d'une salle de bain"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="description" className={labelClass}>
                Description de la mission <span className="text-[#E8112D]">*</span>
              </label>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={5}
                maxLength={MISSION_DESCRIPTION_MAX}
                placeholder={`Décrivez le besoin (${MISSION_DESCRIPTION_MIN} caractères minimum)...`}
                className={areaClass}
              />
              <p className="text-[11px] text-zinc-400 mt-1">{form.description.trim().length} / {MISSION_DESCRIPTION_MAX}</p>
            </div>

            <div>
              <label htmlFor="cahierDesCharges" className={labelClass}>
                Cahier des charges
              </label>
              <textarea
                id="cahierDesCharges"
                value={form.cahierDesCharges}
                onChange={(e) => set("cahierDesCharges", e.target.value)}
                rows={4}
                maxLength={MISSION_CAHIER_MAX}
                placeholder="Contraintes, attendus détaillés, références, accès au site..."
                className={areaClass}
              />
              {/* Honnêteté sur ce que la plateforme sait faire : l'endpoint de pièces jointes
                  existant exige une mission déjà acceptée (règle anti-travail-test gratuit
                  US-1302), il ne peut pas recevoir un cahier des charges avant création. */}
              <p className="text-[11px] text-zinc-400 mt-1">Optionnel.</p>
            </div>

            <DraftAttachments draftId={draftId} labelClass={labelClass} onCountChange={setAttachmentCount} />

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="maxCandidatures" className={labelClass}>Candidatures souhaitées</label>
                <input
                  id="maxCandidatures"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.maxCandidatures}
                  // Entier naturel saisi à la main : tout ce qui n'est pas un chiffre est ignoré.
                  onChange={(e) => set("maxCandidatures", e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 3))}
                  placeholder="Illimité"
                  className={inputClass}
                />
                {/* Le plafond EST appliqué (candidature-guard.ts, 2026-09-23) : l'ancien texte le disait
                    indicatif et induisait le client en erreur. */}
                <p className="text-[11px] text-zinc-400 mt-1">
                  Nombre entier de 1 à {MISSION_MAX_CANDIDATURES_MAX}, vide = illimité. Au-delà, la mission n&apos;accepte plus de nouvelle candidature.
                </p>
              </div>
              <div>
                <span className={labelClass}>Urgence</span>
                <div className="flex gap-2">
                  {[
                    { value: false, label: "Normale" },
                    { value: true, label: "Urgente" },
                  ].map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      onClick={() => set("urgent", o.value)}
                      aria-pressed={form.urgent === o.value}
                      className={`h-10 px-5 rounded-full text-[13px] font-medium border transition ${
                        form.urgent === o.value
                          ? "bg-[#FF7A00] border-[#FF7A00] text-white"
                          : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── M3 — Lieu, type et dates ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className={`${card} space-y-5`}>
            <div>
              <span className={labelClass}>Type de mission <span className="text-[#E8112D]">*</span></span>
              <div className="grid sm:grid-cols-3 gap-3">
                {MISSION_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => set("mode", m.value)}
                    aria-pressed={form.mode === m.value}
                    className={`p-3 rounded-xl border text-left transition ${
                      form.mode === m.value ? "border-[#008751] bg-[#008751]/[0.04]" : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <span className="block text-[13px] font-semibold text-zinc-800">{m.label}</span>
                    <span className="block text-[11px] text-zinc-400 mt-0.5">{m.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">Détermine les exigences pour les prestataires (garants, assurance).</p>
            </div>

            {/* Le lieu disparaît pour une mission à distance : réclamer un quartier n'aurait
                pas de sens et bloquerait la publication. */}
            {needsPlace && (
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="pays" className={labelClass}>Pays</label>
                  <select
                    id="pays"
                    value={form.pays}
                    onChange={(e) => {
                      set("pays", e.target.value);
                      // Changer de pays invalide la ville : « Cotonou, Sénégal » n'existe pas.
                      set("ville", "");
                    }}
                    className={inputClass}
                  >
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ville" className={labelClass}>Ville <span className="text-[#E8112D]">*</span></label>
                  {/* Liste + saisie libre : le référentiel couvre les villes principales, pas
                      toutes. Une mission à Ouidah doit rester publiable. */}
                  <input
                    id="ville"
                    list="villes"
                    value={form.ville}
                    onChange={(e) => set("ville", e.target.value)}
                    placeholder="Cotonou"
                    className={inputClass}
                  />
                  <datalist id="villes">
                    {villes.map((v) => <option key={v} value={v} />)}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="quartier" className={labelClass}>Quartier <span className="text-[#E8112D]">*</span></label>
                  <input id="quartier" value={form.quartier} onChange={(e) => set("quartier", e.target.value)} placeholder="Fidjrossè" className={inputClass} />
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dateDebut" className={labelClass}>Date de début souhaitée</label>
                <input id="dateDebut" type="date" value={form.dateDebut} onChange={(e) => set("dateDebut", e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="delaiJours" className={labelClass}>Durée estimée (jours) <span className="text-[#E8112D]">*</span></label>
                <input id="delaiJours" type="number" min={MISSION_DELAI_MIN} max={MISSION_DELAI_MAX} value={form.delaiJours} onChange={(e) => set("delaiJours", e.target.value)} placeholder="5" className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="materiel" className={labelClass}>Matériel</label>
              <select id="materiel" value={form.materiel} onChange={(e) => set("materiel", e.target.value)} className={inputClass}>
                <option value="">Non précisé</option>
                <option value="client">Fourni par le client</option>
                <option value="prestataire">À la charge du prestataire</option>
                <option value="mixte">Mixte</option>
              </select>
            </div>

            {/* Vérification / validation (2026-10-01). Proposé seulement si la catégorie choisie
                l'autorise (réglage administrateur) — sinon la mission est vérifiée par le client.
                Boutons radio : les deux modes s'excluent, une mission n'a qu'un circuit. */}
            {oprAutorise && (
            <fieldset>
              <legend className={labelClass}>Mode de vérification et de validation <span className="text-[#E8112D]">*</span></legend>
              <div className="grid md:grid-cols-2 gap-2" role="radiogroup">
                {(Object.keys(VALIDATION_MODE_LABEL) as ValidationMode[]).map((mode) => {
                  const coche = form.validationMode === mode;
                  return (
                    <label
                      key={mode}
                      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition ${
                        coche ? "border-[#008751] bg-[#008751]/[0.04]" : "border-zinc-200 hover:border-zinc-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="validationMode"
                        value={mode}
                        checked={coche}
                        onChange={() => set("validationMode", mode)}
                        className="mt-0.5 w-4 h-4 accent-[#008751]"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold text-zinc-800">{VALIDATION_MODE_LABEL[mode].label}</span>
                        <span className="block text-[11.5px] text-zinc-500 mt-0.5">{VALIDATION_MODE_LABEL[mode].definition}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {form.validationMode === "opr" && (
                <div className="mt-3 p-3 rounded-xl bg-zinc-50 border border-zinc-100">
                  <label htmlFor="siteManagerIdentifier" className={labelClass}>
                    Responsable chantier (facultatif maintenant)
                  </label>
                  <input
                    id="siteManagerIdentifier"
                    type="text"
                    value={form.siteManagerIdentifier}
                    onChange={(e) => set("siteManagerIdentifier", e.target.value)}
                    placeholder="E-mail ou téléphone de son compte Flexwork"
                    className={inputClass}
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Il doit avoir un compte « Responsable chantier ». Vous pourrez aussi le désigner après la
                    signature, mais <strong>avant de financer le séquestre</strong> : aucun paiement ne peut être
                    sécurisé tant qu&apos;aucun responsable n&apos;est désigné. Un remplacement reste possible ensuite ; il
                    est tracé au contrat et notifié au prestataire.
                  </p>
                </div>
              )}
            </fieldset>
            )}
          </div>
        )}

        {/* ── M4 — Rémunération ────────────────────────────────────────────────────── */}
        {step === 2 && (
          <div className={`${card} space-y-5`}>
            <div>
              <span className={labelClass}>Modèle de contrat <span className="text-[#E8112D]">*</span></span>
              <div className="grid sm:grid-cols-3 gap-3">
                {BUDGET_TYPES.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => set("budgetType", b.value)}
                    aria-pressed={form.budgetType === b.value}
                    className={`p-3 rounded-xl border text-left transition ${
                      form.budgetType === b.value ? "border-[#008751] bg-[#008751]/[0.04]" : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <span className="block text-[13px] font-semibold text-zinc-800">{b.label}</span>
                    <span className="block text-[11px] text-zinc-400 mt-0.5">{b.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Sous-formulaire A — Taux */}
            {isTimeMode && (
              <div className="space-y-4 p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                <div>
                  <span className={labelClass}>Type de taux</span>
                  <div className="flex flex-wrap gap-2">
                    {RATE_UNITS.map((u) => (
                      <button
                        key={u.value}
                        type="button"
                        onClick={() => set("rateUnit", u.value)}
                        aria-pressed={form.rateUnit === u.value}
                        className={`h-9 px-4 rounded-full text-[13px] font-medium border transition ${
                          form.rateUnit === u.value
                            ? "bg-[#008751] border-[#008751] text-white"
                            : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        Par {RATE_UNIT_LABEL[u.value].one}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="timeRate" className={labelClass}>Tarif par {unitLabel.one} (XOF)</label>
                    <input id="timeRate" type="number" min={1} value={form.timeRate} onChange={(e) => set("timeRate", e.target.value)} placeholder="5000" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="timeMaxQuantity" className={labelClass}>Quantité max ({unitLabel.many})</label>
                    <input id="timeMaxQuantity" type="number" min={0.5} step={0.5} value={form.timeMaxQuantity} onChange={(e) => set("timeMaxQuantity", e.target.value)} placeholder="40" className={inputClass} />
                  </div>
                  <div>
                    <span className={labelClass}>Plafond séquestré</span>
                    <div className="h-10 px-3 rounded-xl border border-zinc-200 bg-white flex items-center text-[14px] font-semibold tabular-nums">
                      {timeCeiling ? `${xof(timeCeiling)} XOF` : "—"}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Calculé : tarif × quantité maximale. Seul le temps réellement constaté sera versé, le solde vous revient.
                </p>

                {/* Mode de pointage — comment les relevés de présence seront validés. Posé ici
                    parce que le prestataire doit le connaître AVANT de candidater, comme le tarif.
                    L'outil de pointage horodaté (A12) reste à part : facultatif, après contrat,
                    avec le consentement des deux parties. */}
                <div>
                  <span className={labelClass}>Mode de pointage <span className="text-[#E8112D]">*</span></span>
                  <div className="grid md:grid-cols-2 gap-2">
                    {(Object.keys(ATTENDANCE_VALIDATION_LABEL) as AttendanceValidation[]).map((rule) => (
                      <button
                        key={rule}
                        type="button"
                        onClick={() => set("attendanceValidation", rule)}
                        aria-pressed={form.attendanceValidation === rule}
                        className={`p-3 rounded-xl border text-left transition bg-white ${
                          form.attendanceValidation === rule ? "border-[#008751] bg-[#008751]/[0.04]" : "border-zinc-200 hover:border-zinc-300"
                        }`}
                      >
                        <span className="block text-[13px] font-semibold text-zinc-800">{ATTENDANCE_VALIDATION_LABEL[rule].label}</span>
                        <span className="block text-[11px] text-zinc-500 mt-0.5">{ATTENDANCE_VALIDATION_LABEL[rule].definition}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Sous-formulaire B — Demande de devis */}
            {form.budgetType === "QUOTE" && (
              <div className="space-y-4 p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="budgetMin" className={labelClass}>Budget indicatif min (XOF)</label>
                    <input id="budgetMin" type="number" min={500} step={500} value={form.budgetMin} onChange={(e) => set("budgetMin", e.target.value)} placeholder="400000" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="budgetMax" className={labelClass}>Budget indicatif max (XOF)</label>
                    <input id="budgetMax" type="number" min={500} step={500} value={form.budgetMax} onChange={(e) => set("budgetMax", e.target.value)} placeholder="900000" className={inputClass} />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="maxRevisionRounds" className={labelClass}>Tours de négociation</label>
                    <input id="maxRevisionRounds" type="number" min={1} max={20} value={form.maxRevisionRounds} onChange={(e) => set("maxRevisionRounds", e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="dateExpiration" className={labelClass}>Date limite de devis</label>
                    <input id="dateExpiration" type="date" value={form.dateExpiration} onChange={(e) => set("dateExpiration", e.target.value)} className={inputClass} />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  La fourchette est indicative : elle oriente les propositions sans engager de prix.
                </p>
              </div>
            )}

            {/* Sous-formulaire C — Montant fixe */}
            {form.budgetType === "FIXED" && (
              <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-100">
                <label htmlFor="amount" className={labelClass}>Montant (XOF) <span className="text-[#E8112D]">*</span></label>
                {/* `min` aligné sur `step` : un minimum qui n'est pas un multiple du pas rend
                    la valeur inatteignable pour la validation native du navigateur, et la
                    soumission échouait silencieusement. */}
                <input id="amount" type="number" min={500} step={500} value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="450000" className={inputClass} />
              </div>
            )}

            {/* Rien d'autre tant que le modèle n'est pas choisi : la devise et le financement
                dépendent de lui (un contrat au temps n'a qu'un mode possible). */}
            {!form.budgetType ? (
              <p className="text-[12px] text-zinc-400 px-3 py-2.5 rounded-xl border border-dashed border-zinc-200">
                Choisissez un modèle de contrat pour afficher ses paramètres.
              </p>
            ) : (
            <>
            <div className="md:w-1/2">
              <label htmlFor="currency" className={labelClass}>Devise</label>
              <select id="currency" value={form.currency} onChange={(e) => set("currency", e.target.value)} className={inputClass}>
                {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <p className="text-[11px] text-zinc-400 mt-1">Pré-remplie depuis votre profil client.</p>
            </div>

            {/* Financement — dérivé pour le taux ; sinon défini par le devis du prestataire. */}
            <div>
              <span className={labelClass}>Mode de financement {isTimeMode && <span className="text-[#E8112D]">*</span>}</span>
              {isTimeMode ? (
                <div className="p-4 rounded-xl border border-[#008751] bg-[#008751]/[0.04]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-bold text-zinc-900">{selectedMode?.label ?? derivedTimeMode}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#008751] text-white font-semibold">Déterminé</span>
                  </div>
                  <p className="text-[12px] text-zinc-600">
                    Un taux par {unitLabel.one} désigne un seul mode de financement : celui qui sait le payer.
                    {selectedMode && ` ${paymentCadence(selectedMode)}`}
                  </p>
                </div>
              ) : (
                // Fixe ou par jalons : le prestataire le propose dans son devis, le client
                // l'accepte avec le prix. Le dire ici évite qu'il cherche ce choix plus loin.
                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-bold text-zinc-900">Prix fixe ou par jalons</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-600 font-semibold">Défini par le devis</span>
                  </div>
                  <p className="text-[12px] text-zinc-600">
                    Chaque prestataire indique dans son devis s&apos;il sera payé en une fois (prix fixe) ou
                    jalon par jalon. Vous comparez les devis reçus et validez ce modèle en acceptant celui
                    qui vous convient — il sera ensuite figé dans le contrat.
                  </p>
                </div>
              )}
            </div>
            </>
            )}
          </div>
        )}

        {/* ── M5 — Récapitulatif ───────────────────────────────────────────────────── */}
        {step === 3 && (
          <div className={`${card} space-y-5`}>
            <Recap title="Besoin">
              <Line label="Titre" value={form.titre} />
              <Line label="Description" value={preview(form.description)} />
              <Line
                label="Cahier des charges"
                value={[
                  form.cahierDesCharges ? preview(form.cahierDesCharges) : null,
                  attachmentCount > 0 ? `${attachmentCount} fichier(s) joint(s)` : null,
                ].filter(Boolean).join(" · ") || "—"}
              />
              {/* La catégorisation est ce que le client vient de choisir en cascade : elle
                  doit être relisible avant publication, sinon le récapitulatif ne permet pas
                  de vérifier la décision la plus structurante de l'étape 1. */}
              {/* Le secteur se lit à travers la catégorie (A16) : « Non classé » tant que
                  l'administrateur ne l'a pas rangée — jamais un secteur deviné. */}
              <Line label="Secteur" value={taxonomy.categorieId ? taxonomy.secteurLabel || "Non classé" : "—"} />
              <Line label="Catégorie" value={taxonomy.categorieLabel} />
              <Line label="Métier" value={taxonomy.metierLabel} />
              <Line label="Compétences" value={taxonomy.competences.join(", ") || "—"} />
              <Line
                label="Professionnel recherché"
                value={[form.professionalType ? PROFESSIONAL_TYPE_LABELS[form.professionalType] ?? form.professionalType : null, form.level || null].filter(Boolean).join(" — ") || "Indifférent"}
              />
              <Line label="Urgence" value={form.urgent ? "Urgente" : "Normale"} />
              <Line label="Candidatures" value={form.maxCandidatures || "Illimité"} />
            </Recap>

            <Recap title="Lieu et dates">
              <Line label="Type" value={MISSION_MODES.find((m) => m.value === form.mode)?.label ?? form.mode} />
              {needsPlace && (
                <Line
                  label="Lieu"
                  value={[COUNTRIES.find((c) => c.code === form.pays)?.name, form.ville, form.quartier].filter(Boolean).join(" — ")}
                />
              )}
              <Line label="Début" value={form.dateDebut || "Dès que possible"} />
              <Line label="Durée" value={`${form.delaiJours} jour(s)`} />
              <Line label="Matériel" value={form.materiel || "Non précisé"} />
              <Line
                label="Vérification"
                value={
                  !oprAutorise
                    ? VALIDATION_MODE_LABEL.client.label
                    : form.validationMode
                    ? form.validationMode === "opr" && form.siteManagerIdentifier.trim()
                      ? `${VALIDATION_MODE_LABEL.opr.label} — ${form.siteManagerIdentifier.trim()}`
                      : VALIDATION_MODE_LABEL[form.validationMode].label
                    : "—"
                }
              />
            </Recap>

            <Recap title="Rémunération et financement">
              <Line label="Modèle de contrat" value={BUDGET_TYPES.find((b) => b.value === form.budgetType)?.label ?? "—"} />
              {isTimeMode && <Line label="Tarif" value={`${xof(Number(form.timeRate) || 0)} ${form.currency} / ${unitLabel.one}`} />}
              {isTimeMode && <Line label="Plafond" value={timeCeiling ? `${xof(timeCeiling)} ${form.currency}` : "—"} />}
              {isTimeMode && (
                <Line
                  label="Mode de pointage"
                  value={form.attendanceValidation ? ATTENDANCE_VALIDATION_LABEL[form.attendanceValidation].label : "—"}
                />
              )}
              {form.budgetType === "FIXED" && <Line label="Montant" value={`${xof(Number(form.amount) || 0)} ${form.currency}`} />}
              {form.budgetType === "QUOTE" && (
                <Line
                  label="Budget indicatif"
                  value={form.budgetMin || form.budgetMax ? `${xof(Number(form.budgetMin) || 0)} — ${xof(Number(form.budgetMax) || 0)} ${form.currency}` : "Non précisé"}
                />
              )}
              <Line label="Financement" value={isTimeMode ? (selectedMode?.label ?? "—") : "Fixe ou par jalons — défini par le devis du prestataire"} />
              <Line label="Devise" value={CURRENCIES.find((c) => c.value === form.currency)?.label ?? form.currency} />
            </Recap>

            <div className="text-[12px] text-zinc-500 border-t border-zinc-100 pt-4">
              Publier rend la mission visible par les prestataires du métier choisi. Un brouillon reste privé et
              modifiable.
            </div>
          </div>
        )}

        {/* Erreurs d'étape — listées avant les boutons, là où l'utilisateur va cliquer. */}
        {stepErrors.length > 0 && step < 3 && (
          <ul className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900 space-y-1">
            {stepErrors.map((e) => <li key={e}>• {e}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className={btnSecondary}>
              Retour
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" disabled={!canContinue} onClick={() => setStep(step + 1)} className={btnPrimary}>
              Continuer
            </button>
          ) : (
            <button type="button" disabled={submitting} onClick={() => submit(true)} className={btnPrimary}>
              {submitting ? "Publication..." : "Publier la mission"}
            </button>
          )}
          <button
            type="button"
            disabled={submitting || !canSaveDraft}
            onClick={() => submit(false)}
            title={
              canSaveDraft
                ? undefined
                : `Un brouillon demande au moins un titre (${MISSION_TITRE_SAISIE_MIN} caractères), une description (${MISSION_DESCRIPTION_SAISIE_MIN}) et un métier.`
            }
            className={btnSecondary}
          >
            Enregistrer comme brouillon
          </button>
        </div>
      </div>
    </div>
  );
}

function Recap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[11px] uppercase tracking-widest text-zinc-400 font-bold mb-2">{title}</h2>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <dt className="text-zinc-500 w-36 shrink-0">{label}</dt>
      <dd className="text-zinc-900 font-medium break-words">{value || "—"}</dd>
    </div>
  );
}
