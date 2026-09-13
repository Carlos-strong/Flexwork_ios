"use client";

/**
 * Modale « Apprécier les preuves + Constat » — reproduction intégrale de la maquette
 * Flexwork-Modal-Client-Validation-Preuve.html (2026-09-08), branchée sur les vraies preuves
 * du livrable : grille de vignettes 4/3 avec badge d'état (En attente / Validée • 100% /
 * Rejetée) et actions Valider / Rejeter par preuve, sous-modale de rejet (raison prédéfinie +
 * motif ≥ 4 caractères + « Demander nouvelle preuve »), bloc « Votre constat sur site »
 * (curseur de taux constaté + raccourcis + texte du constat + capture de position + preuves
 * de constat du client), et pied « N/M preuves appréciées • Taux site X% • K preuve(s)
 * constat ».
 *
 * Remplace la modale de décision précédente de ValidationClientView (2 colonnes,
 * récapitulatif + actions globales). Rappel de cohérence métier : il n'y a plus de bouton
 * « Rejeter » global — côté serveur, le rejet d'UNE preuve rejette déjà automatiquement la
 * soumission (voir autoRejectSubmissionOperations, src/lib/proof-appreciation.ts), donc le
 * rejet par preuve de la maquette EST le chemin de rejet. La validation finale (libération
 * des fonds) reste, elle, hors modale : elle vit sur la carte du jalon/de la mission.
 *
 * Composant PUREMENT présentiel — la vue reste propriétaire des appels réseau.
 */

import { useEffect, useRef, useState } from "react";

// Raisons de rejet — liste et libellés de la maquette, dans son ordre.
export const CLIENT_REJECT_REASONS = [
  "Non conforme CCTP",
  "Qualité insuffisante",
  "Document illisible",
  "Hors délai",
  "Localisation non vérifiée",
  "Sécurité",
  "Autre",
] as const;

// Les 4 onglets de la sous-modale « Ajouter vos preuves de constat », avec la catégorie
// applicative correspondante (voir src/lib/constat.ts).
export const CONSTAT_TABS: { label: string; category: string; accept?: string }[] = [
  { label: "Photos", category: "constat_photo", accept: "image/*" },
  { label: "Vidéos", category: "constat_video", accept: "video/*" },
  { label: "Documents", category: "constat_document", accept: ".pdf,.doc,.docx,.zip" },
  { label: "Géoloc", category: "constat_geolocation" },
];

export type ReviewProof = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
  url: string | null;
  appreciation?: string | null;
  rejectionReason?: string | null;
  rejectionMotif?: string | null;
  requestNewProof?: boolean;
};

export type ConstatProof = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
  url: string | null;
};

export type RejectPayload = { reason: string; motif: string; requestNewProof: boolean };

// Libellé de catégorie affiché sous chaque vignette (« 2,3 Mo • Photos »).
const CATEGORY_LABEL: Record<string, string> = {
  photo: "Photos",
  video: "Vidéos",
  document: "Documents",
  geolocation: "Géolocalisation",
  other: "Autres",
};

function formatSize(size: number | null | undefined, fallback: string): string {
  if (typeof size === "number" && size > 0) {
    return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(size / 1024))} Ko`;
  }
  return fallback;
}

function parseLatLng(note: string | null): { lat: number; lng: number } | null {
  if (!note) return null;
  const [latStr, lngStr] = note.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function proofName(proof: { fileName: string | null; note: string | null }): string {
  if (proof.fileName) return proof.fileName;
  const coords = parseLatLng(proof.note);
  if (coords) return `${coords.lat.toFixed(4)}N ${coords.lng.toFixed(4)}E`;
  return proof.note ?? "Preuve";
}

export default function ClientProofValidationModal({
  open,
  onClose,
  scopeLabel,
  statusLabel,
  clientName,
  clientInitials,
  providerName,
  providerInitials,
  proofs,
  appreciableIds,
  busyProofId,
  error,
  observedProgress,
  minProgress,
  onObservedProgressChange,
  constatText,
  onConstatTextChange,
  geoLabel,
  onCaptureGeo,
  constatProofs,
  constatBusyCategory,
  onAddConstatFile,
  onRemoveConstat,
  attested,
  onAttestedChange,
  onValidateProof,
  onRejectProof,
  onCancelReject,
  onSave,
  saving,
  saveDisabledReason,
}: {
  open: boolean;
  onClose: () => void;
  /** Pastille grise à droite du titre — « Livrable initial » dans la maquette. */
  scopeLabel: string;
  statusLabel: string;
  clientName: string;
  clientInitials: string;
  providerName: string;
  providerInitials: string;
  proofs: ReviewProof[];
  /** Preuves du lot COURANT — seules elles offrent Valider/Rejeter (les autres appartiennent
   *  à l'historique, figé). */
  appreciableIds: Set<string>;
  busyProofId: string | null;
  error: string | null;
  observedProgress: number;
  /** Plancher du curseur = cumul DÉJÀ CONFIRMÉ fermement par les points d'étape précédents.
   *  Ce qui est acquis l'est définitivement : le lot courant se constate entre ce plancher et
   *  100%, jamais en dessous — c'est ce qui garantit que la somme des tranches successives ne
   *  dépasse jamais 100%. Même règle côté serveur (POST .../checkpoint → `progress_regression`). */
  minProgress: number;
  onObservedProgressChange: (value: number) => void;
  constatText: string;
  onConstatTextChange: (value: string) => void;
  geoLabel: string | null;
  onCaptureGeo: () => void;
  constatProofs: ConstatProof[];
  constatBusyCategory: string | null;
  onAddConstatFile: (category: string, file: File) => void;
  onRemoveConstat: (id: string) => void;
  attested: boolean;
  onAttestedChange: (value: boolean) => void;
  onValidateProof: (proofId: string) => void;
  onRejectProof: (proofId: string, payload: RejectPayload) => void;
  /** « Annuler rejet » — remet la preuve en attente. */
  onCancelReject: (proofId: string) => void;
  onSave: () => void;
  saving: boolean;
  saveDisabledReason?: string | null;
}) {
  const [rejecting, setRejecting] = useState<ReviewProof | null>(null);
  const [rejectForm, setRejectForm] = useState<RejectPayload>({ reason: "", motif: "", requestNewProof: false });
  const [constatOpen, setConstatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(CONSTAT_TABS[0].label);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const constatInput = useRef<HTMLInputElement | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  // La maquette verrouille le défilement de la page derrière la modale.
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  const total = proofs.length;
  const appreciated = proofs.filter((p) => p.appreciation === "validee" || p.appreciation === "rejetee").length;
  // Le bouton principal de la maquette : un taux > 0, l'attestation cochée, au moins une
  // preuve appréciée. `saveDisabledReason` y ajoute les gardes serveur (une preuve encore en
  // attente ou rejetée interdit de confirmer le point d'étape).
  const canSave = observedProgress > 0 && attested && appreciated > 0 && !saveDisabledReason && !saving;

  // Pourquoi le bouton est gris, en toutes lettres. Il l'était auparavant en silence, et le cas
  // le plus déroutant n'était pas une saisie incomplète : après un premier point d'étape, TOUTES
  // les preuves du lot sont appréciées, le lot suivant est vide (`total === 0`) et `appreciated`
  // retombe à 0 — le client pouvait alors monter le curseur à 100 %, cocher l'attestation, et se
  // heurter à un bouton mort sans rien pour lui dire que la main était repassée au prestataire.
  const blockedReason: string | null = saving
    ? null
    : saveDisabledReason
      ? saveDisabledReason
      : total === 0
        ? "Le prestataire doit soumettre une nouvelle preuve avant que vous puissiez confirmer un point d'étape supérieur."
        : appreciated === 0
          ? "Validez ou rejetez au moins une preuve ci-dessus."
          : observedProgress <= 0
            ? "Indiquez le taux d'exécution que vous constatez sur site."
            : !attested
              ? "Cochez l'attestation de constat pour enregistrer."
              : null;
  const now = new Date();
  const nowLabel = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const countByCategory = (category: string) => proofs.filter((p) => p.category === category).length;
  const activeTabDef = CONSTAT_TABS.find((t) => t.label === activeTab) ?? CONSTAT_TABS[0];
  const constatInTab = constatProofs.filter((p) => p.category === activeTabDef.category);

  const submitReject = () => {
    if (!rejecting) return;
    if (!rejectForm.reason || rejectForm.motif.trim().length < 4) return;
    onRejectProof(rejecting.id, rejectForm);
    setRejecting(null);
    showToast("Preuve rejetée");
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-[1px]">
        <div className="w-full md:w-[800px] bg-white md:rounded-2xl rounded-none shadow-2xl max-h-[100vh] md:max-h-[90vh] flex flex-col overflow-hidden">
          {/* En-tête */}
          <div className="shrink-0 px-5 md:px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[16px] font-bold text-gray-900 leading-tight">Apprécier les preuves + Constat</h2>
                <span className="text-[12px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border">{scopeLabel}</span>
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <div className="flex -space-x-2">
                  <div className="w-7 h-7 rounded-full bg-[#e0e7ff] border-2 border-white flex items-center justify-center text-[11px] font-bold text-[#4338ca]">
                    {clientInitials}
                  </div>
                  <div className="w-7 h-7 rounded-full bg-[#dcfce7] border-2 border-white flex items-center justify-center text-[11px] font-bold text-[#15803d]">
                    {providerInitials}
                  </div>
                </div>
                <span className="text-[12px] text-gray-500">Client {clientName} • Prestataire {providerName}</span>
                <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#fef3c7] text-[#92400e] border border-[#fde68a]">
                  {statusLabel}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 shrink-0"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>

          {/* Corps */}
          <div className="overflow-y-auto flex-1 px-5 md:px-6 py-5">
            {error && (
              <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] p-3 text-[13px] text-[#b91c1c]">{error}</div>
            )}

            <div>
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h3 className="text-[13px] font-bold text-gray-700">
                  Preuves soumises par {providerName} • {total} preuve(s)
                </h3>
                <span className="text-[11px] text-gray-400 hidden md:inline">Plus de taux par preuve — validation directe 100%</span>
              </div>

              <div className="flex gap-2 mb-4 flex-wrap">
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-gray-200">Photos ({countByCategory("photo")})</span>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-gray-200">Vidéos ({countByCategory("video")})</span>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-gray-200">Documents ({countByCategory("document")})</span>
              </div>

              {total === 0 ? (
                <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl text-[12px] text-gray-400">
                  Aucune preuve à apprécier pour le moment.
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {proofs.map((proof) => {
                    const validated = proof.appreciation === "validee";
                    const rejected = proof.appreciation === "rejetee";
                    const pending = !validated && !rejected;
                    const actionable = appreciableIds.has(proof.id);
                    const busy = busyProofId === proof.id;
                    const name = proofName(proof);
                    const coords = parseLatLng(proof.note);
                    return (
                      <div
                        key={proof.id}
                        className={`bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col ${validated ? "border-[#22c55e] border-2" : rejected ? "border-[#fecaca]" : "border-gray-200"}`}
                      >
                        <div className="relative">
                          <div className="aspect-[4/3] w-full bg-gray-100 overflow-hidden">
                            {/* Fichier privé signé servi par une route API — pas un asset
                                optimisable par next/image. */}
                            {proof.category === "photo" && proof.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={proof.url} alt={name} className="w-full h-full object-cover" />
                            ) : proof.category === "video" && proof.url ? (
                              <video controls preload="metadata" className="w-full h-full object-cover bg-black">
                                <source src={proof.url} type={proof.mimeType ?? undefined} />
                              </video>
                            ) : proof.category === "geolocation" ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="bg-white px-2 py-1 rounded-full shadow text-[10px] font-medium">
                                  📍 {coords ? `${coords.lat.toFixed(4)}N ${coords.lng.toFixed(4)}E` : name}
                                </div>
                              </div>
                            ) : proof.url ? (
                              <a
                                href={proof.url}
                                target="_blank"
                                rel="noreferrer"
                                className="w-full h-full flex flex-col items-center justify-center gap-2 p-3 text-gray-700"
                              >
                                <span className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-[20px]">📄</span>
                                <span className="text-[11px] font-medium truncate max-w-full">Ouvrir ↗</span>
                              </a>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
                                <span className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-[18px]">📎</span>
                                <span className="text-[11px] text-gray-600 truncate max-w-full">{name}</span>
                              </div>
                            )}
                          </div>
                          <div className="absolute top-2 left-2 flex gap-1">
                            {pending && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f3f4f6] text-gray-600 border">En attente</span>}
                            {validated && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#dcfce7] text-[#15803d] border border-[#bbf7d0] font-medium">
                                Validée • 100%
                              </span>
                            )}
                            {rejected && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#fee2e2] text-[#dc2626] border border-[#fecaca] font-medium">
                                Rejetée
                              </span>
                            )}
                          </div>
                          {validated && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#22c55e]" />}
                          {rejected && <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#dc2626]" />}
                        </div>

                        <div className="p-2.5">
                          <div className="text-[11px] font-medium text-gray-900 truncate">{name}</div>
                          <div className="text-[10px] text-gray-500">
                            {formatSize(proof.size, proof.category === "geolocation" ? "Position GPS" : "Note")} •{" "}
                            {CATEGORY_LABEL[proof.category] ?? proof.category}
                          </div>
                          {rejected && proof.rejectionReason && (
                            <div className="mt-2 text-[10px] bg-[#fef2f2] border border-[#fecaca] rounded-lg p-1.5 text-[#991b1b]">
                              <div className="font-medium">{proof.rejectionReason}</div>
                              <div className="text-[10px] line-clamp-2 text-gray-600">{proof.rejectionMotif}</div>
                            </div>
                          )}
                        </div>

                        <div className="mt-auto flex w-full h-9 rounded-b-xl overflow-hidden border-t border-gray-100">
                          {pending ? (
                            actionable ? (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() => { onValidateProof(proof.id); showToast("Preuve validée"); }}
                                  className="w-1/2 bg-[#008751] text-white text-[13px] font-medium flex items-center justify-center gap-1 hover:bg-[#007a49] transition disabled:opacity-60"
                                >
                                  <span className="text-[12px]">✅</span> Valider
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() => { setRejecting(proof); setRejectForm({ reason: "", motif: "", requestNewProof: false }); }}
                                  className="w-1/2 bg-white text-[#dc2626] text-[13px] font-medium flex items-center justify-center gap-1 hover:bg-[#fef2f2] transition border-l border-gray-100 disabled:opacity-60"
                                >
                                  <span className="text-[12px]">❌</span> Rejeter
                                </button>
                              </>
                            ) : (
                              <div className="w-full bg-[#f9fafb] text-gray-500 text-[12px] font-medium flex items-center justify-center">
                                Lot déjà clos
                              </div>
                            )
                          ) : validated ? (
                            <div className="w-full bg-[#f0fdf4] text-[#15803d] text-[12px] font-medium flex items-center justify-center">
                              ✓ Validée à 100%
                            </div>
                          ) : (
                            <div className="flex w-full">
                              <button
                                disabled={busy || !actionable}
                                onClick={() => onCancelReject(proof.id)}
                                className="w-1/2 bg-white text-gray-600 text-[11px] hover:bg-gray-50 disabled:opacity-50"
                              >
                                Annuler rejet
                              </button>
                              <div className="w-1/2 bg-[#fef2f2] text-[#dc2626] text-[11px] flex items-center justify-center font-medium">Rejetée</div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 mt-6 pt-5">
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-[14px] font-bold text-gray-800 mb-4">Votre constat sur site</h3>

                <div className="mb-5">
                  <label className="text-[13px] font-medium text-gray-700 flex items-center gap-1">
                    Taux d&apos;exécution constaté sur site <span className="text-[#dc2626]">*</span>
                  </label>
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 relative">
                      <input
                        type="range"
                        min={minProgress}
                        max={100}
                        value={observedProgress}
                        onChange={(e) => onObservedProgressChange(Math.max(minProgress, Number(e.target.value)))}
                        className="w-full h-2 appearance-none bg-[#e5e7eb] rounded-full accent-[#008751] flexwork-constat-range"
                        /* La portion déjà acquise reste peinte en vert foncé : elle n'est plus
                           négociable, le curseur ne peut plus y redescendre. */
                        style={{ background: `linear-gradient(to right, #006b40 ${minProgress}%, #008751 ${minProgress}%, #008751 ${observedProgress}%, #e5e7eb ${observedProgress}%)` }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[28px] font-bold text-[#008751] leading-none min-w-[64px] text-right">{observedProgress}%</span>
                      <input
                        type="number"
                        min={minProgress}
                        max={100}
                        value={observedProgress}
                        onChange={(e) => onObservedProgressChange(Math.min(100, Math.max(minProgress, Number(e.target.value) || 0)))}
                        className="w-[55px] h-8 border border-gray-200 rounded-lg text-[13px] text-center"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1.5 flex-wrap">
                    {[0, 25, 50, 75, 100].map((value) => {
                      // Une pastille sous le plancher désignerait une régression : elle reste
                      // visible (le client voit d'où il part) mais devient inatteignable.
                      const belowFloor = value < minProgress;
                      return (
                        <button
                          key={value}
                          disabled={belowFloor}
                          title={belowFloor ? `Déjà validé fermement à ${minProgress}% — le constat ne peut plus redescendre` : undefined}
                          onClick={() => onObservedProgressChange(value)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition ${belowFloor ? "bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed line-through" : observedProgress === value ? "bg-[#008751] text-white border-[#008751]" : "bg-white text-gray-600 border-gray-200 hover:border-[#008751] hover:text-[#008751]"}`}
                        >
                          {value}%
                        </button>
                      );
                    })}
                  </div>
                  {minProgress > 0 && (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Minimum {minProgress}% — déjà validé fermement lors d&apos;un point d&apos;étape précédent. Ce lot se constate entre {minProgress}% et 100%.
                    </p>
                  )}
                </div>

                <div className="mb-4">
                  <label className="text-[13px] font-medium text-gray-700">Constat sur le terrain</label>
                  <textarea
                    rows={3}
                    value={constatText}
                    onChange={(e) => onConstatTextChange(e.target.value)}
                    placeholder="Ex. Visite du 04/09 à 14h - tableau posé, câblage en cours, finitions à prévoir côté local TGBT..."
                    className="mt-2 w-full border border-gray-200 rounded-xl p-3 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] placeholder:text-gray-400"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <span className="text-[12px] px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600">📅 {nowLabel}</span>
                  <button
                    onClick={() => { onCaptureGeo(); showToast("Position capturée"); }}
                    disabled={constatBusyCategory === "constat_geolocation"}
                    className="text-[12px] px-3 py-1.5 rounded-full bg-[#ede9fe] text-[#6d28d9] border border-[#ddd6fe] hover:bg-[#ddd6fe] transition disabled:opacity-50"
                  >
                    📍 Capturer ma position
                  </button>
                  {geoLabel && (
                    <span className="text-[11px] text-gray-600 bg-[#f5f3ff] border border-[#ede9fe] px-2.5 py-1 rounded-full">{geoLabel}</span>
                  )}
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px]">📎</span>
                      <span className="text-[13px] font-medium text-gray-700">Vos preuves de constat ({constatProofs.length})</span>
                    </div>
                    <button
                      onClick={() => setConstatOpen(true)}
                      className="text-[12px] px-3 py-1.5 rounded-full bg-[#ede9fe] text-[#6d28d9] border border-[#ddd6fe] hover:bg-[#ddd6fe] transition flex items-center gap-1"
                    >
                      <span>📷➕</span> Ajouter vos preuves de constat
                    </button>
                  </div>
                  {constatProofs.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {constatProofs.slice(0, 6).map((proof) => {
                        const label = CONSTAT_TABS.find((t) => t.category === proof.category)?.label ?? "?";
                        const name = proofName(proof);
                        return (
                          <div key={proof.id} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full pl-1 pr-2 py-1 shadow-sm">
                            <div className="w-8 h-8 rounded-full bg-[#f3f4f6] flex items-center justify-center text-[10px] font-bold text-gray-600">
                              {label[0]}
                            </div>
                            <span className="text-[11px] max-w-[90px] truncate">{name.slice(0, 14)}…</span>
                            <button
                              onClick={() => onRemoveConstat(proof.id)}
                              className="w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-[10px]"
                              aria-label="Retirer"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      {constatProofs.length > 6 && (
                        <button onClick={() => setConstatOpen(true)} className="text-[11px] text-[#6d28d9] underline">
                          Voir toutes ({constatProofs.length})
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 text-[11px] text-gray-400">Aucune preuve ajoutée — utilisez le bouton violet pour ajouter.</div>
                  )}
                </div>

                <label className="flex items-start gap-2 mt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => onAttestedChange(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#008751] focus:ring-[#008751]"
                  />
                  <span className="text-[12px] text-gray-600 leading-[1.4]">
                    J&apos;atteste avoir constaté sur site la réalité des travaux et l&apos;exactitude des informations saisies.{" "}
                    <span className="text-[#dc2626]">*</span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Pied */}
          <div className="shrink-0 px-5 md:px-6 py-4 border-t border-gray-200 bg-[#f9fafb] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-[12px] text-gray-500">
              <div>{appreciated}/{total} preuves appréciées • Taux site {observedProgress}% • {constatProofs.length} preuve(s) constat</div>
              {blockedReason && (
                <div className="mt-1 text-[12px] text-[#92400E] max-w-[46ch] leading-snug">{blockedReason}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="h-9 px-4 rounded-xl border border-gray-200 bg-white text-[13px] text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
              <button
                disabled={!canSave}
                title={blockedReason ?? undefined}
                onClick={() => { showToast(`Taux ${observedProgress}% et constat enregistrés - prestataire notifié`); onSave(); }}
                className={`h-9 px-5 rounded-xl text-[13px] font-medium transition ${canSave ? "bg-[#008751] text-white hover:bg-[#007a49]" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
              >
                {saving ? "Envoi..." : "Enregistrer appréciation + constats"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sous-modale de rejet */}
      {rejecting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="w-[400px] max-w-[92vw] bg-white rounded-2xl shadow-2xl p-5">
            <h4 className="text-[14px] font-bold text-gray-900">Rejeter la preuve</h4>
            <p className="text-[12px] text-gray-500 mt-1 truncate">{proofName(rejecting)}</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-[12px] font-medium text-gray-700">Raison du rejet *</label>
                <select
                  value={rejectForm.reason}
                  onChange={(e) => setRejectForm({ ...rejectForm, reason: e.target.value })}
                  className="mt-1 w-full h-9 border border-gray-200 rounded-xl px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                >
                  <option value="">Sélectionner</option>
                  {CLIENT_REJECT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700">Motif détaillé *</label>
                <textarea
                  rows={3}
                  value={rejectForm.motif}
                  onChange={(e) => setRejectForm({ ...rejectForm, motif: e.target.value })}
                  placeholder="Ex. Photo floue..."
                  maxLength={300}
                  className={`mt-1 w-full border rounded-xl p-2.5 text-[13px] resize-none focus:outline-none focus:ring-2 transition-colors ${rejectForm.motif.length === 0 ? "border-gray-200 focus:ring-[#008751]/20 focus:border-[#008751]" : rejectForm.motif.trim().length < 4 ? "border-[#fecaca] bg-[#fef2f2] focus:ring-[#dc2626]/20 focus:border-[#dc2626]" : "border-[#008751] bg-[#f0fdf4] focus:ring-[#008751]/20 focus:border-[#008751]"}`}
                />
                <div className="mt-1.5 flex justify-between items-center">
                  <span className={`text-[11px] ${rejectForm.motif.trim().length >= 4 ? "text-[#008751] font-medium" : "text-[#dc2626]"}`}>
                    {rejectForm.motif.trim().length >= 4
                      ? `✓ 4 caractères minimum (${rejectForm.motif.length}/300)`
                      : `4 caractères minimum (actuellement ${rejectForm.motif.length}/300)`}
                  </span>
                  <span className="text-[11px] text-gray-400">{rejectForm.motif.length}/300</span>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rejectForm.requestNewProof}
                  onChange={(e) => setRejectForm({ ...rejectForm, requestNewProof: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-[#008751]"
                />
                <span className="text-[12px] text-gray-700">Demander nouvelle preuve</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRejecting(null)} className="h-9 px-4 rounded-xl bg-gray-100 text-[13px] text-gray-700 hover:bg-gray-200">
                Annuler
              </button>
              <button
                disabled={!rejectForm.reason || rejectForm.motif.trim().length < 4}
                onClick={submitReject}
                className={`h-9 px-4 rounded-xl text-[13px] font-medium transition-colors ${!rejectForm.reason || rejectForm.motif.trim().length < 4 ? "bg-gray-200 text-gray-400 cursor-not-allowed" : "bg-[#dc2626] text-white hover:bg-[#b91c1c]"}`}
              >
                Confirmer rejet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sous-modale « Ajouter vos preuves de constat » */}
      {constatOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="w-[640px] max-w-[96vw] bg-white rounded-2xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h4 className="text-[14px] font-bold text-gray-900">Ajouter vos preuves de constat</h4>
                <p className="text-[11px] text-gray-500 mt-0.5">Photos / Vidéos / Documents / Géoloc</p>
              </div>
              <button onClick={() => setConstatOpen(false)} className="w-8 h-8 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center" aria-label="Fermer">
                ✕
              </button>
            </div>

            <div className="px-5 pt-4 flex gap-2">
              {CONSTAT_TABS.map((tab) => (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(tab.label)}
                  className={`text-[12px] px-3 py-1.5 rounded-full border transition ${activeTab === tab.label ? "bg-[#ede9fe] text-[#6d28d9] border-[#ddd6fe]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[12px] text-gray-600">
                  {constatInTab.length} preuve(s) dans {activeTab}
                </span>
                {activeTabDef.accept && (
                  <input
                    ref={constatInput}
                    type="file"
                    accept={activeTabDef.accept}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) onAddConstatFile(activeTabDef.category, file);
                    }}
                  />
                )}
                <button
                  disabled={constatBusyCategory === activeTabDef.category}
                  onClick={() => (activeTabDef.accept ? constatInput.current?.click() : onCaptureGeo())}
                  className="h-8 px-3 rounded-full bg-[#008751] text-white text-[12px] hover:bg-[#007a49] disabled:opacity-50"
                >
                  {constatBusyCategory === activeTabDef.category ? "Envoi..." : `+ Ajouter ${activeTab}`}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {constatInTab.length === 0 ? (
                  <div className="col-span-full py-10 text-center border border-dashed border-gray-200 rounded-xl">
                    <div className="text-[12px] text-gray-400">Aucune preuve dans {activeTab}</div>
                    <div className="text-[11px] text-gray-400 mt-1">
                      {activeTabDef.accept ? "Cliquez sur Ajouter pour importer un fichier" : "Cliquez sur Ajouter pour capturer votre position"}
                    </div>
                  </div>
                ) : (
                  constatInTab.map((proof) => {
                    const name = proofName(proof);
                    return (
                      <div key={proof.id} className="border border-gray-200 rounded-xl p-2.5 flex items-center gap-2.5 bg-white">
                        <div className="w-10 h-10 rounded-lg bg-[#f3f4f6] flex items-center justify-center text-[11px] font-bold">
                          {activeTab[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium truncate">{name}</div>
                          <div className="text-[10px] text-gray-500">
                            {formatSize(proof.size, "Position GPS")} • {activeTab}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {proof.url ? (
                            <a
                              href={proof.url}
                              target="_blank"
                              rel="noreferrer"
                              className="h-7 px-2.5 rounded-full bg-gray-50 border text-[11px] hover:bg-gray-100 flex items-center"
                            >
                              Voir
                            </a>
                          ) : (
                            <button
                              onClick={() => showToast(`Aperçu ${name}`)}
                              className="h-7 px-2.5 rounded-full bg-gray-50 border text-[11px] hover:bg-gray-100"
                            >
                              Voir
                            </button>
                          )}
                          <button
                            onClick={() => onRemoveConstat(proof.id)}
                            className="h-7 px-2.5 rounded-full bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] text-[11px] hover:bg-[#fee2e2]"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex justify-end">
              <button onClick={() => setConstatOpen(false)} className="h-9 px-5 rounded-xl bg-[#008751] text-white text-[13px] hover:bg-[#007a49]">
                Terminé
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-[#008751] text-white px-4 py-2.5 rounded-full text-[13px] font-medium shadow-lg flex items-center gap-2">
          <span>✓</span> {toast}
        </div>
      )}
    </>
  );
}
