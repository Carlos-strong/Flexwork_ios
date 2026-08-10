"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// KYC en 4 étapes (type de pièce → recto → verso → selfie + selfie+pièce).
// Aligné sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : scan antivirus (ClamAV), watermark dynamique, AES-256,
// règle des 3 tentatives → compte SUSPENDED 30 jours.
const STEPS = ["Type de pièce", "Recto", "Verso", "Selfie + Pièce"];

const ID_TYPES = [
  { value: "CNI", label: "Carte Nationale d'Identité (CNI)" },
  { value: "PASSEPORT", label: "Passeport" },
  { value: "PERMIS", label: "Permis de conduire" },
  { value: "CIP", label: "Carte d'identité provisoire" },
];

// Messages lisibles pour chaque code d'erreur renvoyé par /api/kyc/upload — auparavant un
// seul message générique ("Vérifiez le format") s'affichait quelle que soit la cause
// réelle (numéro de pièce manquant, doublon suspecté, session expirée...), rendant le
// diagnostic impossible côté utilisateur comme côté support.
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  invalid_payload: "Format de fichier invalide ou fichier manquant (JPG, PNG, PDF, 5 Mo max).",
  id_number_required: "Le numéro de pièce est requis (retournez à l'étape 1).",
  duplicate_account_suspected: "Ce document semble déjà associé à un autre compte. Contactez le support.",
  unauthenticated: "Votre session a expiré — reconnectez-vous.",
  kyc_already_verified: "Votre identité est déjà vérifiée — aucun nouveau document n'est nécessaire.",
};

function uploadErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return UPLOAD_ERROR_MESSAGES[code] ?? `Échec de l'envoi${code ? ` (${code})` : ""}. Réessayez.`;
}

export default function KycPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // US-202 : une fois verifie, le formulaire doit disparaître — jusqu'ici /kyc affichait
  // toujours l'étape 1 par défaut, sans jamais vérifier le statut réel côté serveur
  // (POST /api/kyc/upload le refusait bien en 409, mais rien ne le disait avant ce refus).
  const [kycStatus, setKycStatus] = useState<"en_attente" | "verifie" | "rejete" | "loading">("loading");

  useEffect(() => {
    fetch("/api/kyc/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setKycStatus(data?.kycStatus ?? "en_attente"))
      .catch(() => setKycStatus("en_attente"));
  }, []);

  // Valeurs strictement alignées sur VALID_TYPES côté serveur (src/app/api/kyc/upload/route.ts)
  // — "recto"/"verso" n'y correspondent pas et faisaient échouer tout upload en 400
  // invalid_payload, bloquant le parcours dès l'étape 2.
  async function uploadDoc(type: "piece_identite_recto" | "piece_identite_verso" | "selfie" | "selfie_avec_piece", file: File) {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", file);
    // idNumber n'est lu/exigé par le serveur que pour le recto — l'envoyer aux autres
    // étapes est inoffensif (ignoré) mais inutile.
    if (type === "piece_identite_recto") formData.append("idNumber", idNumber);
    const res = await fetch("/api/kyc/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "upload_failed");
    }
  }

  async function handleFinalSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Les deux fichiers de cette étape n'étaient jamais envoyés au serveur — seul
      // /api/kyc/liveness était appelé. Un dossier "soumis" arrivait donc incomplet
      // (2 documents sur 4) côté Admin KYC, sans qu'aucune erreur ne le signale.
      const formData = new FormData(e.currentTarget);
      const selfie = formData.get("selfie") as File;
      const selfieAvecPiece = formData.get("selfie_avec_piece") as File;
      if (!selfie?.size || !selfieAvecPiece?.size) {
        setError("Sélectionnez les deux photos (selfie et selfie avec pièce).");
        setSubmitting(false);
        return;
      }

      await uploadDoc("selfie", selfie);
      await uploadDoc("selfie_avec_piece", selfieAvecPiece);
      await fetch("/api/kyc/liveness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepsCompleted: ["blink", "turn_head"] }),
      });
      router.push("/dashboard");
    } catch (err) {
      setError(uploadErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStepUpload(
    type: "piece_identite_recto" | "piece_identite_verso",
    nextStep: number,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setError(null);
    const file = new FormData(e.currentTarget).get("file") as File;
    if (!file || file.size === 0) { setError("Sélectionnez un fichier."); return; }
    setSubmitting(true);
    try {
      await uploadDoc(type, file);
      setStep(nextStep);
    } catch (err) {
      setError(uploadErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] disabled:opacity-50 disabled:cursor-not-allowed transition";
  const btnOutline = "h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition";

  if (kycStatus === "loading") {
    return <div className="min-h-screen bg-zinc-50 flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>;
  }

  // Formulaire rendu indisponible une fois vérifié — le serveur refuse déjà toute
  // resoumission (409 kyc_already_verified), ceci évite juste de le laisser deviner pourquoi.
  if (kycStatus === "verifie") {
    return (
      <div className="min-h-screen bg-zinc-50 py-10 px-4">
        <div className="mx-auto max-w-[640px]">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-100">
              <h1 className="text-[18px] font-bold text-zinc-900">Vérification d&apos;identité (KYC)</h1>
            </div>
            <div className="px-6 py-8 text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-[#f0fdf4] border border-[#bbf7d0] flex items-center justify-center text-[28px]">✓</div>
              <div className="text-[15px] font-bold text-[#166534]">Votre identité est vérifiée</div>
              <p className="text-[13px] text-zinc-500 max-w-md mx-auto">
                Aucune nouvelle soumission n&apos;est nécessaire ni possible. Vous pouvez désormais publier une mission ou candidater selon votre profil.
              </p>
              <button onClick={() => router.push("/dashboard")} className={`${btnPrimary} mt-2`}>Aller au dashboard</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto max-w-[640px] space-y-5">
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-zinc-100">
            <h1 className="text-[18px] font-bold text-zinc-900">Vérification d&apos;identité (KYC)</h1>
          </div>

          {/* Progress steps */}
          <div className="px-6 pt-5 flex gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className={`flex-1 text-center text-[11px] pb-2 border-b-2 transition ${
                i + 1 === step ? "text-[#008751] border-[#008751] font-semibold" :
                i + 1 < step ? "text-zinc-400 border-[#008751]" : "text-zinc-300 border-zinc-200"
              }`}>
                {i + 1}. {label}
              </div>
            ))}
          </div>

          <div className="px-6 py-4">
            <p className="text-[13px] text-zinc-500">
              Cette vérification est <strong>la seule que Flexwork effectue réellement</strong>.
              Sans elle, ni publication de mission ni candidature ne sont possibles.
            </p>
          </div>

          {error && (
            <div className="mx-6 mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium">{error}</div>
          )}

          {/* Step 1: Type + Numéro */}
          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); if (!idType || idNumber.length < 3) { setError("Renseignez le type et le numéro de pièce."); return; } setError(null); setStep(2); }}
              className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Type de pièce d&apos;identité <span className="text-[#E8112D]">*</span></label>
                <select required value={idType} onChange={(e) => setIdType(e.target.value)} className={inputClass}>
                  <option value="">Sélectionner</option>
                  {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Numéro de la pièce <span className="text-[#E8112D]">*</span></label>
                <input type="text" required placeholder="AB123456" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputClass} />
              </div>
              <button type="submit" className={btnPrimary}>Continuer</button>
            </form>
          )}

          {/* Step 2: Recto */}
          {step === 2 && (
            <form onSubmit={(e) => handleStepUpload("piece_identite_recto", 3, e)} className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pièce d&apos;identité — Recto <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                    + Téléverser le recto (PDF, JPG, PNG — max 5 Mo)
                  </div>
                  <input type="file" name="file" accept="image/jpeg,image/png,application/pdf" required className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className={btnOutline}>Retour</button>
                <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? "Envoi..." : "Continuer"}</button>
              </div>
            </form>
          )}

          {/* Step 3: Verso */}
          {step === 3 && (
            <form onSubmit={(e) => handleStepUpload("piece_identite_verso", 4, e)} className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pièce d&apos;identité — Verso <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                    + Téléverser le verso (PDF, JPG, PNG — max 5 Mo)
                  </div>
                  <input type="file" name="file" accept="image/jpeg,image/png,application/pdf" required className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className={btnOutline}>Retour</button>
                <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? "Envoi..." : "Continuer"}</button>
              </div>
            </form>
          )}

          {/* Step 4: Selfie */}
          {step === 4 && (
            <form onSubmit={handleFinalSubmit} className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Selfie <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                    + Téléverser le selfie (face visible, bon éclairage)
                  </div>
                  <input type="file" name="selfie" accept="image/jpeg,image/png,application/pdf" required className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Selfie avec pièce d&apos;identité <span className="text-[#E8112D]">*</span></label>
                <div className="relative">
                  <div className="p-4 border border-dashed border-zinc-300 rounded-xl text-center text-[13px] text-zinc-400 cursor-pointer hover:border-[#008751] hover:text-[#008751] transition">
                    + Téléverser le selfie + pièce d&apos;identité
                  </div>
                  <input type="file" name="selfie_avec_piece" accept="image/jpeg,image/png,application/pdf" required className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(3)} className={btnOutline}>Retour</button>
                <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? "Envoi..." : "Soumettre pour vérification"}</button>
              </div>
            </form>
          )}
        </div>

        {/* Security info — n'affirme que ce qui est réellement implémenté
            (src/lib/storage.ts) : bucket privé jamais servi statiquement, URLs signées à
            durée limitée (5 min), protection contre la traversée de chemin. Le scan
            antivirus, le watermark et le chiffrement au repos étaient annoncés ici sans
            exister dans le code — retiré plutôt que laissé comme fausse promesse sur des
            pièces d'identité. Idem pour la suspension automatique après 3 rejets : aucune
            colonne de comptage ni logique de suspension n'existe (KycDocument n'a pas de
            champ "attempts", seul un rejectionReason par décision Admin KYC). */}
        <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-2xl p-5">
          <div className="text-[14px] font-bold text-[#166534]">✓ Sécurité</div>
          <p className="text-[13px] text-zinc-600 mt-2">
            Bucket privé, jamais accessible directement — consultation uniquement via URL signée à durée limitée (5 minutes).
            OCR et détection de falsification par IA <span className="inline-flex px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 font-medium text-[10px]">V2</span>,
            scan antivirus et chiffrement au repos <span className="inline-flex px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500 font-medium text-[10px]">V2</span>
          </p>
          <p className="text-[13px] text-zinc-600 mt-1">
            Votre dossier est examiné manuellement par un Admin KYC. En cas de rejet, le motif vous est communiqué.
          </p>
        </div>
      </div>
    </div>
  );
}
