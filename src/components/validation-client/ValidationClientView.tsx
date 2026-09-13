"use client";

/**
 * Vue "Validation Client" — une carte par jalon (badge #, statut, % du total, progression
 * déclarée, barre bicolore ferme/hachurée) + un dropdown "Historique" des SOUMISSIONS du
 * prestataire. Le bouton « Apprécier » de l'en-tête (ou « Voir » d'une ligne d'historique)
 * ouvre la MODALE « Apprécier les preuves + Constat » —
 * ClientProofValidationModal.tsx, reproduction intégrale de la maquette
 * Flexwork-Modal-Client-Validation-Preuve.html (2026-09-08).
 *
 * Répartition des gestes depuis cette refonte :
 *   - DANS la modale : appréciation preuve par preuve (Valider / Rejeter avec raison + motif
 *     ≥ 4 + « Demander nouvelle preuve »), taux d'exécution CONSTATÉ sur site, texte du
 *     constat, capture de position, preuves de constat du client, attestation, et un unique
 *     bouton « Enregistrer appréciation + constats » (= point d'étape au taux constaté,
 *     POST .../checkpoint, qui notifie le prestataire avec le texte du constat).
 *   - HORS modale, sur l'en-tête de carte : la validation FINALE qui libère les fonds
 *     (« Valider — montant »), visible seulement à 100% constatés et toutes preuves du lot
 *     validées. La maquette ne porte qu'un bouton d'enregistrement : le geste irréversible
 *     ne pouvait pas s'y cacher.
 *   - Plus de « Rejeter » de LOT : côté serveur, rejeter UNE preuve rejette déjà
 *     automatiquement la soumission (autoRejectSubmissionOperations,
 *     src/lib/proof-appreciation.ts) — le rejet par preuve de la maquette EST le chemin de
 *     rejet, l'ancien bouton global faisait doublon.
 *
 * Composant AUTONOME (charge ses propres données) — factorisé (règle R03) pour être utilisé
 * par missions/[id]/escrow/page.tsx (section intégrée à la page séquestre) et, via
 * ClientValidationWorkspace, par missions/[id]/page.tsx pour le client propriétaire (vue
 * « Validation Client » dans le chrome client ; l'ancienne route
 * missions/[id]/validation-client redirige désormais vers /missions/[id]).
 *
 * Progression déclarée/constatée : un contrat SANS jalon a SES PROPRES champs
 * Mission.declaredProgress/observedProgress (pendant de Jalon.declaredProgress/
 * observedProgress) — les deux scopes se comportent à l'identique. La validation
 * (escrow/release) exige 100% constatés, comme pour un jalon. Un rejet remet les deux
 * progressions à 0 (escrow/reject/route.ts) — nouveau cycle, même règle que Jalon.reject.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, BadgeCheck } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { refreshBadges } from "@/lib/badge-sync";
import { useUserIdentity } from "@/components/user-identity";
import ClientProofValidationModal, { type ConstatProof } from "@/components/validation-client/ClientProofValidationModal";
import { cumulativeCheckpointProgress, type Checkpoint } from "@/components/progress-checkpoints";
import { releasableBeforeRetention, retentionAmount } from "@/lib/jalons";
// Même modèle que la vue prestataire (missions/[id]/deliverable) — badge domaine, montant +
// conversion EUR + barre bicolore ferme/hachurée + légende, dropdown "Historique"
// Version/Type/Preuves/%cumulé/Statut/Action (signalé 2026-09-05 : "utiliser ce modèle... au
// niveau client"). `canSubmitProofs` reste FIGÉ à false ici : le client ne soumet jamais de
// preuve, seul "Voir" (lecture seule) lui est ouvert dans la colonne Action.
import {
  PROFESSIONAL_TYPE_LABEL,
  RowHistoryTable,
  AmountProgressBar,
  buildHistoryRows,
  firmAndPartialPercent,
  normalizeJalonSubmissionStatus,
  normalizeMissionSubmissionStatus,
  type Rejection,
  type HistoryAttachment,
} from "@/components/mission-history-table";

type Mission = {
  id: string; titre: string; budget: number; currency: string; status: string; isOwner: boolean;
  contractPrice: number | null; declaredProgress: number; observedProgress: number;
  professionalType: string | null;
  reviewOpenedAt: string | null;
};
type Jalon = {
  id: string;
  ordre: number;
  titre: string;
  montant: number;
  status: string;
  revisionCount: number;
  rejectionReason: string | null;
  declaredProgress: number;
  observedProgress: number;
  reviewOpenedAt: string | null;
};
// Forme minimale d'une preuve acceptée par les aperçus (ProofItem/ProofSummaryGrid) : les
// deux sources la satisfont — le `Attachment` local de cette vue (porte `mimeType`) et le
// `HistoryAttachment` partagé du dropdown "Historique" (sans `mimeType`, les lots relus depuis
// "Voir" y sont typés ainsi). `mimeType` optionnel : utilisé uniquement par la vidéo.
// Champs d'appréciation du client portés par chaque preuve (2026-09-05) : optionnels car
// absents sur les lots historiques du dropdown (HistoryAttachment n'en porte pas). Voir
// MissionAttachment (prisma/schema.prisma) — appreciation: null | "validee" | "rejetee".
type ProofLike = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  mimeType?: string | null;
  // Taille réelle du fichier stocké (octets) — affichée sous chaque vignette de la modale
  // d'appréciation. null/absente pour les preuves texte-seules (géoloc, note libre).
  size?: number | null;
  createdAt: string;
  url: string | null;
  appreciation?: string | null;
  rejectionReason?: string | null;
  rejectionMotif?: string | null;
  requestNewProof?: boolean;
  appreciatedAt?: string | null;
};
type Attachment = ProofLike & { mimeType: string | null };
// Type du payload de rejet d'une preuve — même forme que la route .../appreciate (action
// "rejetee") : raison prédéfinie + motif détaillé ≥ 20 + demande de nouvelle preuve.
type ProofRejectPayload = { reason: string; motif: string; requestNewProof: boolean };

const JALON_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: "En attente de financement", color: "text-[#64748B]" },
  fonds_sous_sequestre: { label: "Financé — en attente du prestataire", color: "text-[#008751]" },
  livrable_soumis: { label: "À valider", color: "text-[#B45309]" },
  valide: { label: "Validé — libération en cours", color: "text-[#008751]" },
  rejete: { label: "Rejeté — en attente de resoumission", color: "text-[#E8112D]" },
  libere: { label: "Payé", color: "text-[#008751]" },
};

const MISSION_ESCROW_STATUS: Record<string, { label: string; color: string }> = {
  fonds_sous_sequestre: { label: "Financé — en attente du prestataire", color: "text-[#008751]" },
  en_cours: { label: "Financé — en attente du prestataire", color: "text-[#008751]" },
  livrable_soumis: { label: "À valider", color: "text-[#B45309]" },
};


type Row = {
  key: string;
  ordre: number;
  titre: string;
  montant: number;
  currency: string;
  statusLabel: string;
  canDecide: boolean;
  declaredProgress: number;
  observedProgress: number;
  attachments: Attachment[];
  /** Statut brut du jalon/de la mission — dérivé en Type/Statut du tableau "Validation" via
   *  normalizeJalonSubmissionStatus/normalizeMissionSubmissionStatus + getRowTypeStatus (règle
   *  de synchronisation prestataire/client, mission-history-table.tsx). */
  status: string;
  reviewOpenedAt: string | null;
  scope: { kind: "jalon"; jalonId: string } | { kind: "mission" };
};

// Lit "lat,long" (POST .../deliverable, category "geolocation" — coordonnées réelles via
// navigator.geolocation, jamais inventées) en deux nombres finis, ou null si le format est
// inattendu — jamais de coordonnées bidon affichées sur un lien de carte.
function parseLatLng(note: string | null): { lat: number; lng: number } | null {
  if (!note) return null;
  const [latStr, lngStr] = note.split(",");
  const lat = Number(latStr);
  const lng = Number(lngStr);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Même lot de preuves ? (comparaison par id, insensible aux nouvelles références d'objets après
// un `reload`) — permet de retrouver la version ("01-V1") d'un lot relu depuis le dropdown.
function sameBatchIds(a: HistoryAttachment[], b: HistoryAttachment[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((x) => x.id));
  return b.every((x) => ids.has(x.id));
}

// ── Appréciation de CHAQUE preuve : la carte, son lecteur par type et le formulaire de
// rejet vivent désormais dans ClientProofValidationModal (reproduction de la maquette
// Flexwork-Modal-Client-Validation-Preuve.html, 2026-09-08). Cette vue ne garde que le
// pilotage : quelles preuves sont appréciables (lot courant), quels appels réseau les
// enregistrent, et la validation finale sur l'en-tête de carte.

export function ValidationClientView({ missionId, onMissionChange }: { missionId: string; onMissionChange?: (mission: Mission) => void }) {
  const router = useRouter();
  // Identité réelle du client — chargée une fois au niveau racine (UserIdentityProvider).
  const identity = useUserIdentity();
  const [mission, setMission] = useState<Mission | null>(null);
  const [jalons, setJalons] = useState<Jalon[] | null>(null);
  const [attachmentsByJalon, setAttachmentsByJalon] = useState<Record<string, Attachment[]>>({});
  const [missionAttachments, setMissionAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  // Preuve en cours d'appréciation (Valider/Rejeter) — évite les doubles clics, par preuve.
  const [appreciating, setAppreciating] = useState<string | null>(null);
  // Toast de confirmation (maquette Flexwork-Modal-Appreciation-Preuves.html, 2026-09-08) —
  // même rôle informatif après chaque décision (preuve ou jalon), auto-masqué après 3s. Un
  // nouveau toast remplace le précédent (pas de file d'attente, une seule notification à la
  // fois suffit pour ce flux).
  const [toast, setToast] = useState<string | null>(null);
  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3000);
  }
  const [observedDraft, setObservedDraft] = useState<Record<string, number>>({});
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  // Dropdown "Historique" par jalon — INDÉPENDANT du panneau de décision (openRowKey), même
  // modèle que la vue prestataire (2026-09-05, "remplacer intégralement la carte") : la carte
  // affiche toujours son en-tête + montant/barre, le chevron ne déplie QUE l'historique
  // versionné, "Vérifier" ouvre séparément le panneau de décision (preuves, déclaration,
  // validation, rejet).
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  // ── Bloc « Votre constat sur site » de la modale (maquette
  //    Flexwork-Modal-Client-Validation-Preuve.html), indexé par périmètre (jalonId ou
  //    "mission") : deux jalons ouverts tour à tour n'échangent ni leur texte de constat, ni
  //    leurs preuves de constat, ni leur attestation.
  const [constatByScope, setConstatByScope] = useState<Record<string, ConstatProof[]>>({});
  const [constatText, setConstatText] = useState<Record<string, string>>({});
  const [attested, setAttested] = useState<Record<string, boolean>>({});
  // Catégorie de constat en cours d'envoi (`constat_photo`…) — grise le bouton « + Ajouter ».
  const [constatBusy, setConstatBusy] = useState<string | null>(null);
  // Prestataire du contrat — nom et initiales affichés dans l'en-tête de la modale
  // (« Client RH • Prestataire JD » dans la maquette). Le client, lui, vient de l'identité
  // déjà chargée au niveau racine.
  const [providerParty, setProviderParty] = useState<{ firstname: string | null; lastname: string | null } | null>(null);
  // Taux de retenue de garantie du contrat (0 hors mode J4) — alimente les montants annoncés.
  const [retentionRate, setRetentionRate] = useState(0);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  // Historique des rejets — pendant de `checkpoints`, même modèle que la vue prestataire (voir
  // GET .../rejections). Alimente le dropdown "Historique" pour distinguer une soumission
  // REJETÉE de son remplacement corrigé, plutôt que le seul dernier motif encore affiché sur
  // le jalon (rejectionReason, écrasé à chaque nouveau rejet).
  const [rejections, setRejections] = useState<Rejection[]>([]);
  // Lot de preuves à relire dans la modale de décision (bouton "Voir" du dropdown) : quand la
  // modale est ouverte DEPUIS une ligne "01-V1/01-V2", la section preuves montre CE lot (lecture
  // du lot précis, corrélation prestataire) ; null → la modale ouverte depuis l'en-tête
  // ("Voir"/"Vérifier") affiche toutes les preuves courantes du périmètre.
  const [viewingBatch, setViewingBatch] = useState<HistoryAttachment[] | null>(null);

  // Prestataire du contrat — l'en-tête de la modale nomme les deux parties
  // (« Client X • Prestataire Y »), pas des initiales figées.
  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}/contract`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c) return;
        if (c.provider) setProviderParty({ firstname: c.provider.firstname ?? null, lastname: c.provider.lastname ?? null });
        // Retenue de garantie (mode J4) figée au contrat. Sans elle, le bouton de validation
        // annonçait le montant NOMINAL du jalon alors que l'instruction transmise au PSP vaut
        // `montant − retenue` : le client lisait « Valider — 600 000 XOF » pour une libération
        // réelle de 570 000. Le taux vient du contrat, jamais du catalogue de modes — c'est
        // celui sous lequel les deux parties ont signé.
        if (typeof c.retentionRate === "number") setRetentionRate(c.retentionRate);
      })
      .catch(() => {});
  }, [missionId]);

  // Réseau injoignable (serveur arrêté/en recompilation, connexion coupée) — `fetch` REJETTE
  // au lieu de renvoyer une réponse. Sans ce garde, la promesse non gérée remontait en
  // « Unhandled Runtime Error / TypeError: Failed to fetch » (overlay Next) au lieu d'un
  // message lisible : un simple redémarrage du serveur cassait visuellement la page.
  function onNetworkError() {
    setError("Connexion au serveur perdue — vérifiez votre réseau puis réessayez.");
  }

  function reload() {
    fetchDedupe(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then((m) => {
      setMission(m);
      if (m) onMissionChange?.(m);
      // « Client ouvre la validation » (règle de synchronisation prestataire/client) : dès que
      // ce tableau charge une mission sans jalon dont le livrable est soumis et pas encore
      // consulté, on le marque ouvert — fait passer le Statut du tableau "Validation" de
      // "En attente" à "En cours" côté client, sans rien changer côté "Soumission" prestataire.
      if (m && m.status === "livrable_soumis" && !m.reviewOpenedAt) markMissionReviewOpened();
    }).catch(onNetworkError);
    fetchDedupe(`/api/missions/${missionId}/jalons`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => {
      const items: Jalon[] = d.items ?? [];
      setJalons(items);
      if (items.length > 0) {
        items.filter((j) => j.status === "livrable_soumis").forEach((j) => {
          loadAttachments(j.id);
          if (!j.reviewOpenedAt) markJalonReviewOpened(j.id);
        });
      } else {
        loadMissionAttachments();
      }
    }).catch(onNetworkError);
    loadCheckpoints();
    loadRejections();
  }

  // Marque le livrable soumis (mission sans jalon / jalon) comme consulté par le client — mise
  // à jour optimiste locale plutôt qu'un `reload()` complet, pour ne pas relancer ce même appel
  // en boucle. Idempotent côté serveur (voir POST .../review-open).
  async function markMissionReviewOpened() {
    const res = await fetch(`/api/missions/${missionId}/deliverable/review-open`, { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setMission((prev) => (prev ? { ...prev, reviewOpenedAt: d.reviewOpenedAt ?? prev.reviewOpenedAt } : prev));
    }
  }
  async function markJalonReviewOpened(jalonId: string) {
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/review-open`, { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setJalons((prev) => (prev ? prev.map((j) => (j.id === jalonId ? { ...j, reviewOpenedAt: d.reviewOpenedAt ?? j.reviewOpenedAt } : j)) : prev));
    }
  }

  async function loadCheckpoints() {
    try {
      const res = await fetchDedupe(`/api/missions/${missionId}/checkpoints`);
      if (res.ok) {
        const d = await res.json();
        setCheckpoints(d.items ?? []);
      }
    } catch {
      onNetworkError();
    }
  }

  async function loadRejections() {
    try {
      const res = await fetchDedupe(`/api/missions/${missionId}/rejections`);
      if (res.ok) {
        const d = await res.json();
        setRejections(d.items ?? []);
      }
    } catch {
      onNetworkError();
    }
  }

  async function loadAttachments(jalonId: string) {
    try {
      const res = await fetchDedupe(`/api/missions/${missionId}/jalons/${jalonId}/attachments`);
      if (res.ok) {
        const d = await res.json();
        setAttachmentsByJalon((prev) => ({ ...prev, [jalonId]: d.items }));
      }
    } catch {
      onNetworkError();
    }
  }

  async function loadMissionAttachments() {
    try {
      const res = await fetchDedupe(`/api/missions/${missionId}/deliverable`);
      if (res.ok) {
        const d = await res.json();
        setMissionAttachments(d.items ?? []);
      }
    } catch {
      onNetworkError();
    }
  }

  useEffect(reload, [missionId]);
  // Resynchronisation quand l'onglet reprend le focus : l'autre partie (prestataire sur
  // /deliverable) agit dans SON onglet — les choix de progression, le statut et les preuves
  // de CETTE vue reflètent alors l'état réel (2026-09-05).
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [missionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Déplie la fiche du jalon en resynchronisant d'abord jalons/mission — la progression
  // déclarée par le prestataire (declaredProgress) a pu changer depuis le chargement de la
  // page (le prestataire agit sur sa propre page, sans lien en temps réel vers celle-ci) :
  // sans ce reload, la fiche dépliée pouvait montrer une valeur périmée au moment précis où
  // le client s'apprête à décider.
  // Ouvre la modale de décision depuis l'EN-TÊTE de carte ("Voir"/"Vérifier") — affiche toutes
  // les preuves courantes du périmètre (aucun lot précis sélectionné).
  function openVerification(key: string) {
    setViewingBatch(null);
    setOpenRowKey(key);
    reload();
    loadConstat(key === "mission" ? null : key);
  }

  // Ouvre la même modale depuis le "Voir" d'une ligne du dropdown "Historique" : la section
  // preuves est alors bornée au LOT relu (lecture + décision, corrélation prestataire
  // 2026-09-05). `reload` rafraîchit l'état (progression…) sans toucher au lot affiché.
  function openBatchReview(batch: HistoryAttachment[], key: string) {
    setViewingBatch(batch);
    setOpenRowKey(key);
    reload();
    loadConstat(key === "mission" ? null : key);
  }

  // Ferme la modale de décision (Échap, ✕, clic sur le fond, bascule de l'en-tête) — remet
  // aussi à zéro le lot relu.
  function closeDecision() {
    setOpenRowKey(null);
    setViewingBatch(null);
  }

  // Appréciation d'UNE preuve par le client (2026-09-05, maquette "Appréciation des
  // preuves") — pré-validation par preuve, persistée (POST .../appreciate). `row` fournit le
  // scope (jalon ou mission entière). Après succès, `reload` rafraîchit l'état des preuves.
  async function validateProof(row: Row, attachmentId: string) {
    const jalonId = row.scope.kind === "jalon" ? row.scope.jalonId : null;
    const url = jalonId
      ? `/api/missions/${missionId}/jalons/${jalonId}/deliverable/${attachmentId}/appreciate`
      : `/api/missions/${missionId}/deliverable/${attachmentId}/appreciate`;
    setError(null);
    setAppreciating(attachmentId);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validee" }),
      });
    } catch {
      setAppreciating(null);
      onNetworkError();
      return;
    }
    setAppreciating(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "proof_locked"
          ? "Cette preuve fait partie de l'historique (déjà décidée) — elle ne peut plus être modifiée."
          : "Échec de la validation de la preuve."
      );
      return;
    }
    showToast("Appréciation enregistrée — freelance notifié");
    reload();
  }

  // ── Preuves de CONSTAT du client (GET/POST/DELETE .../constat, voir src/lib/constat.ts).
  //    Elles n'entrent JAMAIS dans le lot du prestataire : les listes de livrable les
  //    excluent côté serveur, elles ne sont ni appréciées ni comptées dans « N preuves ».
  async function loadConstat(jalonId: string | null) {
    const url = jalonId
      ? `/api/missions/${missionId}/constat?jalonId=${jalonId}`
      : `/api/missions/${missionId}/constat`;
    try {
      const res = await fetchDedupe(url);
      if (!res.ok) return;
      const d = await res.json();
      setConstatByScope((prev) => ({ ...prev, [jalonId ?? "mission"]: d.items ?? [] }));
    } catch {
      onNetworkError();
    }
  }

  async function uploadConstatProof(jalonId: string | null, category: string, opts: { file?: File; note?: string }) {
    setError(null);
    setConstatBusy(category);
    const formData = new FormData();
    formData.append("category", category);
    if (jalonId) formData.append("jalonId", jalonId);
    if (opts.file) formData.append("file", opts.file);
    if (opts.note) formData.append("note", opts.note);
    let res: Response;
    try {
      res = await fetch(`/api/missions/${missionId}/constat`, { method: "POST", body: formData });
    } catch {
      setConstatBusy(null);
      onNetworkError();
      return;
    }
    setConstatBusy(null);
    if (!res.ok) {
      setError("Échec de l'ajout de la preuve de constat.");
      return;
    }
    loadConstat(jalonId);
  }

  async function removeConstatProof(jalonId: string | null, attachmentId: string) {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/missions/${missionId}/constat/${attachmentId}`, { method: "DELETE" });
    } catch {
      onNetworkError();
      return;
    }
    if (!res.ok) {
      setError("Échec de la suppression de la preuve de constat.");
      return;
    }
    loadConstat(jalonId);
  }

  // Coordonnées RÉELLES (navigator.geolocation) — jamais de position inventée, même règle que
  // la capture de position côté prestataire.
  function captureConstatGeolocation(jalonId: string | null) {
    if (!navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => uploadConstatProof(jalonId, "constat_geolocation", { note: `${pos.coords.latitude},${pos.coords.longitude}` }),
      () => setError("Position non capturée — vérifiez l'autorisation de géolocalisation."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Pastille violette de la maquette — la dernière position capturée pour ce périmètre.
  function constatGeoLabel(jalonId: string | null): string | null {
    const items = constatByScope[jalonId ?? "mission"] ?? [];
    const geo = items.filter((p) => p.category === "constat_geolocation").slice(-1)[0];
    const coords = geo ? parseLatLng(geo.note) : null;
    if (!coords) return null;
    return `${coords.lat.toFixed(4)}° N, ${coords.lng.toFixed(4)}° E`;
  }

  // Bouton principal de la maquette (« Enregistrer appréciation + constats ») : confirme le
  // point d'étape au taux constaté et transporte le texte du constat jusqu'au prestataire
  // (POST .../checkpoint, qui le joint à la notification). Ne libère aucun fonds — la
  // validation finale reste un geste distinct, sur l'en-tête de carte.
  //
  // `progress` est FOURNI par l'appelant (la valeur exacte affichée par le curseur,
  // `draftValue`) plutôt que recalculé ici : le curseur retombe sur la progression DÉCLARÉE
  // par le prestataire quand le client n'a encore rien constaté, alors qu'un recalcul local
  // retombait sur `observedProgress` (0). Les deux divergeaient — la modale affichait 50%
  // et le point d'étape enregistrait 0%, sans que rien ne le signale.
  async function saveAppreciationAndConstat(row: Row, progress: number) {
    const jalonId = row.scope.kind === "jalon" ? row.scope.jalonId : null;
    const key = jalonId ?? "mission";
    const note = (constatText[key] ?? "").trim();
    setError(null);
    setSubmitting(jalonId ? `${jalonId}:step` : "mission:step");
    const url = jalonId
      ? `/api/missions/${missionId}/jalons/${jalonId}/checkpoint`
      : `/api/missions/${missionId}/checkpoint`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress, note: note || undefined }),
      });
    } catch {
      setSubmitting(null);
      onNetworkError();
      return;
    }
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "progress_regression"
          ? "Le taux constaté ne peut pas être inférieur au dernier point d'étape confirmé."
          : data.error === "proofs_not_validated" || data.error === "proofs_pending"
            ? "Appréciez d'abord chaque preuve du lot courant."
            : "Échec de l'enregistrement de l'appréciation et du constat."
      );
      return;
    }
    showToast(`Taux ${progress}% et constat enregistrés — prestataire notifié`);
    setConstatText((prev) => ({ ...prev, [key]: "" }));
    setAttested((prev) => ({ ...prev, [key]: false }));
    closeDecision();
    reload();
    refreshBadges();
  }

  async function rejectProof(row: Row, attachmentId: string, payload: ProofRejectPayload) {
    const jalonId = row.scope.kind === "jalon" ? row.scope.jalonId : null;
    const url = jalonId
      ? `/api/missions/${missionId}/jalons/${jalonId}/deliverable/${attachmentId}/appreciate`
      : `/api/missions/${missionId}/deliverable/${attachmentId}/appreciate`;
    setError(null);
    setAppreciating(attachmentId);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rejetee", reason: payload.reason, motif: payload.motif, requestNewProof: payload.requestNewProof }),
      });
    } catch {
      setAppreciating(null);
      onNetworkError();
      return;
    }
    setAppreciating(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "proof_locked"
          ? "Cette preuve fait partie de l'historique (déjà décidée) — elle ne peut plus être modifiée."
          : "Échec du rejet de la preuve."
      );
      return;
    }
    showToast("Preuve rejetée — nouvelle preuve demandée au prestataire");
    reload();
  }


  useEffect(() => {
    if (!openRowKey) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenRowKey(null);
        setViewingBatch(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRowKey]);

  async function handleRelease() {
    setError(null);
    setSubmitting("mission:submit");
    const res = await fetch(`/api/missions/${missionId}/escrow/release`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "progress_incomplete"
          ? "La progression constatée doit atteindre 100% avant de valider."
          : "Échec de la libération des fonds — vérifiez qu'un livrable a été soumis."
      );
      return;
    }
    router.push("/client/dashboard");
  }




  // "Validation partielle" — confirme et archive un point d'étape (progress courant, même
  // valeur que le curseur) SANS libérer de fonds ni changer le statut du jalon/mission :
  // distinct de validateJalon/handleRelease (voir POST .../checkpoint pour le rationale
  // complet). Disponible tant qu'un livrable est soumis, à n'importe quel niveau de
  // progression — pas seulement à 100%.


  async function validateJalon(jalonId: string) {
    setError(null);
    setSubmitting(`${jalonId}:submit`);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/validate`, { method: "POST" });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "progress_incomplete"
          ? "La progression constatée doit atteindre 100% avant de valider."
          : "Échec de la validation — vérifiez qu'un livrable a été soumis pour ce jalon."
      );
      return;
    }
    const j = jalons?.find((x) => x.id === jalonId);
    // Même règle que le bouton : on annonce le montant réellement libéré, retenue déduite.
    showToast(
      j
        ? `Jalon validé — ${releasableBeforeRetention(j.montant, retentionRate).toLocaleString("fr-FR")} ${mission?.currency ?? "XOF"} en cours de libération`
        : "Jalon validé — freelance notifié"
    );
    setOpenRowKey(null);
    reload();
    refreshBadges();
  }


  if (!mission || jalons === null) return <div className="py-16 text-center text-[13px] text-[#64748B]">Chargement...</div>;

  const usesJalons = jalons.length > 0;
  const currency = mission.currency;
  const rows: Row[] = usesJalons
    ? jalons.map((j) => ({
        key: j.id,
        ordre: j.ordre,
        titre: j.titre,
        montant: j.montant,
        currency,
        statusLabel: (JALON_STATUS[j.status] ?? { label: j.status, color: "text-[#64748B]" }).label,
        canDecide: j.status === "livrable_soumis",
        declaredProgress: j.declaredProgress,
        observedProgress: j.observedProgress,
        attachments: attachmentsByJalon[j.id] ?? [],
        status: j.status,
        reviewOpenedAt: j.reviewOpenedAt,
        scope: { kind: "jalon", jalonId: j.id },
      }))
    : [{
        key: "mission",
        ordre: 1,
        titre: mission.titre,
        montant: mission.contractPrice ?? mission.budget,
        currency,
        statusLabel: (MISSION_ESCROW_STATUS[mission.status] ?? { label: mission.status, color: "text-[#64748B]" }).label,
        canDecide: mission.status === "livrable_soumis",
        declaredProgress: mission.declaredProgress,
        observedProgress: mission.observedProgress,
        attachments: missionAttachments,
        status: mission.status,
        reviewOpenedAt: mission.reviewOpenedAt,
        scope: { kind: "mission" as const },
      }];
  const rowsToDecide = rows.filter((r) => r.canDecide);
  const totalMontant = rows.reduce((s, r) => s + r.montant, 0) || 1;

  // Noms et initiales des deux parties, affichés dans l'en-tête de la modale.
  const initialsOf = (name: string, fallback: string) => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return fallback;
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  };
  const clientDisplayName = identity?.name ?? "Client";
  const clientInitials = identity?.initials ?? initialsOf(clientDisplayName, "CL");
  const providerDisplayName =
    [providerParty?.firstname, providerParty?.lastname].filter(Boolean).join(" ") || "Prestataire";
  const providerInitials = initialsOf(providerDisplayName, "PR");

  // Le message "Seul le client peut déclencher les mouvements d'escrow" reste porté par la
  // page hôte (déjà affiché une fois pour toute la section escrow) — pas de doublon ici.
  if (!mission.isOwner) return null;

  return (
    <div>
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-[#F1F5F9] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">Validation Client</h2>
            <p className="text-[12px] text-[#64748B] mt-0.5">Mode client — vérification des preuves</p>
          </div>
          {/* Raccourci vers la 1ʳᵉ ligne "à valider" — ouvre la modale de lecture + décision.
              Absent tant qu'aucune ligne n'a de décision en attente. */}
          {rowsToDecide.length > 0 && (
            <button
              onClick={() => openVerification(rowsToDecide[0].key)}
              className="px-4 py-2 rounded-full bg-[#FEF3C7] border border-[#FCD34D] text-[13px] text-[#92400E] font-medium shrink-0 hover:brightness-95"
            >
              Apprécier • À valider{rowsToDecide.length > 1 ? ` (${rowsToDecide.length})` : ""}
            </button>
          )}
        </div>

        {/* Liste de jalons en CARTES (même modèle que la vue prestataire) — l'action de
            décision du client vit dans une MODALE de lecture + validation, ouverte par
            "Voir"/"Vérifier" de l'en-tête ou par "Voir" du dropdown "Historique"
            (corrélation prestataire 2026-09-05). Avant : panneau déplié EN PLACE sous la
            carte (signalé 2026-09-04, maquette Flexwork-Gestion-Missions-Dropdown adaptée au
            rôle client — "Soumission preuve"/"Déclaration progression" y restent en
            LECTURE SEULE, ce sont des actions prestataire, voir
            /missions/[id]/deliverable). */}
        <div className="p-4 space-y-3">
          {rows.map((row) => {
            const rowScopeKey = row.scope.kind === "jalon" ? row.scope.jalonId : null;
            const rowCheckpoints = checkpoints.filter((c) => c.jalonId === rowScopeKey);
            const rowRejections = rejections.filter((r) => r.jalonId === rowScopeKey);
            // Même modèle que la vue prestataire — historique versionné + barre bicolore
            // ferme/hachurée (voir mission-history-table.tsx).
            const historyRows = buildHistoryRows(row.attachments, rowCheckpoints, rowRejections, row.montant, row.ordre);
            // Taux cumulé CONFIRMÉ (monotone) : le plus haut niveau jamais confirmé par un
            // point d'étape — un point d'étape en baisse (régression) ne fait pas reculer la
            // barre/l'en-tête (voir cumulativeCheckpointProgress).
            const totalPercent = cumulativeCheckpointProgress(rowCheckpoints) ?? 0;
            const { firmPercent, partialPercent } = firmAndPartialPercent(historyRows, totalPercent);
            // Rien de neuf à vérifier depuis le dernier point d'étape confirmé : le
            // prestataire n'a pas déclaré plus de progression depuis (sa seule façon de
            // signaler une avancée tant que le statut reste "livrable_soumis" — il ne peut
            // pas resoumettre de nouvelles preuves sans un rejet préalable, voir
            // canSubmitJalonDeliverable). "Voir" plutôt que "Vérifier" : reconsulter ce qui
            // a déjà été traité, pas une nouvelle décision à prendre.
            const latestChecked = cumulativeCheckpointProgress(rowCheckpoints);
            const hasNothingNewToDecide = latestChecked !== null && row.declaredProgress <= latestChecked;
            const pctOfTotal = Math.round((row.montant / totalMontant) * 100);
            const isOpen = openRowKey === row.key;

            const jalonId = row.scope.kind === "jalon" ? row.scope.jalonId : null;
            const draftKey = jalonId ?? "mission";
            // Point de départ du curseur : le brouillon local en cours d'édition, sinon la
            // dernière progression constatée ENREGISTRÉE (le client a déjà vérifié une
            // fois), sinon — première vérification — la progression déclarée par le
            // prestataire comme base réaliste plutôt qu'un 0% arbitraire. Reste une
            // SUGGESTION : la validation exige toujours un geste explicite.
            // PLANCHER du curseur « Taux d'exécution constaté sur site » = cumul DÉJÀ CONFIRMÉ
            // fermement (`totalPercent`, le plus haut point d'étape jamais validé). Une fois
            // 50% confirmés sur le lot 01-V1, ces 50% sont définitivement acquis : le lot
            // suivant (01-V2) ne se constate qu'entre 50% et 100%, jamais en dessous — sinon
            // le cumul reculerait, et le total des tranches successives pourrait dépasser
            // 100%. La règle existait déjà côté serveur (POST .../checkpoint refuse en
            // `progress_regression`) mais l'écran laissait descendre jusqu'à 0 : le client ne
            // découvrait le refus qu'après avoir tout saisi.
            const progressFloor = totalPercent;
            // La valeur affichée ne peut jamais partir sous le plancher — y compris quand la
            // progression déclarée par le prestataire (valeur de départ suggérée) est plus
            // basse que ce qui est déjà acquis.
            const draftValue = Math.max(observedDraft[draftKey] ?? (row.observedProgress || row.declaredProgress), progressFloor);
            const savingStep = submitting === (jalonId ? `${jalonId}:step` : "mission:step");
            const savingDecision = submitting === (jalonId ? `${jalonId}:submit` : "mission:submit");
            const canValidate = row.observedProgress >= 100;
            const isModifyStep = hasNothingNewToDecide;

            // Lot COURANT (preuves "ouvertes") = soumises après la dernière décision de LOT
            // (point d'étape/rejet global, append-only) — ce sont elles que le client doit
            // apprécier (Valider/Rejeter) avant toute validation globale (2026-09-05).
            const lotDecisions = [...rowCheckpoints, ...rowRejections];
            const lastLotDecisionAt = lotDecisions.length
              ? new Date(Math.max(...lotDecisions.map((d) => new Date(d.createdAt).getTime())))
              : null;
            const openProofsRow = lastLotDecisionAt
              ? row.attachments.filter((a) => new Date(a.createdAt).getTime() > lastLotDecisionAt.getTime())
              : row.attachments;
            const appreciableIds = new Set(openProofsRow.map((a) => a.id));
            const openPendingCount = openProofsRow.filter((a) => !a.appreciation).length;
            const openRejectedCount = openProofsRow.filter((a) => a.appreciation === "rejetee").length;
            const proofsReady = openPendingCount === 0 && openRejectedCount === 0;

            // Dropdown "Historique" CÔTÉ CLIENT — mêmes lignes que le tableau "Soumission" du
            // prestataire (kind "preuve", un lot = une version "01-V1"…), règle de
            // synchronisation prestataire/client (mission-history-table.tsx :
            // getRowTypeStatus) : Type "Validation" + Statut dérivé de l'état réel du
            // jalon/de la mission (En attente/En cours tant que rien n'est décidé, Confirmé
            // une fois validé, Rejeté). Le client n'agit plus depuis ce tableau (Action "—") :
            // sa décision se prend dans la modale ouverte par "Vérifier"/"Voir" de l'en-tête.
            const clientHistoryRows = historyRows.filter((r) => r.kind === "preuve");
            const hasHistory = clientHistoryRows.length > 0;
            const currentStatus =
              row.scope.kind === "jalon" ? normalizeJalonSubmissionStatus(row.status) : normalizeMissionSubmissionStatus(row.status);
            // Preuves montrées dans la modale d'appréciation : le lot relu depuis le dropdown
            // (viewingBatch — historique, lecture seule) ou, depuis l'en-tête, le lot COURANT
            // (openProofsRow — les preuves à apprécier). `viewedVersion` alimente le
            // sous-titre de la modale ("lot 01-V1 — 3 preuves").
            const viewedVersion =
              viewingBatch && viewingBatch.length > 0
                ? historyRows.find((h) => h.kind === "preuve" && sameBatchIds(h.batchAttachments, viewingBatch))
                : undefined;
            const proofsShown: ProofLike[] = viewingBatch && viewingBatch.length > 0 ? viewingBatch : openProofsRow;
            // Bouton "Apprécier" (2026-09-08, maquette Flexwork-Modal-Appreciation-Preuves.html
            // — renommé depuis "Vérifier") — équivalent CLIENT de "Soumettre preuve" côté
            // prestataire (même position dans l'en-tête, juste avant le chevron) : "Voir" une
            // fois qu'il n'y a plus rien de neuf à décider, "Apprécier" tant qu'une décision
            // reste possible (row.canDecide) — pas de bouton du tout au-delà (statut déjà réglé).
            const verifyLabel = hasNothingNewToDecide ? "Voir" : "Apprécier";

            return (
              <div key={row.key} className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
                {/* En-tête TOUJOURS visible — même modèle que la carte prestataire
                    (mission-history-table.tsx / missions/[id]/deliverable) : badge domaine +
                    statut + preuves total, titre, montant + conversion EUR + barre bicolore.
                    "Soumettre preuve" y est remplacé par "Vérifier"/"Voir" (action CLIENT), le
                    chevron ne déplie plus que l'historique versionné (signalé 2026-09-05,
                    "remplacer intégralement la carte"). */}
                <div className="p-4 lg:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-mono font-bold text-[#0f172a]">#{String(row.ordre).padStart(2, "0")}</span>
                      {mission.professionalType && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#ede9fe] text-[#6d28d9] text-[11.5px] font-medium whitespace-nowrap">
                          {PROFESSIONAL_TYPE_LABEL[mission.professionalType] ?? mission.professionalType}
                        </span>
                      )}
                      {/* "À valider" ne veut plus dire "rien fait" dès qu'un point d'étape a
                          été confirmé — sinon le statut ment sur l'avancement réel (signalé
                          2026-09-04). Distincte pastille (bleue, pas ambre) tant que la
                          décision finale reste en attente ; au-delà (canDecide=false), le
                          vrai statut reprend le dessus normalement. */}
                      {row.canDecide && rowCheckpoints.length > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-medium whitespace-nowrap bg-[#DBEAFE] border border-[#BFDBFE] text-[#1E40AF]">
                          Partiellement validé
                        </span>
                      ) : (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-medium whitespace-nowrap ${row.canDecide ? "bg-[#FEF3C7] border border-[#FCD34D] text-[#92400E]" : "bg-[#F1F5F9] text-[#475569]"}`}>
                          {row.statusLabel}
                        </span>
                      )}
                      <span className="text-[#64748B] whitespace-nowrap">
                        {row.attachments.length} preuve{row.attachments.length !== 1 ? "s" : ""} total
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0] whitespace-nowrap">{pctOfTotal}% du total</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {row.canDecide && (
                        <button
                          onClick={() => (isOpen ? closeDecision() : openVerification(row.key))}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FEF3C7] border border-[#FCD34D] text-[#92400E] text-[11.5px] font-semibold hover:brightness-95"
                        >
                          <BadgeCheck className="w-3.5 h-3.5" />
                          {verifyLabel}
                        </button>
                      )}
                      {/* Validation FINALE (libération des fonds) — hors modale : la maquette
                          « Apprécier les preuves + Constat » ne porte qu'un bouton
                          d'enregistrement (point d'étape + constat), le geste irréversible qui
                          libère l'argent vit donc sur l'en-tête de carte. N'apparaît qu'une
                          fois les deux conditions réunies : 100% constatés et toutes les
                          preuves du lot courant validées. */}
                      {row.canDecide && canValidate && proofsReady && (
                        <span className="inline-flex flex-col items-start gap-0.5">
                          <button
                            disabled={savingDecision}
                            onClick={() => (jalonId ? validateJalon(jalonId) : handleRelease())}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#008751] text-white text-[11.5px] font-semibold hover:bg-[#007a49] disabled:opacity-50"
                          >
                            {/* Le montant annoncé est celui réellement transmis au PSP, retenue
                                de garantie DÉDUITE — pas le montant nominal du jalon. Sans
                                retenue (cas par défaut), les deux sont égaux. */}
                            {savingDecision
                              ? "Envoi..."
                              : `Valider — ${releasableBeforeRetention(row.montant, retentionRate).toLocaleString("fr-FR")} ${row.currency}`}
                          </button>
                          {retentionAmount(row.montant, retentionRate) > 0 && (
                            <span className="text-[10.5px] text-[#92400E] leading-tight">
                              dont {retentionAmount(row.montant, retentionRate).toLocaleString("fr-FR")} {row.currency} retenus
                              en garantie, versés à la validation du dernier jalon
                            </span>
                          )}
                        </span>
                      )}
                      {hasHistory && (
                        <button
                          onClick={() => {
                            const expanding = !expandedHistory[row.key];
                            setExpandedHistory((prev) => ({ ...prev, [row.key]: expanding }));
                            // Synchronise les colonnes (Statut/Preuves/% partielle) avec l'état
                            // réel avant d'ouvrir le dropdown (l'autre partie a pu agir).
                            if (expanding) reload();
                          }}
                          className="w-7 h-7 rounded-full border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F8FAF9] shrink-0"
                          title="Historique preuves & validations partielles"
                        >
                          {expandedHistory[row.key] ? <ChevronUp className="w-3.5 h-3.5 text-[#64748B]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />}
                        </button>
                      )}
                    </div>
                  </div>

                  <h3 className="mt-2.5 text-[14.5px] font-semibold text-[#0f172a]">{row.titre}</h3>

                  <AmountProgressBar
                    montant={row.montant}
                    currency={row.currency}
                    totalPercent={totalPercent}
                    firmPercent={firmPercent}
                    partialPercent={partialPercent}
                  />
                </div>

                {/* Dropdown "Historique" — corrélé au prestataire : liste les SOUMISSIONS
                    ("01-V1"…) avec leur nombre de preuves ; "Voir" (colonne Action) ouvre la
                    modale de lecture + décision sur CE lot. canSubmitProofs reste false : le
                    client ne soumet jamais de preuve. */}
                {hasHistory && expandedHistory[row.key] && (
                  <div className="bg-[#FAFBFB] overflow-x-auto">
                    <RowHistoryTable
                      rows={clientHistoryRows}
                      montant={row.montant}
                      currency={row.currency}
                      totalPercent={totalPercent}
                      onViewBatch={(batch) => openBatchReview(batch, row.key)}
                      canSubmitProofs={false}
                      submitLabel=""
                      onSubmit={() => {}}
                      view="client"
                      currentStatus={currentStatus}
                      reviewOpenedAt={row.reviewOpenedAt}
                    />
                  </div>
                )}

                {/* Modale « Apprécier les preuves + Constat » — reproduction intégrale de la
                    maquette Flexwork-Modal-Client-Validation-Preuve.html (2026-09-08).
                    Ouverte par « Apprécier »/« Voir » de l'en-tête (lot COURANT) ou par
                    « Voir » d'une ligne du dropdown « Historique » (lot relu, actions
                    fermées). Remplace la modale de décision précédente (2 colonnes,
                    récapitulatif + actions globales) : le rejet PAR PREUVE y est le chemin de
                    rejet — côté serveur il rejette déjà automatiquement la soumission — et la
                    validation finale (libération des fonds) a migré sur l'en-tête de carte,
                    hors modale, comme dans la maquette. */}
                {isOpen && (
                  <ClientProofValidationModal
                    open
                    onClose={closeDecision}
                    scopeLabel={viewedVersion ? `Lot ${viewedVersion.version}` : jalonId ? `Jalon ${row.ordre}` : "Livrable"}
                    statusLabel={row.statusLabel}
                    clientName={clientDisplayName}
                    clientInitials={clientInitials}
                    providerName={providerDisplayName}
                    providerInitials={providerInitials}
                    proofs={proofsShown}
                    appreciableIds={row.canDecide ? appreciableIds : new Set<string>()}
                    busyProofId={appreciating}
                    error={error}
                    observedProgress={draftValue}
                    minProgress={progressFloor}
                    onObservedProgressChange={(value) => setObservedDraft((prev) => ({ ...prev, [draftKey]: Math.max(value, progressFloor) }))}
                    constatText={constatText[draftKey] ?? ""}
                    onConstatTextChange={(value) => setConstatText((prev) => ({ ...prev, [draftKey]: value }))}
                    geoLabel={constatGeoLabel(jalonId)}
                    onCaptureGeo={() => captureConstatGeolocation(jalonId)}
                    constatProofs={constatByScope[draftKey] ?? []}
                    constatBusyCategory={constatBusy}
                    onAddConstatFile={(category, file) => uploadConstatProof(jalonId, category, { file })}
                    onRemoveConstat={(id) => removeConstatProof(jalonId, id)}
                    attested={attested[draftKey] ?? false}
                    onAttestedChange={(value) => setAttested((prev) => ({ ...prev, [draftKey]: value }))}
                    onValidateProof={(id) => validateProof(row, id)}
                    onRejectProof={(id, payload) => rejectProof(row, id, payload)}
                    onCancelReject={(id) => validateProof(row, id)}
                    onSave={() => saveAppreciationAndConstat(row, draftValue)}
                    saving={savingStep}
                    saveDisabledReason={
                      !row.canDecide
                        ? "Ce périmètre n'est plus en attente de décision."
                        : !proofsReady
                          ? "Validez d'abord chaque preuve du lot courant."
                          : null
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Toast de confirmation — maquette Flexwork-Modal-Appreciation-Preuves.html
          (2026-09-08), auto-masqué après 3s (showToast). */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] max-w-[320px] rounded-xl bg-[#0f172a] text-white shadow-2xl px-4 py-3 flex items-start gap-2 text-[12.5px]">
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="shrink-0 w-5 h-5 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-[11px]" aria-label="Fermer">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
