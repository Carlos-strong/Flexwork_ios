"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const PROFESSIONAL_TYPES = [
  { value: "EXPERT_DIGITAL", label: "Expert Digital" },
  { value: "EXPERT_BTP", label: "Expert BTP / Autres" },
  { value: "ARTISAN", label: "Artisan" },
  { value: "MANOEUVRE", label: "Manœuvre" },
];

const LEVELS = ["Débutant", "Junior", "Intermédiaire", "Senior", "Expert"];

const BUDGET_TYPES = [
  { value: "FIXED", label: "Prix fixe" },
  { value: "RATE", label: "Taux (horaire/journalier)" },
  { value: "QUOTE", label: "Demande de devis" },
];

type FinancingModeOption = {
  key: string;
  label: string;
  badge: string;
  definition: string;
  available: boolean;
};

const MISSION_MODES = [
  { value: "presentiel", label: "Présentiel" },
  { value: "distance", label: "À distance" },
  { value: "hybride", label: "Hybride" },
];

// Publication de mission alignée sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : professional_type, level, budget_type, pièces jointes,
// mode brouillon + publication séparée, domaine libre.
export default function PublishMissionPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Une fois le KYC vérifié, la bannière "publication désactivée jusqu'à validation du
  // KYC" est fausse pour ce compte — /api/kyc/status (déjà exposé pour /kyc) la masque.
  // `null` = statut encore inconnu : on n'affiche RIEN tant que la réponse n'est pas là.
  // Initialiser à `false` revenait à affirmer « KYC non vérifié » par défaut, et faisait
  // clignoter l'avertissement à chaque chargement, y compris sur un compte vérifié.
  const [kycVerified, setKycVerified] = useState<boolean | null>(null);
  const [budgetType, setBudgetType] = useState("FIXED");
  // Catalogue servi par GET /api/financing-modes — jamais dupliqué en dur ici : le libellé, le
  // badge et surtout la DISPONIBILITÉ d'un mode évoluent côté serveur (src/lib/financing-modes.ts).
  const [financingModes, setFinancingModes] = useState<FinancingModeOption[]>([]);
  const [financingModeKey, setFinancingModeKey] = useState<string>("");

  useEffect(() => {
    fetch("/api/kyc/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setKycVerified(data?.kycStatus === "verifie"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/financing-modes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setFinancingModes(data.modes);
        // Présélection sur le mode par défaut du catalogue, pas sur le premier disponible :
        // l'ordre d'affichage est cosmétique, la recommandation ne l'est pas.
        setFinancingModeKey(data.defaultKey);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Deux boutons de soumission dans un seul <form> : on distingue brouillon/publication
    // via le submitter natif de l'évènement, plutôt que caster un évènement de clic en
    // évènement de formulaire (e.currentTarget n'est alors pas un <form> et fait planter
    // `new FormData` — voir le crash "Failed to construct 'FormData'" corrigé ici).
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const publish = submitter?.value === "publish";

    const form = new FormData(e.currentTarget);
    const startDate = new Date(form.get("startDate") as string);
    const endDate = new Date(form.get("endDate") as string);
    const delaiJours = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));

    // Le champ Budget n'est pas marqué `required` en HTML : un brouillon peut être
    // enregistré sans montant. Mais l'API refuse la publication sans budget tant que le
    // mode de rémunération n'est pas "QUOTE" (demande de devis) — sans ce garde-fou côté
    // client, l'utilisateur ne découvrait le problème qu'après un aller-retour réseau, via
    // un message générique "Échec de la publication." ne mentionnant pas le champ en cause.
    const amountValue = form.get("amount") as string;
    if (publish && budgetType !== "QUOTE" && !amountValue) {
      setError("Le budget est obligatoire pour publier la mission (sauf en mode \"Demande de devis\").");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre: form.get("title"),
        description: form.get("description"),
        domaine: form.get("domain"),
        mode: form.get("mode"),
        professionalType: form.get("professional_type"),
        level: form.get("level"),
        budgetType: form.get("budget_type"),
        financingModeKey: financingModeKey || undefined,
        tags: String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        budget: form.get("amount") ? Number(form.get("amount")) : undefined,
        delaiJours,
        maxRevisionRounds: Number(form.get("max_revisions") || 3),
        dateExpiration: form.get("date_expiration")
          ? new Date(`${form.get("date_expiration")}T23:59:59`).toISOString()
          : undefined,
        status: publish ? "publiee" : "brouillon",
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const messages: Record<string, string> = {
        kyc_not_verified: "Votre identité doit être vérifiée avant de publier une mission.",
        budget_required_to_publish: "Le budget est obligatoire pour publier la mission (sauf en mode \"Demande de devis\").",
        // Le serveur renvoie le motif exact (`reason`) — le préférer au libellé générique :
        // il explique ce qui manque à la plateforme pour ce mode.
        financing_mode_unavailable:
          data.reason ?? "Ce mode de financement n'est pas encore disponible à la publication.",
      };
      setError(messages[data.error] ?? "Échec de la publication.");
      return;
    }
    router.push("/client/dashboard");
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "flex-1 h-10 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center";
  const btnSecondary = "flex-1 h-10 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center";

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[700px]">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100">
            <h1 className="text-[18px] font-bold text-zinc-900">Publier une mission</h1>
          </div>

          {/* KYC info — masqué une fois le KYC vérifié, plus aucune restriction à annoncer */}
          {kycVerified === false && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px] text-zinc-700">
              <strong>KYC PENDING ?</strong> La mission peut être créée en brouillon, mais la publication reste désactivée jusqu&apos;à validation du KYC.
            </div>
          )}

          {error && (
            <div className="mx-6 mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Titre de la mission <span className="text-[#E8112D]">*</span></label>
              <input type="text" name="title" required maxLength={120} placeholder="Réfection plomberie villa" className={inputClass} />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Description <span className="text-[#E8112D]">*</span></label>
              <textarea name="description" rows={5} required minLength={50} placeholder="Décrivez le besoin (50 caractères minimum)..." className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-[14px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Type de professionnel recherché <span className="text-[#E8112D]">*</span></label>
                <select name="professional_type" required className={inputClass}>
                  <option value="">Sélectionner</option>
                  {PROFESSIONAL_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Niveau <span className="text-[#E8112D]">*</span></label>
                <select name="level" required className={inputClass}>
                  <option value="">Sélectionner</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Domaine <span className="text-[#E8112D]">*</span></label>
              <input type="text" name="domain" required placeholder="Ex : Plomberie" className={inputClass} />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Compétences requises</label>
              <input type="text" name="tags" placeholder="Ex: Soudure, Placo, Électricité BT, Plomberie" className={inputClass} />
              <p className="text-[11px] text-zinc-400 mt-1">Séparez les compétences par des virgules. Utilisé pour le matching avec les prestataires.</p>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mode de la mission <span className="text-[#E8112D]">*</span></label>
              <select name="mode" required className={inputClass}>
                {MISSION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <p className="text-[11px] text-zinc-400 mt-1">Détermine les exigences pour les prestataires (garants, assurance).</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Mode de rémunération <span className="text-[#E8112D]">*</span></label>
                <select name="budget_type" required value={budgetType} onChange={(e) => setBudgetType(e.target.value)} className={inputClass}>
                  {BUDGET_TYPES.map((bt) => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">
                  Budget (XOF) {budgetType !== "QUOTE" && <span className="text-[#E8112D]">*</span>}
                </label>
                {/* min aligné sur step (500) plutôt que 1 : un `min` qui n'est pas un multiple du
                    pas casse la validation native du navigateur (ex. min=1 + step=500 rend 450000
                    "invalide" car inatteignable depuis 1 par pas de 500) — la soumission échouait
                    alors silencieusement, avant même d'atteindre le handler onSubmit. */}
                <input type="number" name="amount" placeholder="450000" step={500} min={500} className={inputClass} />
                <p className="text-[11px] text-zinc-400 mt-1">
                  {budgetType === "QUOTE"
                    ? "Optionnel en mode devis : le prix viendra des propositions reçues."
                    : "Obligatoire pour publier. Fourchette de marché indicative affichée selon le domaine."}
                </p>
              </div>
            </div>

            {/* Mode de financement (2026-09-10) — choisi ICI, à la publication, parce qu'il dit
                au prestataire COMMENT chiffrer : un mode à jalons attend un devis découpé en
                postes livrables un à un, un mode forfaitaire attend un prix unique. L'annoncer
                à la génération du contrat arrivait après la négociation, donc trop tard. */}
            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">
                Mode de financement <span className="text-[#E8112D]">*</span>
              </label>
              <div className="space-y-2">
                {financingModes.filter((m) => m.available).map((m) => (
                  <label
                    key={m.key}
                    className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition ${
                      financingModeKey === m.key
                        ? "border-[#008751] bg-[#008751]/[0.04]"
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="financing_mode"
                      value={m.key}
                      checked={financingModeKey === m.key}
                      onChange={() => setFinancingModeKey(m.key)}
                      className="w-auto mt-0.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-[13px] text-zinc-800">{m.label}</strong>
                        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                          {m.badge}
                        </span>
                      </span>
                      <span className="block text-[12px] text-zinc-500 mt-0.5 leading-relaxed">{m.definition}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5">
                {budgetType === "QUOTE"
                  ? "Les lignes du devis reçu deviendront directement les jalons du contrat — aucune ressaisie."
                  : "En prix fixe sans devis, vous détaillerez les jalons à la génération du contrat."}
              </p>
            </div>

            {budgetType === "QUOTE" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Rounds de négociation autorisés</label>
                  <input type="number" name="max_revisions" min={1} max={20} defaultValue={3} className={inputClass} />
                  <p className="text-[11px] text-zinc-400 mt-1">Nombre maximal de révisions du devis par candidature.</p>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Date limite de devis</label>
                  <input type="date" name="date_expiration" className={inputClass} />
                  <p className="text-[11px] text-zinc-400 mt-1">Après cette date, les candidatures en négociation sont annulées.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Date de début <span className="text-[#E8112D]">*</span></label>
                <input type="date" name="startDate" required className={inputClass} />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Date de fin <span className="text-[#E8112D]">*</span></label>
                <input type="date" name="endDate" required className={inputClass} />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pièces jointes</label>
              <div className="relative">
                <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                  + Cahier des charges, plans, maquettes (max 10 fichiers)
                </div>
                <input type="file" name="attachments" multiple accept="image/jpeg,image/png,application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" />
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">Scan antivirus + stockage chiffré, accès par URL signée.</p>
            </div>

            {/* Security info */}
            <div className="px-4 py-3 rounded-xl bg-zinc-50 border border-zinc-200 text-[13px] text-zinc-600">
              <strong>Sécurité mission :</strong> CGV intégrées, smart contract simplifié, paiement séquestre (escrow) activé par défaut.
              Si le professionnel sélectionné est en VAE active, un avertissement est affiché et l&apos;escrow devient obligatoire.
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" name="action" value="draft" className={btnSecondary} disabled={submitting}>
                {submitting ? "Enregistrement..." : "Enregistrer le brouillon"}
              </button>
              <button type="submit" name="action" value="publish" className={btnPrimary} disabled={submitting}>
                Publier la mission
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
