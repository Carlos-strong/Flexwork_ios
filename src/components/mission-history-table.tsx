"use client";

// Modèle partagé "Historique des soumissions" (règle R03) — factorisé le 2026-09-05 depuis
// missions/[id]/deliverable/page.tsx (vue PRESTATAIRE) pour être réutilisé À L'IDENTIQUE côté
// CLIENT (ValidationClientView) : même en-tête de carte (badge domaine + statut + preuves
// total), même montant + conversion EUR + barre bicolore ferme/hachurée + légende, même
// dropdown Version/Type/Preuves/%cumulé/Statut/Action, même bandeau récapitulatif. Les DEUX
// vues restent des composants séparés (permissions différentes : le prestataire soumet, le
// client valide/rejette) — seul CE bloc de présentation partagé, via `canSubmitProofs` (false
// côté client, qui n'a jamais le bouton "Soumettre preuve").
import { useState } from "react";
import { Check, ExternalLink, Upload } from "lucide-react";
import type { Checkpoint } from "@/components/progress-checkpoints";

// Même libellés que missions/[id]/page.tsx (PROFESSIONAL_TYPE_LABEL) — badge domaine de
// l'en-tête carte.
export const PROFESSIONAL_TYPE_LABEL: Record<string, string> = {
  EXPERT_DIGITAL: "Expert Digital",
  EXPERT_BTP: "Expert BTP / Autres",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

// Parité fixe FCFA/EUR (peg officiel BCEAO/BCEAC, invariable) — badge de conversion informatif
// sous le montant XOF de l'en-tête carte.
const XOF_PER_EUR = 655.957;
export function xofToEur(amountXof: number): number {
  return Math.round(amountXof / XOF_PER_EUR);
}

// Catégories de preuves — mêmes libellés que le formulaire de soumission (prestataire), utilisé
// ici uniquement pour REGROUPER un lot en lecture seule (ReadOnlyProofCategories), jamais pour
// en ajouter (l'ajout reste une action prestataire, hors de ce module).
export const PROOF_CATEGORIES: { id: string; label: string }[] = [
  { id: "photo", label: "📷 Photos" },
  { id: "video", label: "🎥 Vidéos" },
  { id: "document", label: "📄 Documents" },
  { id: "geolocation", label: "📍 Géolocalisation" },
  { id: "other", label: "➕ Autres preuves" },
];

// Forme minimale exigée par ce module — les deux vues appelantes ont chacune leur propre type
// `Attachment` local, les deux satisfont structurellement celui-ci sans conversion. Les champs
// `appreciation*` (2026-09-05) portent l'avis du CLIENT sur cette preuve (null = en attente,
// "validee"/"rejetee") — servis par GET .../deliverable et GET .../jalons/[jalonId]/
// attachments, affichés par la vue prestataire dans l'aperçu "Voir" (ReadOnlyProofCategories)
// pour savoir quelle preuve fournir en remplacement. `mimeType` (2026-09-08, aperçu
// prestataire redessiné pour matcher la vue client) — sert uniquement le type MIME de la
// balise <source> d'une vidéo, optionnel, les deux GET le renvoient déjà.
export type HistoryAttachment = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  createdAt: string;
  url: string | null;
  mimeType?: string | null;
  /** Taille réelle du fichier stocké (octets) — servie par les deux GET, affichée par les
   *  modales de soumission/appréciation. null pour les preuves texte-seules. */
  size?: number | null;
  appreciation?: string | null;
  rejectionReason?: string | null;
  rejectionMotif?: string | null;
  requestNewProof?: boolean;
};

// Coordonnées "lat,lng" (POST .../deliverable, catégorie "geolocation") — même parsing que
// ValidationClientView.tsx (parseLatLng), dupliqué ici (fonction pure, 3 lignes) pour ne pas
// dépendre à l'envers d'un composant de vue depuis ce module partagé de plus bas niveau.
function parseLatLng(note: string | null): { lat: number; lng: number } | null {
  if (!note) return null;
  const [latStr, lngStr] = note.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Historique des rejets (GET .../rejections, voir ProgressRejection) — pendant de Checkpoint
// pour la trace des soumissions REJETÉES, plutôt que seulement le dernier motif encore affiché
// sur le jalon (rejectionReason, écrasé à chaque nouveau rejet).
export type Rejection = { id: string; jalonId: string | null; reason: string; rejectedByName: string; createdAt: string };

// Icône + libellé singulier par catégorie — même palette que la carte preuve CLIENT
// (ProofCard, ValidationClientView.tsx) : une carte par preuve, plus de regroupement par
// catégorie (2026-09-08, aperçu prestataire redessiné pour matcher la vue client — voir
// Flexwork-Modal-Appreciation-Preuves.html). `PROOF_CATEGORIES` ci-dessus reste la référence
// "libellés du formulaire de soumission" (pluriel + emoji préfixé), distincte de celle-ci.
const READONLY_CATEGORY: Record<string, { icon: string; label: string }> = {
  photo: { icon: "📷", label: "Photo" },
  video: { icon: "🎥", label: "Vidéo" },
  document: { icon: "📄", label: "Document" },
  geolocation: { icon: "📍", label: "Géolocalisation" },
  other: { icon: "➕", label: "Preuve texte" },
};

// Aperçu LECTURE SEULE d'un lot de preuves historique — ouvert par le bouton "Voir" du dropdown
// "Historique" (vue prestataire, missions/[id]/deliverable). Une CARTE par preuve, même forme
// que ProofCard côté client (icône catégorie, aperçu réel par type, badge de statut, motif de
// rejet) — SANS aucune action Valider/Rejeter (l'appréciation reste une décision du client) ni
// aucun contrôle d'ajout : un lot déjà écoulé (borné par une validation/un rejet, ou remplacé
// par un lot plus récent) ne peut plus être modifié depuis ici.
export function ReadOnlyProofCategories({ attachments }: { attachments: HistoryAttachment[] }) {
  const sorted = [...attachments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (sorted.length === 0) {
    return <p className="text-[12px] text-[#94A3B8] text-center py-3">Aucune preuve dans ce lot.</p>;
  }
  return (
    <div className="space-y-2.5">
      {sorted.map((a, i) => {
        const cat = READONLY_CATEGORY[a.category] ?? { icon: "📎", label: a.category };
        const coords = a.category === "geolocation" ? parseLatLng(a.note) : null;
        const isPdf =
          !!a.url &&
          (a.mimeType === "application/pdf" ||
            /\.pdf(?:$|[?#])/i.test(a.fileName ?? "") ||
            /\.pdf(?:$|[?#])/i.test((a.url ?? "").split("?")[0].split("/").pop() ?? ""));
        const when = new Date(a.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        return (
          <div key={a.id} className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-[#F1F5F9] flex items-center justify-between gap-2 flex-wrap bg-[#F8FAF9]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-[#E2E8F0] text-[#475569] text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="w-7 h-7 rounded-lg bg-white border border-[#E2E8F0] flex items-center justify-center text-[13px] shrink-0" aria-hidden>{cat.icon}</span>
                <span className="text-[12px] font-semibold text-[#0f172a]">{cat.label}</span>
                {a.fileName && <span className="text-[11px] text-[#64748B] truncate min-w-0">— {a.fileName}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10.5px] text-[#94A3B8]">{when}</span>
                {a.appreciation === "validee" && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] text-[10.5px] font-semibold whitespace-nowrap">✓ Validée</span>
                )}
                {a.appreciation === "rejetee" && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] text-[10.5px] font-semibold whitespace-nowrap">✗ Rejetée</span>
                )}
                {!a.appreciation && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0] text-[10.5px] font-medium whitespace-nowrap">En attente</span>
                )}
              </div>
            </div>
            <div className="p-2.5">
              {a.category === "photo" && a.url ? (
                // Fichier privé signé, servi par une route API, pas un asset optimisable par next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.fileName ?? "Photo fournie"} className="w-full max-h-80 object-contain rounded-lg bg-[#F8FAF9] border border-[#E2E8F0]" />
              ) : a.category === "video" && a.url ? (
                <video controls className="w-full max-h-80 rounded-lg border border-[#E2E8F0] bg-black">
                  <source src={a.url} type={a.mimeType ?? undefined} />
                </video>
              ) : a.category === "geolocation" && coords ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] flex-wrap">
                  <span className="text-[12.5px] text-[#0f172a] font-mono">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
                  <a href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer" className="text-[11.5px] text-[#1E40AF] font-medium shrink-0">
                    Voir sur Google Maps ↗
                  </a>
                </div>
              ) : isPdf || a.url ? (
                <a href={a.url as string} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] text-[#1E40AF] text-[12.5px] hover:bg-[#F1F5F9]">
                  📄 <span className="truncate">{a.fileName ?? "Ouvrir le document"}</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
              ) : (
                <p className="px-3 py-2.5 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] text-[12.5px] text-[#0f172a] leading-relaxed whitespace-pre-wrap">
                  {a.note || "(preuve sans contenu lisible)"}
                </p>
              )}
            </div>
            {/* Avis du client sur cette preuve (2026-09-05) : rejetée → raison + motif + éventuelle
                demande de nouvelle preuve, pour que le prestataire sache exactement quoi corriger. */}
            {a.appreciation === "rejetee" && (
              <div className="mx-2.5 mb-2.5 rounded-md bg-[#FEF2F2] border border-[#FECACA] px-2.5 py-2 text-[11px] text-[#991B1B]">
                <span className="font-semibold">{a.rejectionReason ?? "Preuve non conforme"}</span>
                {a.rejectionMotif && <span className="block mt-0.5 leading-relaxed">{a.rejectionMotif}</span>}
                {a.requestNewProof && <span className="block mt-0.5 italic">Une nouvelle preuve a été demandée.</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Ligne du sous-tableau "Historique" — chaque LOT de preuves soumis (regroupé par soumission
// partielle, voir buildHistoryRows), chaque point d'étape confirmé par le client, ET chaque
// rejet forment une VERSION ("01-V1", "01-V1-val" ou "01-V1-rej", "01-V2"...) — l'événement qui
// clôt une soumission reprend son numéro, suffixé "-val" (validée) ou "-rej" (rejetée), pour
// que les deux se lisent comme une paire. La colonne `percentPartial` porte le taux de
// progression VALIDÉ PAR LE CLIENT attribuable à CETTE version (l'incrément qu'elle ajoute au
// cumul : 01-V1 validé 0→50 % → 50 %, 01-V2 validé 50→65 % → 15 %) — jamais le cumul complet,
// qui reste porté par la barre de progression de l'en-tête (AmountProgressBar) et le bandeau
// récapitulatif en pied. Un lot REJETÉ ou encore "Envoyée" (rien de validé) porte 0 —
// `firmBase` conserve, lui, le cumul consolidé au DÉBUT du lot pour la barre bicolore. Chaque
// lot reste sa propre ligne, distincte du lot corrigé qui la remplace. `kind` permet à chaque
// vue de filtrer QUEL sous-ensemble de versions
// afficher (signalé 2026-09-05) : la page prestataire ne liste que les SOUMISSIONS
// (kind === "preuve", "01-V1"...) pour ne justifier que ses propres versions, la vue client ne
// liste que ses propres VALIDATIONS (kind === "validation", "01-V1-val"...) — voir les appelants
// respectifs (deliverable/page.tsx et ValidationClientView.tsx).
export type HistoryRow = {
  id: string;
  version: string;
  kind: "preuve" | "validation" | "rejet";
  createdAt: string;
  by: string;
  proofsLabel: string;
  /** Taux de progression VALIDÉ PAR LE CLIENT attribuable à cette version, affiché dans la
   *  colonne "% partielle" : l'INCRÉMENT que la ligne ajoute au cumul validé (01-V1 validé
   *  0→50 % → 50 %, 01-V2 validé 50→65 % → 15 %). Ligne "rejet"/"Envoyée" ou re-validation
   *  sans progrès → 0. La somme des `percentPartial` des lignes = le cumul porté par la barre
   *  de l'en-tête (AmountProgressBar, via `totalPercent`/firmBase) — pas de doublon ici. */
  percentPartial: number;
  /** Niveau cumulé consolidé au DÉBUT du lot de soumission (lignes "preuve" uniquement, 0
   *  sinon) — alimente la barre bicolore (firmAndPartialPercent) : "ferme" = cumul AVANT le
   *  lot courant. */
  firmBase: number;
  /** Montant (XOF) correspondant à `percentPartial` — conservé pour cohérence, non affiché. */
  montantPartial: number;
  batchAttachments: HistoryAttachment[];
  /** Lignes "preuve" uniquement — statut du badge : "envoyee" (lot courant, rien décidé
   *  dessus), "validee" (client a confirmé un point d'étape à ou après ce lot) ou "rejetee"
   *  (client a rejeté CE lot précis — y compris s'il avait déjà été clôturé "validee" par un
   *  point d'étape puis rejeté SANS nouvelle soumission entre les deux : le rejet vise la
   *  dernière soumission, voir buildHistoryRows). Sans effet sur les lignes "validation"/
   *  "rejet" elles-mêmes, dont le badge est fixe (Confirmé / Rejeté). */
  outcome: "envoyee" | "validee" | "rejetee";
  /** Ligne "rejet" uniquement — motif saisi par le client. */
  reason: string | null;
};

// ── Règle de synchronisation prestataire/client (définitive, 2026-09-07) ───────────────────
// Les DEUX tableaux (Soumission côté prestataire /deliverable, Validation côté client
// /missions/[id]) affichent désormais les MÊMES lignes — un même lot de preuves ("01-V1"…,
// kind "preuve" de buildHistoryRows) — avec un Type fixe par vue ("Soumission"/"Validation")
// et un Statut dérivé de l'état RÉEL du jalon/de la mission (`currentStatus`, uniquement
// pertinent pour la ligne COURANTE — les lots déjà clos gardent un statut figé par leur
// `outcome`) :
//
//   Action du prestataire/client        Soumission (prestataire)   Validation (client)
//   Commence une soumission             En cours                   En attente
//   Soumet les preuves                  Envoyé                     En attente
//   Client ouvre la validation          Envoyé                     En cours
//   Client valide (libération transmise) Validé                    Confirmé
//   Client valide (PSP a confirmé)      Terminé                    Confirmé
//   Client rejette                      Révision                   Rejeté
//   Prestataire corrige et resoumet     En cours (nouvelle version) En attente (nouvelle version)
//
// `currentStatus` est un état normalisé commun jalon/mission (voir normalizeSubmissionStatus)
// — "draft" (pas encore soumis ce tour, ou tour rejeté en attente de resoumission),
// "submitted" (livrable_soumis), "validated" (jalon `valide` — RELEASE transmis, ou point
// d'étape partiel confirmé sans validation finale) ou "released" (jalon `libere`/mission
// `cloturee` — PSP a confirmé le paiement). `reviewOpenedAt` (Jalon/Mission, posé par
// POST .../review-open) distingue "En attente" de "En cours" côté client tant que le statut
// reste "submitted" — seul état où cette nuance existe (voir POST .../submit qui le remet à
// null à chaque nouveau tour).
export type SubmissionStatus = "draft" | "submitted" | "validated" | "released";

export function normalizeJalonSubmissionStatus(status: string): SubmissionStatus {
  if (status === "livrable_soumis") return "submitted";
  if (status === "valide") return "validated";
  if (status === "libere") return "released";
  return "draft"; // en_attente | fonds_sous_sequestre | rejete
}

export function normalizeMissionSubmissionStatus(status: string): SubmissionStatus {
  if (status === "livrable_soumis") return "submitted";
  if (status === "validee") return "validated"; // rarement atteint (RELEASE confirmé directement en `cloturee`)
  if (status === "cloturee") return "released";
  return "draft"; // brouillon | publiee | ... | fonds_sous_sequestre | en_cours
}

const OPEN_BADGE = "bg-[#ede9fe] text-[#6d28d9]";
const SENT_BADGE = "bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE]";
const SUCCESS_BADGE = "bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]";
const DANGER_BADGE = "bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]";

/** Type + Statut + couleur d'une ligne "preuve", pour UNE vue (prestataire/client) — seule
 *  source de vérité pour les deux tableaux (voir la règle de synchronisation ci-dessus). Les
 *  lignes "validation"/"rejet" (kind) ne sont plus affichées séparément : leur seul rôle
 *  restant est de faire évoluer `outcome`/`firmBase` du lot "preuve" qu'elles closent (voir
 *  buildHistoryRows) — chaque tableau ne montre que les tours de SOUMISSION, correspondance
 *  ligne à ligne entre les deux vues. */
export function getRowTypeStatus(
  row: HistoryRow,
  isLast: boolean,
  view: "prestataire" | "client",
  currentStatus: SubmissionStatus,
  reviewOpenedAt: string | null
): { typeLabel: string; statutLabel: string; badgeClass: string } {
  const typeLabel = view === "prestataire" ? "Soumission" : "Validation";

  // Lot déjà clos (rejeté, ou validé par un tour ultérieur qui a suivi) : statut figé, peu
  // importe l'état courant du jalon/de la mission — seule la ligne COURANTE (isLast) reflète
  // `currentStatus`.
  if (row.outcome === "rejetee") {
    return view === "prestataire"
      ? { typeLabel, statutLabel: "Révision", badgeClass: DANGER_BADGE }
      : { typeLabel, statutLabel: "Rejeté", badgeClass: DANGER_BADGE };
  }
  if (!isLast || row.outcome === "validee") {
    // Validé (transitoire, libération en cours) devient Terminé une fois le PSP confirmé —
    // uniquement pertinent pour la ligne courante, un lot déjà remplacé par un tour suivant
    // reste simplement "Validé" dans son propre historique.
    const released = isLast && currentStatus === "released";
    return view === "prestataire"
      ? { typeLabel, statutLabel: released ? "Terminé" : "Validé", badgeClass: SUCCESS_BADGE }
      : { typeLabel, statutLabel: "Confirmé", badgeClass: SUCCESS_BADGE };
  }

  // Ligne courante, rien encore décidé sur ce lot ("envoyee") : dépend de l'état réel.
  if (currentStatus === "submitted") {
    return view === "prestataire"
      ? { typeLabel, statutLabel: "Envoyé", badgeClass: SENT_BADGE }
      : { typeLabel, statutLabel: reviewOpenedAt ? "En cours" : "En attente", badgeClass: OPEN_BADGE };
  }
  // "draft" (pas encore soumis ce tour) — ou repli défensif si `currentStatus` contredit
  // `outcome` (ne devrait pas arriver).
  return view === "prestataire"
    ? { typeLabel, statutLabel: "En cours", badgeClass: OPEN_BADGE }
    : { typeLabel, statutLabel: "En attente", badgeClass: OPEN_BADGE };
}

export function buildHistoryRows(
  attachments: HistoryAttachment[],
  checkpoints: Checkpoint[],
  rejections: Rejection[],
  montant: number,
  jalonOrdre: number
): HistoryRow[] {
  // Régule la file d'attachments par LOT (soumission partielle) — un lot est "clos" par le
  // PROCHAIN événement (validation OU rejet) qui le suit chronologiquement ; ce qui reste après
  // le dernier événement forme automatiquement le lot courant, encore "Envoyée", tant que la
  // mission n'est pas à 100%. Le préfixe "01" reprend l'indice du jalon/mission affiché en tête
  // de carte (#01).
  const versionPrefix = String(jalonOrdre).padStart(2, "0");
  const sortedAttachments = [...attachments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  type Event = { kind: "validation" | "rejet"; createdAt: string; by: string; percent?: number; reason?: string };
  const events: Event[] = [
    ...checkpoints.map((c): Event => ({ kind: "validation", createdAt: c.createdAt, by: c.validatedByName, percent: c.progress })),
    ...rejections.map((r): Event => ({ kind: "rejet", createdAt: r.createdAt, by: r.rejectedByName, reason: r.reason })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const rows: HistoryRow[] = [];
  let cursor = 0;
  // Cumul courant (0-100) — le palier le plus récent CONFIRMÉ par le client. C'est aussi le
  // niveau de départ (`firmBase`) du lot de soumission en cours tant qu'aucune décision ne
  // l'a clos.
  let cumulative = 0;
  let submissionCounter = 0;

  // Pousse le lot courant (attachments entre le dernier événement et `boundaryTime`) comme une
  // ligne "preuve". `postLevel` = palier que la décision de clôture ATTEINT (pour une
  // validation) — l'incrément affiché en "% partielle" en dérive (postLevel − `cumulative`).
  // Le `firmBase` de la ligne = `cumulative` au moment de l'appel (donc AVANT la décision qui
  // clôt le lot). Renvoie false si aucun attachment n'a formé de lot (aucune nouvelle
  // soumission) — permet à l'appelant de détecter les re-confirmations sans progression.
  function flushBatch(boundaryTime: string | null, outcome: "validee" | "rejetee" | "envoyee", postLevel: number): boolean {
    const batch: HistoryAttachment[] = [];
    while (
      cursor < sortedAttachments.length &&
      (boundaryTime === null || new Date(sortedAttachments[cursor].createdAt).getTime() <= new Date(boundaryTime).getTime())
    ) {
      batch.push(sortedAttachments[cursor]);
      cursor++;
    }
    if (batch.length === 0) return false;
    submissionCounter += 1;
    const last = batch[batch.length - 1];
    // Incrément validé par le client attribuable à CE lot : la validation qui le clôt fait
    // passer le cumul de `firmBase` (== cumulative ici, non encore avancé) à `postLevel`.
    // Un lot rejeté ou encore "Envoyée" n'ajoute rien (0).
    const partial = outcome === "validee" ? Math.max(0, postLevel - cumulative) : 0;
    rows.push({
      id: `v${submissionCounter}`,
      version: `${versionPrefix}-V${submissionCounter}`,
      kind: "preuve",
      createdAt: last.createdAt,
      by: "Vous",
      proofsLabel: `${batch.length} preuve${batch.length > 1 ? "s" : ""}`,
      percentPartial: partial,
      montantPartial: Math.round((partial / 100) * montant),
      firmBase: cumulative,
      batchAttachments: batch,
      outcome,
      reason: null,
    });
    return true;
  }

  for (const e of events) {
    if (e.kind === "validation") {
      const before = cumulative;
      const hasNewBatch = flushBatch(e.createdAt, "validee", e.percent ?? before);
      cumulative = e.percent ?? before;
      // Pure re-confirmation (même palier, aucune nouvelle soumission entre-temps) : pas de
      // ligne "validation" — elle dupliquerait la version ("01-V1-val" en double) sans rien
      // apprendre de neuf. Les confirmations de palier DIFFÉRENT restent affichées.
      if (e.percent !== before || hasNewBatch) {
        // Incrément validé par CETTE confirmation (palier atteint − palier précédent).
        const increment = Math.max(0, cumulative - before);
        rows.push({
          id: `v${submissionCounter || 1}-val:${e.createdAt}`,
          version: `${versionPrefix}-V${submissionCounter || 1}-val`,
          kind: "validation",
          createdAt: e.createdAt,
          by: e.by,
          proofsLabel: "—",
          percentPartial: increment,
          montantPartial: Math.round((increment / 100) * montant),
          firmBase: 0,
          batchAttachments: [],
          outcome: "validee",
          reason: null,
        });
      }
    } else {
      // Rejet du lot courant. S'il clôt une NOUVELLE soumission (attachments soumis après le
      // dernier événement), ce lot passe "rejetee" et la ligne "preuve" le montre. Sinon le
      // rejet intervient SANS nouvelle soumission : le lot courant avait déjà été clôturé par
      // un point d'étape (le statut reste livrable_soumis) — le rejet vise pourtant bien CETTE
      // dernière soumission, celle qui a mis le jalon/mission en attente de validation. On
      // rebascule donc sa ligne "preuve" en "rejetee" (seule l'issue VISIBLE du lot change ;
      // le % de point d'étape reste acquis dans la barre/observed — un rejet ne défait pas une
      // validation antérieure). Signalé 2026-09-05 : après rejet, la ligne du lot affichait
      // encore "Validé" au lieu de "Rejeté" quand aucun nouveau lot n'était à clôturer.
      const closedNewBatch = flushBatch(e.createdAt, "rejetee", cumulative);
      if (!closedNewBatch) {
        const lastProofIdx = rows.map((r) => r.kind).lastIndexOf("preuve");
        const lastProof = lastProofIdx >= 0 ? rows[lastProofIdx] : null;
        if (lastProof && lastProof.outcome !== "rejetee") {
          rows[lastProofIdx] = { ...lastProof, outcome: "rejetee", percentPartial: 0 };
        }
      }
      // Un rejet ne change JAMAIS le cumul — `cumulative` reste tel quel, incrément validé 0.
      rows.push({
        id: `v${submissionCounter || 1}-rej:${e.createdAt}`,
        version: `${versionPrefix}-V${submissionCounter || 1}-rej`,
        kind: "rejet",
        createdAt: e.createdAt,
        by: e.by,
        proofsLabel: "—",
        percentPartial: 0,
        montantPartial: 0,
        firmBase: 0,
        batchAttachments: [],
        outcome: "rejetee",
        reason: e.reason ?? null,
      });
    }
  }
  flushBatch(null, "envoyee", cumulative); // lot courant, pas encore décidé

  return rows;
}

/** Séparé du cumul confirmé (checkpoints) pour la barre bicolore de l'en-tête de carte :
 *  "ferme" = état cumulé juste avant le lot de preuves COURANT (la dernière ligne "preuve" de
 *  l'historique COMPLET, non filtré) ; "partiel hachuré" = ce que la validation la plus récente
 *  a ajouté depuis. Prend toujours `buildHistoryRows` au complet (jamais la liste déjà filtrée
 *  par kind d'une vue) — la barre doit refléter le cumul réel, indépendamment de ce que CETTE
 *  vue choisit d'afficher comme lignes. */
export function firmAndPartialPercent(historyRows: HistoryRow[], totalPercent: number): { firmPercent: number; partialPercent: number } {
  // `firmBase` (cumul consolidé au DÉBUT du dernier lot) et non `percentPartial` (incrément
  // validé par le client sur ce lot, affiché en colonne) : le "ferme" reste le cumul AVANT le
  // lot courant — la validation la plus récente reste "hachurée" tant que le lot suivant ne
  // l'a pas consolidée en démarrant.
  const lastProofRow = [...historyRows].reverse().find((r) => r.kind === "preuve");
  const firmPercent = Math.min(lastProofRow?.firmBase ?? 0, totalPercent);
  const partialPercent = Math.max(0, totalPercent - firmPercent);
  return { firmPercent, partialPercent };
}

// Rendu du dropdown "Historique" — même en-tête bg-[#F8FAF9]/uppercase, même taille de texte
// et de padding partout, pour se lire comme un simple prolongement de la carte plutôt que
// comme un composant visuellement différent. Colonnes justifiées (numériques/montants à
// droite, badges/action centrés, texte à gauche) et compactées pour tenir sans défilement dans
// une carte de largeur standard (max-w-[860px]).
//
// Bandeau récapitulatif en pied de tableau (fond sombre, barre orange) : Total jalon / Validé /
// Reste calculés depuis `totalPercent` (le cumul RÉEL, fourni par l'appelant — jamais déduit de
// `rows[rows.length-1]`) : une vue peut filtrer `rows` pour n'afficher qu'un sous-ensemble de
// versions (signalé 2026-09-05 — la page prestataire ne liste que les soumissions, la vue
// client que ses validations), auquel cas la dernière ligne AFFICHÉE ne porte plus forcément le
// cumul le plus à jour (ex. une soumission déjà validée depuis, mais dont la ligne "-val" a été
// filtrée) — le bandeau doit rester exact malgré ce filtrage.
//
// "Soumettre preuve" — UNIQUEMENT sur la ligne de la DERNIÈRE version affichée (le cycle en
// cours), jamais au niveau du titre : `canSubmitProofs` détermine si l'action est possible
// (toujours false côté client, qui ne soumet jamais de preuve), `submitLabel`/`onSubmit` sont
// fournis par l'appelant. Sans historique du tout (toute première soumission), l'état vide
// propose directement ce bouton plutôt que de renvoyer ailleurs.
export function RowHistoryTable({
  rows,
  montant,
  currency,
  totalPercent,
  onViewBatch,
  canSubmitProofs,
  submitLabel,
  onSubmit,
  view,
  currentStatus,
  reviewOpenedAt,
}: {
  /** Lignes "preuve" uniquement (un lot de soumission = une version "01-V1"…) — les DEUX vues
   *  passent désormais le MÊME filtre (`r.kind === "preuve"`), voir la règle de synchronisation
   *  au-dessus de `getRowTypeStatus` : même correspondance ligne à ligne entre le tableau
   *  Soumission (prestataire) et le tableau Validation (client), seuls Type/Statut diffèrent. */
  rows: HistoryRow[];
  montant: number;
  currency: string;
  /** Cumul RÉEL (0-100), indépendant du filtrage de `rows` — voir latestCheckpointProgress côté
   *  appelant. */
  totalPercent: number;
  onViewBatch: (attachments: HistoryAttachment[]) => void;
  canSubmitProofs: boolean;
  submitLabel: string;
  onSubmit: () => void;
  /** Vue appelante — détermine le Type ("Soumission"/"Validation") et les libellés de Statut
   *  (voir getRowTypeStatus). */
  view: "prestataire" | "client";
  /** État normalisé du jalon/de la mission (voir normalizeJalonSubmissionStatus /
   *  normalizeMissionSubmissionStatus) — ne pèse que sur la ligne COURANTE (dernière du
   *  tableau) ; les lots déjà clos gardent le statut figé par leur `outcome`. */
  currentStatus: SubmissionStatus;
  /** Jalon.reviewOpenedAt / Mission.reviewOpenedAt — distingue "En attente" de "En cours" côté
   *  client tant que `currentStatus === "submitted"`. Sans effet côté prestataire. */
  reviewOpenedAt: string | null;
}) {
  // Suivi LOCAL (par ouverture du dropdown) des lots déjà consultés — bascule le libellé
  // Action de "Voir" à "Ouvert ✓" après un premier clic, sans persister au-delà de cette
  // session d'affichage (se réinitialise si le dropdown est replié puis redéplié).
  const [openedIds, setOpenedIds] = useState<Record<string, boolean>>({});

  const SubmitButton = () => (
    <button
      onClick={onSubmit}
      className="inline-flex items-center gap-1 text-[#6d28d9] text-[11.5px] font-semibold hover:underline whitespace-nowrap"
    >
      <Upload className="w-3 h-3" />
      {submitLabel}
    </button>
  );

  if (rows.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-[12px] text-[#94A3B8]">Aucune preuve ni validation partielle pour l&apos;instant.</p>
        {canSubmitProofs && (
          <div className="mt-2">
            <SubmitButton />
          </div>
        )}
      </div>
    );
  }

  const totalMontantCumulative = Math.round((totalPercent / 100) * montant);
  const remainingPercent = Math.max(0, 100 - totalPercent);
  const remainingMontant = Math.max(0, montant - totalMontantCumulative);
  const money = (v: number) => `${v.toLocaleString("fr-FR")} ${currency}`;

  return (
    <div>
      {/* Table versionnée — tablette/plein écran (≥ sm). Sur mobile (< sm), une variante en
          CARTES empilées est rendue à la place (voir plus bas) : chaque version devient une
          carte lisible sans défilement horizontal. La table garde une min-w et défile dans sa
          propre zone si besoin — jamais le bandeau ci-dessous, toujours pleine largeur. */}
      <div className="hidden sm:block">
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
        <table className="w-full min-w-[600px] text-[12px]">
        <thead>
          <tr className="bg-[#F8FAF9] text-[10.5px] tracking-wide text-[#64748B] uppercase">
            <th className="text-left font-semibold py-1.5 px-1.5 whitespace-nowrap">Version</th>
            <th className="hidden md:table-cell text-center font-semibold py-1.5 px-1.5 whitespace-nowrap">Type</th>
            <th className="hidden md:table-cell text-right font-semibold py-1.5 px-1.5 whitespace-nowrap">Preuves</th>
            <th className="text-right font-semibold py-1.5 px-1.5 whitespace-nowrap" title="% de progression validé par le client pour cette version — le cumul figure dans la barre de l'en-tête">% partielle</th>
            <th className="text-center font-semibold py-1.5 px-1.5 whitespace-nowrap">Statut</th>
            <th className="text-center font-semibold py-1.5 px-1.5 whitespace-nowrap">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isLast = i === rows.length - 1;
            const when = new Date(r.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
            // Type + Statut dérivés de la règle de synchronisation prestataire/client — voir
            // getRowTypeStatus.
            const { typeLabel, statutLabel, badgeClass } = getRowTypeStatus(r, isLast, view, currentStatus, reviewOpenedAt);
            return (
              <tr key={r.id} className="border-t border-[#F1F5F9]">
                <td className="py-1.5 px-1.5 whitespace-nowrap" title={`Par ${r.by}`}>
                  <div className="font-mono font-semibold text-[#0f172a]">{r.version}</div>
                  <div className="text-[10.5px] text-[#94A3B8] mt-0.5">{when}</div>
                </td>
                <td className="hidden md:table-cell py-1.5 px-1.5 text-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap ${badgeClass}`}>
                    {typeLabel}
                  </span>
                </td>
                <td className="hidden md:table-cell py-1.5 px-1.5 text-right text-[#64748B] whitespace-nowrap">{r.proofsLabel}</td>
                <td className="py-1.5 px-1.5 text-right font-bold text-[#0f172a] whitespace-nowrap">{r.percentPartial}%</td>
                <td className="py-1.5 px-1.5 text-center">
                  {/* Sur une ligne "preuve", le badge passe automatiquement de "Envoyée" à
                      "Validé" ou "Rejeté" selon l'issue de ce lot précis (r.outcome) — pas
                      d'action manuelle requise. Une ligne "validation" reste "Confirmé". */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap ${badgeClass}`}>
                    {statutLabel}
                  </span>
                </td>
                <td className="py-1.5 px-1.5 text-center whitespace-nowrap">
                  {/* "Soumettre preuve" n'apparaît QUE sur la ligne de la DERNIÈRE version
                      (isLast) ET si l'appelant l'autorise (canSubmitProofs). Les autres lignes
                      (versions précédentes, déjà closes) gardent uniquement "Voir"/"—". */}
                  <div className="flex flex-col items-center gap-1">
                    {r.kind === "preuve" ? (
                      <button
                        onClick={() => {
                          onViewBatch(r.batchAttachments);
                          setOpenedIds((prev) => ({ ...prev, [r.id]: true }));
                        }}
                        className="inline-flex items-center gap-1 text-[#1E40AF] text-[12px] font-semibold hover:underline"
                      >
                        {openedIds[r.id] ? (
                          <>Ouvert <Check className="w-3.5 h-3.5" /></>
                        ) : (
                          <>Voir <ExternalLink className="w-3 h-3" /></>
                        )}
                      </button>
                    ) : (
                      !(isLast && canSubmitProofs) && <span className="text-[#94A3B8] text-[12px]">—</span>
                    )}
                    {isLast && canSubmitProofs && <SubmitButton />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      </div>

      {/* Variante MOBILE (< sm) : chaque version en carte empilée — version + date, badge
          Statut, % partielle, motif (rejet) et action Voir. Le TYPE et les PREUVES sont
          masqués en mobile (demande utilisateur 2026-09-05). */}
      <div className="sm:hidden divide-y divide-[#F1F5F9]">
        {rows.map((r, i) => {
          const isLast = i === rows.length - 1;
          const when = new Date(r.createdAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          const { statutLabel, badgeClass } = getRowTypeStatus(r, isLast, view, currentStatus, reviewOpenedAt);
          const badge = (label: string) => (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap ${badgeClass}`}>{label}</span>
          );
          return (
            <div key={r.id} className="px-3.5 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono font-semibold text-[#0f172a] text-[13px]">{r.version}</div>
                  <div className="text-[10.5px] text-[#94A3B8] mt-0.5">{when}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {/* TYPE masqué en mobile — seul le Statut reste dans la carte. */}
                  {badge(statutLabel)}
                  {r.kind === "preuve" && (
                    <button
                      onClick={() => { onViewBatch(r.batchAttachments); setOpenedIds((prev) => ({ ...prev, [r.id]: true })); }}
                      className="inline-flex items-center gap-1 text-[#1E40AF] text-[12px] font-semibold"
                    >
                      {openedIds[r.id] ? <>Ouvert <Check className="w-3.5 h-3.5" /></> : <>Voir <ExternalLink className="w-3 h-3" /></>}
                    </button>
                  )}
                </div>
              </div>
              {/* PREUVES masquées en mobile — seul le % de progression validée reste affiché. */}
              <div className="mt-2.5 rounded-lg bg-[#F8FAF9] border border-[#F1F5F9] px-2.5 py-1.5 flex items-center justify-between text-[12px]">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">% partielle</span>
                <span className="text-[#0f172a] font-bold">{r.percentPartial}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bandeau récapitulatif — Total jalon / Validé / Reste, avec barre de progression. */}
      <div className="bg-[#0A1931] text-white px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-[11.5px]">
          Total jalon <strong>{money(montant)}</strong> — Validé <strong>{totalPercent}%</strong> {money(totalMontantCumulative)} libéré — Reste{" "}
          <strong>{remainingPercent}%</strong> {money(remainingMontant)}
        </span>
        <div className="flex-1 min-w-[120px] h-2 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#F7C948] to-[#FF6B35]" style={{ width: `${totalPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

// En-tête "montant + conversion EUR + barre bicolore ferme/hachurée + légende" — identique
// entre les deux vues (prestataire ET client), factorisé pour éviter deux copies de la même
// barre et de sa légende.
export function AmountProgressBar({
  montant,
  currency,
  totalPercent,
  firmPercent,
  partialPercent,
}: {
  montant: number;
  currency: string;
  totalPercent: number;
  firmPercent: number;
  partialPercent: number;
}) {
  return (
    <>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <span className="text-[15px] font-bold text-[#0f172a] whitespace-nowrap">{montant.toLocaleString("fr-FR")} {currency}</span>
        {currency === "XOF" && (
          <span className="px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] text-[11px] font-medium whitespace-nowrap">
            ≈ {xofToEur(montant).toLocaleString("fr-FR")} €
          </span>
        )}
        <div className="relative flex-1 min-w-[100px] h-2.5 rounded-full bg-[#F1F5F9] overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-[#008751]" style={{ width: `${firmPercent}%` }} />
          <div
            className="absolute inset-y-0"
            style={{
              left: `${firmPercent}%`,
              width: `${partialPercent}%`,
              backgroundImage: "repeating-linear-gradient(45deg, rgba(0,135,81,0.6) 0 4px, rgba(0,135,81,0.28) 4px 8px)",
            }}
          />
        </div>
        <span className="text-[13px] font-bold text-[#0f172a] whitespace-nowrap">{totalPercent}%</span>
      </div>

      {totalPercent > 0 && (
        <div className="mt-1.5 flex items-center gap-4 flex-wrap text-[10.5px] text-[#64748B]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#008751] inline-block shrink-0" />
            0–{firmPercent}% validé ferme
          </span>
          {partialPercent > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full inline-block shrink-0"
                style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(0,135,81,0.6) 0 2px, rgba(0,135,81,0.28) 2px 4px)" }}
              />
              {firmPercent}–{totalPercent}% validé partiel hachuré
            </span>
          )}
        </div>
      )}
    </>
  );
}
