"use client";

/**
 * Modale « Soumettre vos preuves » — reproduction intégrale de la maquette
 * Flexwork-Modal-Prestataire-Soumission.html (2026-09-08), branchée sur les vraies données
 * du livrable : mêmes 5 catégories avec leur quota, mêmes vignettes 4/3 (aperçu, nom,
 * taille, date, « Voir » / « Supprimer »), même bloc « Avancement de votre travail »
 * (curseur + raccourcis 0/25/50/75/100 + commentaire + capture de position + attestation),
 * mêmes sous-modales d'aperçu et de confirmation de suppression, même toast.
 *
 * Remplace la modale de soumission précédente de missions/[id]/deliverable (liste de
 * pastilles par catégorie). Le composant est PUREMENT présentiel : la page reste
 * propriétaire des appels réseau (upload, retrait, progression déclarée, soumission) et
 * les passe en callbacks — même découpage que ProofCategories qu'il remplace.
 */

import { useEffect, useRef, useState } from "react";

// Les 5 catégories de la maquette, dans son ordre, avec leurs quotas et leurs libellés de
// bouton. `app` fait le lien avec les catégories réelles de l'API
// (photo|video|document|geolocation|other, voir POST .../deliverable).
//
// Quotas PAR TOUR de soumission (2026-09-08) : 10 photos / 5 vidéos / 6 documents / 1
// géolocalisation / 1 autre — relevés depuis les valeurs de la maquette (3/2/2/1/1), trop
// serrées pour un vrai chantier où un seul tour peut demander une dizaine de photos. Ils
// pilotent le compteur « N/max » de chaque catégorie, le blocage + toast « Limite atteinte »,
// et le total du pied de modale.
export const SUBMISSION_CATEGORIES: {
  key: string;
  app: string;
  label: string;
  icon: string;
  max: number;
  addLabel: string;
  accept?: string;
}[] = [
  { key: "photos", app: "photo", label: "Photos", icon: "📷", max: 10, addLabel: "+Ajouter photo", accept: "image/*" },
  { key: "videos", app: "video", label: "Vidéos", icon: "🎥", max: 5, addLabel: "+Ajouter vidéo", accept: "video/*" },
  { key: "docs", app: "document", label: "Documents", icon: "📄", max: 6, addLabel: "+Ajouter document", accept: ".pdf,.doc,.docx,.zip" },
  { key: "geo", app: "geolocation", label: "Géolocalisation", icon: "📍", max: 1, addLabel: "Capturer ma position" },
  { key: "autres", app: "other", label: "Autres", icon: "➕", max: 1, addLabel: "+Ajouter" },
];

export type SubmissionProof = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
  url: string | null;
};

// "1,8 Mo" / "856 Ko" — la maquette affiche une taille sous chaque vignette. Les preuves
// texte-seules (géolocalisation, note libre) n'ont pas de fichier : on affiche à la place
// l'information qui EXISTE (précision de la position / « note »), plutôt qu'un faux poids.
function formatSize(proof: SubmissionProof): string {
  if (typeof proof.size === "number" && proof.size > 0) {
    return proof.size >= 1024 * 1024
      ? `${(proof.size / (1024 * 1024)).toFixed(1)} Mo`
      : `${Math.max(1, Math.round(proof.size / 1024))} Ko`;
  }
  if (proof.category === "geolocation") return "Position GPS";
  return "Note";
}

// "08/09 14:27" — même format court que la maquette (jour/mois + heure).
function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseLatLng(note: string | null): { lat: number; lng: number } | null {
  if (!note) return null;
  const [latStr, lngStr] = note.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Libellé d'une preuve — nom de fichier réel, coordonnées lisibles, ou note libre.
function proofName(proof: SubmissionProof): string {
  if (proof.fileName) return proof.fileName;
  const coords = parseLatLng(proof.note);
  if (coords) return `${coords.lat.toFixed(4)}N ${coords.lng.toFixed(4)}E`;
  return proof.note ?? "Preuve";
}

export default function ProviderProofSubmissionModal({
  open,
  onClose,
  scopeLabel,
  statusLabel,
  providerName,
  providerInitials,
  proofs,
  busyCategory,
  removingId,
  error,
  declaredProgress,
  minProgress,
  onDeclaredProgressChange,
  comment,
  onCommentChange,
  geoLabel,
  attested,
  onAttestedChange,
  onAddFile,
  onCaptureGeo,
  onRemove,
  onSaveDraft,
  onSubmit,
  submitting,
  submitDisabledReason,
}: {
  open: boolean;
  onClose: () => void;
  /** « Livrable initial 1 000 XOF - Jalon 1/3 » — partie gauche du sous-titre. */
  scopeLabel: string;
  statusLabel: string;
  providerName: string;
  providerInitials: string;
  proofs: SubmissionProof[];
  /** Catégorie applicative en cours d'envoi (bouton « +Ajouter » désactivé). */
  busyCategory: string | null;
  removingId: string | null;
  error: string | null;
  declaredProgress: number;
  /** Plancher du curseur = cumul DÉJÀ CONFIRMÉ fermement par le client (le plus haut point
   *  d'étape validé). Ce qui est acquis l'est définitivement : le tour courant se déclare
   *  entre ce plancher et 100%, jamais en dessous — même règle et même calcul que le curseur
   *  « Taux d'exécution constaté sur site » côté client. Côté serveur :
   *  POST .../declare-progress → `progress_below_floor` (isAboveProgressFloor). */
  minProgress: number;
  onDeclaredProgressChange: (value: number) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  /** Dernière position capturée, telle qu'affichée dans la pastille violette. */
  geoLabel: string | null;
  attested: boolean;
  onAttestedChange: (value: boolean) => void;
  onAddFile: (appCategory: string, file: File) => void;
  onCaptureGeo: () => void;
  onRemove: (proofId: string) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Renseigné quand la soumission reste impossible malgré le formulaire complet
   *  (jalon pas encore financé, etc.) — sert de `title` au bouton désactivé. */
  submitDisabledReason?: string | null;
}) {
  // Sous-modale d'aperçu (« Voir ») et confirmation de suppression (« Supprimer ») — deux
  // états locaux, comme dans la maquette.
  const [previewing, setPreviewing] = useState<SubmissionProof | null>(null);
  const [deleting, setDeleting] = useState<SubmissionProof | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  // Échap ferme d'abord les sous-modales (aperçu / suppression), comme dans la maquette.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPreviewing(null);
      setDeleting(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const total = SUBMISSION_CATEGORIES.reduce((sum, c) => sum + c.max, 0);
  const count = proofs.length;
  // Le bouton de soumission de la maquette : au moins une preuve, un taux > 0, l'attestation
  // cochée. `submitDisabledReason` y ajoute les gardes serveur (statut du jalon).
  const canSubmit = count > 0 && declaredProgress > 0 && attested && !submitDisabledReason && !submitting;
  const today = new Date();
  const todayLabel = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()} ${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;

  const kindOf = (proof: SubmissionProof): "photo" | "video" | "doc" | "geo" | "autre" =>
    proof.category === "photo" ? "photo"
      : proof.category === "video" ? "video"
        : proof.category === "document" ? "doc"
          : proof.category === "geolocation" ? "geo"
            : "autre";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-[880px] bg-white rounded-[16px] shadow-2xl max-h-[90vh] flex flex-col overflow-hidden animate-[fadeIn_0.2s_ease]">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-7 py-5 border-b border-gray-100">
          <div className="flex gap-3">
            <div className="flex flex-col">
              <h2 className="font-fraunces text-[18px] leading-[22px] font-bold text-gray-900">Soumettre vos preuves</h2>
              <p className="text-[12px] text-gray-500 mt-1 leading-[14px]">
                {scopeLabel} -{" "}
                <span className="font-medium text-gray-700">
                  {count} preuve{count !== 1 ? "s" : ""} soumise{count !== 1 ? "s" : ""}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:flex items-center gap-2">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-[11px] font-bold text-white">
                  {providerInitials}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
              </div>
              <span className="text-[12px] font-medium text-gray-700">{providerName}</span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-[#dbeafe] text-[#1e40af] text-[11px] font-semibold">{statusLabel}</span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500"
              aria-label="Fermer"
            >
              <span className="text-[16px] leading-none">✕</span>
            </button>
          </div>
        </div>

        {/* Corps */}
        <div className="overflow-y-auto flex-1 px-5 sm:px-7 py-5 space-y-7">
          {error && (
            <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-3 text-[13px] text-[#b91c1c]">{error}</div>
          )}

          {SUBMISSION_CATEGORIES.map((cat) => {
            const items = proofs.filter((p) => p.category === cat.app);
            const isGeo = cat.key === "geo";
            const busy = busyCategory === cat.app;
            const addProof = () => {
              if (items.length >= cat.max) {
                showToast(`Limite ${cat.max} atteinte pour ${cat.label}`);
                return;
              }
              if (isGeo) onCaptureGeo();
              else fileInputs.current[cat.key]?.click();
            };
            return (
              <div className="" key={cat.key}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px]">{cat.icon}</span>
                    <span className="text-[14px] font-semibold text-gray-800">{cat.label}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                      {items.length}/{cat.max}
                    </span>
                  </div>
                  {!isGeo && (
                    <input
                      ref={(el) => { fileInputs.current[cat.key] = el; }}
                      type="file"
                      accept={cat.accept}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) onAddFile(cat.app, file);
                      }}
                    />
                  )}
                  <button
                    onClick={addProof}
                    disabled={busy}
                    className={"text-[12px] font-medium px-3 py-1.5 rounded-lg transition bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ddd6fe] disabled:opacity-50 "}
                  >
                    {busy ? "Envoi..." : cat.addLabel}
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-xl h-[84px] flex items-center justify-center text-[12px] text-gray-400 bg-white">
                    Aucune preuve {cat.label.toLowerCase()} pour le moment
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {items.map((proof) => {
                      const kind = kindOf(proof);
                      const name = proofName(proof);
                      const coords = parseLatLng(proof.note);
                      return (
                        <div
                          key={proof.id}
                          className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col animate-[fadeIn_0.25s_ease]"
                        >
                          <div className="relative w-full aspect-[4/3] overflow-hidden bg-gray-50">
                            {/* Fichier privé signé servi par une route API — pas un asset
                                optimisable par next/image. */}
                            {kind === "photo" && proof.url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={proof.url} alt={name} className="w-full h-full object-cover" />
                            )}
                            {kind === "video" && proof.url && (
                              <>
                                <video muted playsInline preload="metadata" className="w-full h-full object-cover">
                                  <source src={proof.url} type={proof.mimeType ?? undefined} />
                                </video>
                                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                                  <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow">
                                    <span className="text-[14px] ml-0.5">▶️</span>
                                  </div>
                                </div>
                                <span className="absolute bottom-1.5 right-1.5 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                                  Vidéo
                                </span>
                              </>
                            )}
                            {kind === "doc" && (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
                                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-[20px]">📄</div>
                                <span className="text-[11px] font-medium text-gray-700 truncate max-w-full">{name}</span>
                                <span className="text-[10px] text-gray-500">{formatSize(proof)}</span>
                              </div>
                            )}
                            {kind === "geo" && (
                              <div className="w-full h-full relative bg-[#f3f4f6]">
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="bg-white px-2 py-1 rounded-full shadow text-[10px] font-medium">
                                    📍 {coords ? `${coords.lat.toFixed(4)}N ${coords.lng.toFixed(4)}E` : name}
                                  </div>
                                </div>
                              </div>
                            )}
                            {kind === "autre" && (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 bg-gray-50">
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-[18px]">📎</div>
                                <span className="text-[11px] text-gray-600 truncate">{name}</span>
                              </div>
                            )}
                          </div>

                          <div className="px-2.5 py-2">
                            <div className="text-[11px] text-gray-600 truncate font-medium">{name}</div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[11px] text-gray-500">{formatSize(proof)}</span>
                              <span className="text-[11px] text-gray-400">{formatShortDate(proof.createdAt)}</span>
                            </div>
                          </div>

                          <div className="flex w-full h-9 border-t border-gray-100 mt-auto">
                            <button
                              onClick={() => setPreviewing(proof)}
                              className="w-1/2 bg-[#f3f4f6] hover:bg-gray-200 text-gray-700 text-[13px] font-medium flex items-center justify-center gap-1 transition"
                            >
                              <span>👁️</span> Voir
                            </button>
                            <button
                              onClick={() => setDeleting(proof)}
                              disabled={removingId === proof.id}
                              className="w-1/2 bg-white hover:bg-red-50 text-[#dc2626] text-[13px] font-medium flex items-center justify-center gap-1 border-l border-gray-100 transition disabled:opacity-50"
                            >
                              <span>🗑️</span> Supprimer
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="border-t border-gray-200 pt-5 mt-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="mb-5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px]">🚀</span>
                  <h3 className="text-[14px] font-bold text-gray-800">Avancement de votre travail</h3>
                </div>
                <p className="text-[12px] text-gray-500 mt-1">Indiquez votre progression réelle</p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="text-[13px] font-medium text-gray-700">Taux d&apos;exécution réalisé *</label>
                  <div className="mt-3 flex items-center gap-4">
                    <input
                      type="range"
                      min={minProgress}
                      max={100}
                      value={declaredProgress}
                      onChange={(e) => onDeclaredProgressChange(Math.max(minProgress, parseInt(e.target.value)))}
                      className="flex-1 flexwork-proof-range"
                      /* La tranche déjà validée par le client reste peinte en vert foncé :
                         elle n'est plus négociable, le curseur ne peut plus y redescendre. */
                      style={{ background: `linear-gradient(to right, #006b40 ${minProgress}%, #e5e7eb ${minProgress}%)` }}
                    />
                    <span className="text-[18px] font-bold text-[#008751] min-w-[48px] text-right">{declaredProgress}%</span>
                    <input
                      type="number"
                      min={minProgress}
                      max={100}
                      value={declaredProgress}
                      onChange={(e) => onDeclaredProgressChange(Math.min(100, Math.max(minProgress, parseInt(e.target.value) || 0)))}
                      className="w-[55px] h-9 border border-gray-200 rounded-lg text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                    />
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {[0, 25, 50, 75, 100].map((value) => {
                      // Une pastille sous le plancher désignerait une régression : elle reste
                      // visible (le prestataire voit d'où il part) mais devient inatteignable.
                      const belowFloor = value < minProgress;
                      return (
                        <button
                          key={value}
                          disabled={belowFloor}
                          title={belowFloor ? `Déjà validé par le client à ${minProgress}% — votre déclaration ne peut plus redescendre` : undefined}
                          onClick={() => onDeclaredProgressChange(value)}
                          className={`px-3 py-1 rounded-full text-[12px] font-medium border transition ${belowFloor ? "bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed line-through" : declaredProgress === value ? "bg-[#008751] text-white border-[#008751]" : "bg-white border-gray-200 text-gray-600 hover:border-[#008751] hover:text-[#008751]"}`}
                        >
                          {value}%
                        </button>
                      );
                    })}
                  </div>
                  {minProgress > 0 && (
                    <p className="mt-2 text-[12px] text-gray-500">
                      Minimum {minProgress}% — déjà validé par le client lors d&apos;un point d&apos;étape. Ce tour se déclare entre {minProgress}% et 100%.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-[13px] font-medium text-gray-700">Commentaire / Difficultés rencontrées</label>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={(e) => onCommentChange(e.target.value)}
                    placeholder="Ex. Tableau posé ce jour, câblage 50% réalisé, en attente goulottes zone TGBT, besoin accès local technique..."
                    className="mt-2 w-full border border-gray-200 rounded-xl p-3 text-[13px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] resize-none"
                  />
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-2.5">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span>📅 {todayLabel}</span>
                      {geoLabel && <span className="px-2 py-0.5 bg-[#ede9fe] text-[#6d28d9] rounded-full">{geoLabel}</span>}
                    </div>
                    <button
                      onClick={onCaptureGeo}
                      disabled={busyCategory === "geolocation"}
                      className="self-start sm:self-auto text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ddd6fe] disabled:opacity-50"
                    >
                      📍 Capturer ma position
                    </button>
                  </div>

                  <label className="flex items-start gap-2 mt-4 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={attested}
                      onChange={(e) => onAttestedChange(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#008751] focus:ring-[#008751]"
                    />
                    <span className="text-[12px] text-gray-600 leading-[16px] group-hover:text-gray-800">
                      J&apos;atteste que les preuves soumises sont réelles et prises sur site
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pied */}
        <div className="px-5 sm:px-7 py-4 border-t border-gray-200 bg-gray-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span className="text-[12px] text-gray-500">
            {count}/{total} preuves ajoutées - Taux {declaredProgress}%
          </span>
          <div className="flex gap-2.5 w-full sm:w-auto">
            <button
              onClick={() => { showToast("Brouillon enregistré"); onSaveDraft(); }}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-full border border-gray-300 bg-white text-gray-700 text-[13px] font-medium hover:bg-gray-50 transition"
            >
              Enregistrer en brouillon
            </button>
            <button
              disabled={!canSubmit}
              title={submitDisabledReason ?? undefined}
              onClick={() => { showToast(`${count} preuves soumises - En attente validation client`); onSubmit(); }}
              className={`flex-1 sm:flex-none px-5 py-2.5 rounded-full text-[13px] font-semibold flex items-center justify-center gap-1.5 transition ${canSubmit ? "bg-[#008751] text-white hover:brightness-105 shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
            >
              <span>📤</span> {submitting ? "Envoi..." : "Soumettre pour validation"}
            </button>
          </div>
        </div>
      </div>

      {/* Aperçu d'une preuve (« Voir ») */}
      {previewing && (() => {
        const kind = kindOf(previewing);
        const name = proofName(previewing);
        const coords = parseLatLng(previewing.note);
        return (
          <div className="absolute inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => setPreviewing(null)} />
            <div className="relative bg-white rounded-2xl overflow-hidden max-w-[720px] w-full shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <span className="text-[13px] font-medium truncate">{name}</span>
                <button onClick={() => setPreviewing(null)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center" aria-label="Fermer">
                  ✕
                </button>
              </div>
              <div className="bg-gray-900 flex items-center justify-center min-h-[320px]">
                {kind === "photo" && previewing.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewing.url} alt={name} className="max-h-[70vh] w-auto object-contain" />
                )}
                {kind === "video" && previewing.url && (
                  <div className="relative w-full aspect-video bg-black flex items-center justify-center">
                    <video controls className="w-full h-full object-contain">
                      <source src={previewing.url} type={previewing.mimeType ?? undefined} />
                    </video>
                  </div>
                )}
                {kind === "doc" && (
                  <div className="p-10 text-center">
                    <div className="w-20 h-20 mx-auto bg-white rounded-xl flex items-center justify-center text-[32px] mb-3">📄</div>
                    <p className="text-white text-[14px]">{name}</p>
                    <p className="text-white/60 text-[12px] mt-1">
                      {formatSize(previewing)} -{" "}
                      {previewing.url ? (
                        <a href={previewing.url} target="_blank" rel="noreferrer" className="underline">
                          Ouvrir le document ↗
                        </a>
                      ) : (
                        "Aperçu indisponible"
                      )}
                    </p>
                  </div>
                )}
                {kind === "geo" && (
                  <div className="relative w-full aspect-[4/3] bg-gray-800">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 py-1.5 rounded-full shadow text-[12px] flex items-center gap-2">
                      📍 {coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : name}
                      {coords && (
                        <a
                          href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#1e40af] font-medium"
                        >
                          Google Maps ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}
                {kind === "autre" && <div className="p-10 text-white">Fichier {name}</div>}
              </div>
              <div className="px-4 py-3 bg-gray-50 text-[11px] text-gray-500 flex justify-between">
                <span>{formatSize(previewing)}</span>
                <span>{formatShortDate(previewing.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirmation de suppression */}
      {deleting && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDeleting(null)} />
          <div className="relative w-[360px] max-w-[90vw] bg-white rounded-2xl shadow-2xl p-5 animate-[fadeIn_0.18s_ease]">
            <div className="flex gap-3">
              <div className="w-[80px] h-[60px] rounded-lg overflow-hidden bg-gray-50 shrink-0">
                {kindOf(deleting) === "photo" && deleting.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={deleting.url} alt="aperçu" className="w-full h-full object-cover" />
                )}
                {kindOf(deleting) === "video" && deleting.url && (
                  <video muted playsInline preload="metadata" className="w-full h-full object-cover opacity-80">
                    <source src={deleting.url} type={deleting.mimeType ?? undefined} />
                  </video>
                )}
                {kindOf(deleting) === "doc" && (
                  <div className="w-full h-full flex items-center justify-center text-[20px] bg-red-50">📄</div>
                )}
                {kindOf(deleting) === "geo" && (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center text-[14px]">📍</div>
                )}
                {kindOf(deleting) === "autre" && (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">📎</div>
                )}
              </div>
              <div className="flex-1">
                <h4 className="text-[13px] font-semibold text-gray-800 leading-[16px]">Voulez-vous supprimer cette preuve ?</h4>
                <p className="text-[11px] text-gray-500 mt-1 truncate">{proofName(deleting)}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDeleting(null)} className="px-4 py-2 rounded-full bg-gray-100 text-gray-700 text-[13px] font-medium hover:bg-gray-200">
                Annuler
              </button>
              <button
                onClick={() => { onRemove(deleting.id); showToast("Preuve supprimée"); setDeleting(null); }}
                className="px-4 py-2 rounded-full bg-[#dc2626] text-white text-[13px] font-medium hover:brightness-105"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-[#008751] text-white text-[13px] font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 animate-[slideUp_0.2s_ease]">
          <span>✅</span> {toast}
        </div>
      )}
    </div>
  );
}
