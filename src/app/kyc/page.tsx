"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, Clock, BadgeCheck, Upload, ChevronRight, ArrowLeft, Check, AlertCircle, FileCheck } from "lucide-react";

const STEPS = [
  { num: 1, id: "identite", label: "Identité", desc: "Pièce d'identité" },
  { num: 2, id: "recto", label: "Recto", desc: "Photo recto" },
  { num: 3, id: "verso", label: "Verso", desc: "Photo verso" },
  { num: 4, id: "selfie", label: "Selfie", desc: "Selfie + pièce" },
];

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

type DocType = "piece_identite_recto" | "piece_identite_verso" | "selfie" | "selfie_avec_piece";

const DOC_LABELS: Record<DocType, string> = {
  piece_identite_recto: "Pièce d'identité — Recto",
  piece_identite_verso: "Pièce d'identité — Verso",
  selfie: "Selfie",
  selfie_avec_piece: "Selfie avec pièce",
};

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function KycPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [kycStatus, setKycStatus] = useState<"en_attente" | "verifie" | "rejete" | "loading">("loading");
  // Fichier choisi dans chaque zone de dépôt, avant même l'envoi — sans ça, rien à l'écran
  // ne confirmait quel fichier avait été sélectionné avant de cliquer sur "Suivant".
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<DocType, File>>>({});
  // Documents réellement en base (GET /api/kyc/documents) — remplace l'ancien état purement
  // client qui repartait de zéro à chaque rechargement de page, alors même que des documents
  // avaient déjà été envoyés lors d'une session précédente.
  const [uploadedDocs, setUploadedDocs] = useState<
    Partial<Record<DocType, { fileName: string; size?: number; status?: "en_attente" | "verifie" | "rejete"; rejectionReason?: string | null }>>
  >({});
  // Les 4 documents sont soumis et en attente de revue admin (ni manquants, ni rejetés) —
  // distinct de kycStatus "verifie" : ici rien n'a encore été décidé.
  const [pendingReview, setPendingReview] = useState(false);

  useEffect(() => {
    const DOC_TYPES: DocType[] = ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"];

    Promise.all([
      fetch("/api/kyc/status").then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch("/api/kyc/documents").then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ]).then(([statusData, docsData]) => {
      setKycStatus(statusData?.kycStatus ?? "en_attente");

      const docs: Array<{ type: DocType; fileName: string; size: number | null; status: "en_attente" | "verifie" | "rejete"; rejectionReason: string | null }> =
        docsData?.documents ?? [];
      if (docs.length === 0) return;

      const map: typeof uploadedDocs = {};
      for (const d of docs) {
        map[d.type] = { fileName: d.fileName, size: d.size ?? undefined, status: d.status, rejectionReason: d.rejectionReason };
      }
      setUploadedDocs(map);

      // Reprend à la première étape dont le document est absent OU rejeté (à renvoyer) —
      // un document "rejeté" ne compte pas comme fait. L'admin rejette/valide tout le
      // dossier d'un coup (voir /api/admin/kyc/[userId]/decision), donc en pratique soit
      // aucun document n'est utilisable après un rejet (retour à l'étape 1), soit tous le
      // sont.
      const usable = (t: DocType) => docs.some((d) => d.type === t && d.status !== "rejete");
      if (!usable("piece_identite_recto")) return; // reste à l'étape 1 par défaut
      if (!usable("piece_identite_verso")) { setStep(3); return; }
      if (!usable("selfie") || !usable("selfie_avec_piece")) { setStep(4); return; }
      setPendingReview(true);
    });
  }, []);

  async function uploadDoc(type: DocType, file: File) {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", file);
    if (type === "piece_identite_recto") formData.append("idNumber", idNumber);
    const res = await fetch("/api/kyc/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "upload_failed");
    }
    setUploadedDocs((prev) => ({ ...prev, [type]: { fileName: file.name, size: file.size, status: "en_attente" } }));
  }

  // Feedback immédiat dès qu'un fichier est choisi dans une zone de dépôt, avant même
  // l'envoi réseau — remplace le texte générique par le nom du fichier sélectionné.
  function handleFileSelect(type: DocType, file: File | undefined) {
    setSelectedFiles((prev) => {
      const next = { ...prev };
      if (file) next[type] = file; else delete next[type];
      return next;
    });
  }

  async function handleFinalSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
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
    if (!file || file.size === 0) {
      // Retour à cette étape après un envoi déjà réussi : le <input type="file"> natif est
      // remonté vide (React démonte le bloc de l'étape quand on change de step), mais le
      // document est bien déjà envoyé — on avance simplement plutôt que de redemander le
      // fichier ou d'afficher une erreur trompeuse. Un document rejeté ne compte PAS comme
      // déjà fait : il doit être renvoyé, donc on redemande bien un fichier dans ce cas.
      if (uploadedDocs[type] && uploadedDocs[type]?.status !== "rejete") { setStep(nextStep); return; }
      setError("Sélectionnez un fichier.");
      return;
    }
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

  const inputClass = "w-full h-11 px-4 rounded-xl border border-zinc-200 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";
  const btnPrimary = "h-11 px-6 rounded-xl bg-[#008751] text-white text-[14px] font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_4px_12px_rgba(0,135,81,0.25)]";
  const btnOutline = "h-11 px-6 rounded-xl border border-zinc-200 text-[14px] font-medium text-zinc-600 hover:bg-zinc-50 active:scale-[0.98] transition-all";

  // Zone de dépôt réutilisée aux étapes 2, 3 et 4 : affiche le nom du fichier choisi dès la
  // sélection, ou — s'il n'y a rien de choisi cette session mais qu'un document existe déjà
  // en base (rechargement de page) — le vrai fichier déjà envoyé via /api/kyc/documents. Un
  // document rejeté ne compte jamais comme "déjà envoyé" : il redemande un nouveau fichier.
  function renderDropzone(type: DocType, inputName: string, accept: string, hint: string, compact = false) {
    const selected = selectedFiles[type];
    const uploaded = uploadedDocs[type];
    const usable = uploaded && uploaded.status !== "rejete";
    const displayName = selected?.name ?? (usable ? uploaded.fileName : undefined);
    return (
      <div className="relative">
        <div className={`${compact ? "p-6" : "p-8"} border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all group ${
          displayName ? "border-[#008751] bg-[#f0faf5]/50" : "border-zinc-200 hover:border-[#008751] hover:bg-[#f0faf5]/50"
        }`}>
          {displayName ? (
            <>
              <FileCheck className="w-8 h-8 text-[#008751] mx-auto mb-2" />
              <p className="text-[13px] text-[#008751] font-semibold truncate px-4">{displayName}</p>
              <p className="text-[11px] text-zinc-400 mt-1">
                {selected ? formatFileSize(selected.size) : "Déjà envoyé"} {usable ? "· ✓ envoyé" : "— cliquez pour changer"}
              </p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-zinc-300 group-hover:text-[#008751] mx-auto mb-2" />
              <p className="text-[13px] text-zinc-500 group-hover:text-[#008751] font-medium">Glisse ton fichier ici</p>
              <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>
            </>
          )}
        </div>
        <input
          type="file"
          name={inputName}
          accept={accept}
          required={!usable}
          onChange={(e) => handleFileSelect(type, e.target.files?.[0])}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>
    );
  }

  // ---- Loading ----
  if (kycStatus === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ---- Already verified ----
  if (kycStatus === "verifie") {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm max-w-[480px] w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-[#f0faf5] border-2 border-[#008751] flex items-center justify-center mx-auto mb-4">
            <BadgeCheck className="w-8 h-8 text-[#008751]" />
          </div>
          <h2 className="text-[18px] font-bold text-[#0A1931] mb-2">Identité vérifiée ✓</h2>
          <p className="text-[13px] text-zinc-500 mb-6 leading-relaxed">
            Aucune nouvelle soumission n&apos;est nécessaire. Vous pouvez désormais publier une mission ou candidater.
          </p>
          <button onClick={() => router.push("/dashboard")} className={btnPrimary}>Accéder au dashboard</button>
        </div>
      </div>
    );
  }

  // ---- Les 4 documents sont soumis, en attente de revue admin (donnée réelle : calculée
  // à partir de /api/kyc/documents, pas d'un simple flag local) ----
  if (pendingReview) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm max-w-[480px] w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-400 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-[18px] font-bold text-[#0A1931] mb-2">Dossier en cours de revue</h2>
          <p className="text-[13px] text-zinc-500 mb-6 leading-relaxed">
            Tes 4 documents ont bien été reçus. Un admin les vérifie sous 24h max — tu reçois un SMS et un email dès que c&apos;est fait.
          </p>
          <ul className="text-left space-y-1.5 mb-6">
            {(Object.entries(uploadedDocs) as [DocType, { fileName: string }][]).map(([type, doc]) => (
              <li key={type} className="flex items-center gap-2 text-[12px] text-zinc-600">
                <Check className="w-3.5 h-3.5 text-[#008751] shrink-0" />
                <span className="font-medium text-zinc-700">{DOC_LABELS[type]} :</span>
                <span className="truncate text-zinc-500">{doc.fileName}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => router.push("/dashboard")} className={btnPrimary}>Retour au dashboard</button>
        </div>
      </div>
    );
  }

  // ---- Main KYC form ----
  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-100 px-4 md:px-6 h-[56px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200">
            <ArrowLeft className="w-4 h-4 text-zinc-600" />
          </button>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-zinc-400">Tableau</span>
            <span className="text-zinc-300">/</span>
            <span className="font-semibold text-[#0A1931]">Vérification KYC</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="px-2.5 py-1 rounded-full bg-[#008751]/10 text-[#008751] font-semibold">Étape {step}/4</span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* ================================================================ */}
          {/* LEFT — Steps sidebar + Form                                       */}
          {/* ================================================================ */}
          <div className="flex-1 space-y-6">
            {/* Page title */}
            <div>
              <h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931]">Vérification KYC</h1>
              <p className="text-[13px] text-zinc-500 mt-1">Sécurise ton compte pour débloquer les paiements. 100% confidentiel.</p>
            </div>

            {/* Dossier rejeté — motif réel renvoyé par l'admin (rejectionReason), pas un
                texte générique. Les 4 documents sont alors tous rejetés ensemble (voir
                /api/admin/kyc/[userId]/decision), donc n'importe lequel porte le motif. */}
            {kycStatus === "rejete" && (
              <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">
                <div className="font-bold mb-1">Dossier rejeté</div>
                <p>
                  {Object.values(uploadedDocs).find((d) => d?.status === "rejete")?.rejectionReason
                    ?? "Aucun motif renseigné — contactez le support si besoin."}
                </p>
                <p className="mt-1 font-medium">Renvoyez vos documents ci-dessous pour une nouvelle vérification.</p>
              </div>
            )}

            {/* Steps progress */}
            <div className="flex gap-2 md:gap-3">
              {STEPS.map((s) => {
                const isActive = s.num === step;
                const isDone = s.num < step;
                return (
                  <div key={s.id} className={`flex-1 flex items-center gap-2 md:gap-3 p-3 rounded-xl border-2 transition-all ${
                    isActive ? "border-[#008751] bg-[#f0faf5]" :
                    isDone ? "border-[#008751]/30 bg-white" :
                    "border-gray-100 bg-white"
                  }`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                      isActive ? "bg-[#008751] text-white" :
                      isDone ? "bg-[#008751]/20 text-[#008751]" :
                      "bg-gray-100 text-zinc-400"
                    }`}>
                      {isDone ? <Check className="w-3.5 h-3.5" /> : s.num}
                    </div>
                    <div className="hidden sm:block min-w-0">
                      <div className={`text-[12px] font-semibold truncate ${isActive ? "text-[#008751]" : isDone ? "text-zinc-600" : "text-zinc-400"}`}>{s.label}</div>
                      <div className="text-[10px] text-zinc-400 truncate">{isDone ? "Fait" : isActive ? "En cours" : "À faire"}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fichiers déjà téléversés (données réelles via GET /api/kyc/documents, pas
                seulement l'état de la session en cours) — reste visible même en changeant
                d'étape ou en rechargeant la page. Un document rejeté est signalé en rouge
                plutôt que compté comme "envoyé". */}
            {Object.keys(uploadedDocs).length > 0 && (
              <div className="px-4 py-3 rounded-xl bg-[#f0faf5] border border-[#008751]/20">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[#008751] mb-2">
                  <BadgeCheck className="w-4 h-4" /> Fichiers téléversés ({Object.keys(uploadedDocs).length})
                </div>
                <ul className="space-y-1.5">
                  {(Object.entries(uploadedDocs) as [DocType, { fileName: string; size?: number; status?: string; rejectionReason?: string | null }][]).map(([type, doc]) => {
                    const rejected = doc.status === "rejete";
                    return (
                      <li key={type} className={`flex items-center gap-2 text-[12px] ${rejected ? "text-red-600" : "text-zinc-600"}`}>
                        {rejected ? <AlertCircle className="w-3.5 h-3.5 shrink-0" /> : <Check className="w-3.5 h-3.5 text-[#008751] shrink-0" />}
                        <span className="font-medium shrink-0">{DOC_LABELS[type]} :</span>
                        <span className="truncate">{doc.fileName}</span>
                        {doc.size != null && <span className="text-zinc-400 shrink-0">({formatFileSize(doc.size)})</span>}
                        {rejected && <span className="shrink-0 font-semibold">— rejeté, à renvoyer</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            {/* STEP 1: Type + Numéro */}
            {step === 1 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 md:px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#008751]/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-[#008751]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px] text-[#0A1931]">Pièce d&apos;identité</h3>
                    <p className="text-[12px] text-zinc-400">Étape 1 — Renseignez votre pièce</p>
                  </div>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); if (!idType || idNumber.length < 3) { setError("Renseignez le type et le numéro de pièce."); return; } setError(null); setStep(2); }}
                  className="px-5 md:px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Type de pièce</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "CNI", label: "CNI" },
                        { value: "PASSEPORT", label: "Passeport" },
                        { value: "CIP", label: "Carte consulaire" },
                      ].map((t) => (
                        <button key={t.value} type="button"
                          onClick={() => setIdType(t.value)}
                          className={`h-11 px-4 rounded-xl border-2 text-[13px] font-semibold transition-all ${
                            idType === t.value
                              ? "border-[#008751] bg-[#f0faf5] text-[#008751]"
                              : "border-gray-100 bg-white text-zinc-600 hover:border-gray-200"
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Numéro de pièce <span className="text-[#E8112D]">*</span></label>
                      <input type="text" required placeholder="B12345678" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Date d&apos;expiration</label>
                      <input type="date" className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Pays d&apos;émission</label>
                      <select className={inputClass}>
                        <option>Bénin</option><option>Togo</option><option>Sénégal</option><option>Côte d&apos;Ivoire</option><option>Nigeria</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" disabled className={btnOutline + " opacity-50"}>Précédent</button>
                    <button type="submit" className={btnPrimary + " flex items-center gap-1"}>Suivant <ChevronRight className="w-4 h-4" /></button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 2: Recto */}
            {step === 2 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 md:px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#008751]/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-[#008751]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px] text-[#0A1931]">Pièce d&apos;identité — Recto</h3>
                    <p className="text-[12px] text-zinc-400">Étape 2 — Téléversez le recto</p>
                  </div>
                </div>
                <form onSubmit={(e) => handleStepUpload("piece_identite_recto", 3, e)} className="px-5 md:px-6 py-5 space-y-4">
                  {renderDropzone("piece_identite_recto", "file", "image/jpeg,image/png,application/pdf", "JPG, PNG, PDF — max 5Mo — bien lisible")}
                  <div className="flex justify-between gap-3 pt-2">
                    <button type="button" onClick={() => setStep(1)} className={btnOutline}>Précédent</button>
                    <button type="submit" disabled={submitting} className={btnPrimary + " flex items-center gap-1"}>
                      {submitting ? "Envoi..." : <><span>Suivant</span> <ChevronRight className="w-4 h-4" /></>}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 3: Verso */}
            {step === 3 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 md:px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#008751]/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-[#008751]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px] text-[#0A1931]">Pièce d&apos;identité — Verso</h3>
                    <p className="text-[12px] text-zinc-400">Étape 3 — Téléversez le verso</p>
                  </div>
                </div>
                <form onSubmit={(e) => handleStepUpload("piece_identite_verso", 4, e)} className="px-5 md:px-6 py-5 space-y-4">
                  {renderDropzone("piece_identite_verso", "file", "image/jpeg,image/png,application/pdf", "JPG, PNG, PDF — max 5Mo")}
                  <div className="flex justify-between gap-3 pt-2">
                    <button type="button" onClick={() => setStep(2)} className={btnOutline}>Précédent</button>
                    <button type="submit" disabled={submitting} className={btnPrimary + " flex items-center gap-1"}>
                      {submitting ? "Envoi..." : <><span>Suivant</span> <ChevronRight className="w-4 h-4" /></>}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 4: Selfie */}
            {step === 4 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 md:px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#008751]/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-[#008751]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px] text-[#0A1931]">Selfie + Pièce</h3>
                    <p className="text-[12px] text-zinc-400">Étape 4 — Vérification faciale</p>
                  </div>
                </div>
                <form onSubmit={handleFinalSubmit} className="px-5 md:px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Selfie <span className="text-[#E8112D]">*</span></label>
                    {renderDropzone("selfie", "selfie", "image/jpeg,image/png", "Selfie face visible, bon éclairage", true)}
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-zinc-700 mb-1.5">Selfie avec pièce d&apos;identité <span className="text-[#E8112D]">*</span></label>
                    {renderDropzone("selfie_avec_piece", "selfie_avec_piece", "image/jpeg,image/png", "Selfie + pièce d'identité visible", true)}
                  </div>
                  <div className="flex justify-between gap-3 pt-2">
                    <button type="button" onClick={() => setStep(3)} className={btnOutline}>Précédent</button>
                    <button type="submit" disabled={submitting} className={btnPrimary}>
                      {submitting ? "Envoi en cours..." : "Soumettre pour vérification"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* ================================================================ */}
          {/* RIGHT — Info sidebar                                              */}
          {/* ================================================================ */}
          <div className="lg:w-[320px] shrink-0 space-y-4">
            {/* Pourquoi KYC */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <h4 className="font-semibold text-[14px] text-[#0A1931] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#008751]" /> Pourquoi KYC ?
                </h4>
              </div>
              <div className="px-5 py-4 space-y-3">
                {[
                  { icon: "🛡️", title: "Sécurité maximale", desc: "On protège la communauté contre la fraude" },
                  { icon: "⭐", title: "Badge Vérifié", desc: "+40% de missions si tu es vérifié" },
                  { icon: "💰", title: "Paiements débloqués", desc: "Retraits FCFA instantanés après vérif" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-lg shrink-0">{item.icon}</span>
                    <div>
                      <div className="text-[12px] font-semibold text-[#0A1931]">{item.title}</div>
                      <div className="text-[11px] text-zinc-400">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 bg-[#f0faf5] border-t border-[#008751]/10 flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#008751] shrink-0 mt-0.5" />
                <div>
                  <div className="text-[12px] font-semibold text-[#008751]">Délai de traitement</div>
                  <div className="text-[11px] text-zinc-500">Vérification humaine en 24h max. Tu reçois un SMS + email.</div>
                </div>
              </div>
            </div>

            {/* Passe vérifié */}
            <div className="bg-[#0A1931] rounded-2xl p-5 text-white">
              <div className="w-10 h-10 rounded-xl bg-[#FF7A00]/20 flex items-center justify-center mb-3">
                <BadgeCheck className="w-5 h-5 text-[#FF7A00]" />
              </div>
              <h4 className="font-semibold text-[14px] mb-2">Passe vérifié = plus de clients</h4>
              <p className="text-[12px] text-white/60 leading-relaxed">
                Les profils avec badge vert reçoivent 2.3x plus de propositions.
              </p>
            </div>

            {/* Support */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="text-[12px] font-semibold text-[#0A1931] mb-2">Besoin d&apos;aide ?</div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                💬 Chat support en Fon / Wolof / Français — réponse &lt; 5min
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
