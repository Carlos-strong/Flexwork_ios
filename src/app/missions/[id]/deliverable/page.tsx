"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import DashboardLayout, { providerNav, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { useUserIdentity } from "@/components/user-identity";
import { providerUrl } from "@/lib/provider-urls";
import { missionsHrefForRole, type Role } from "@/lib/role-dashboard";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import MissionTracker from "@/components/mission-tracker";
import { cumulativeCheckpointProgress, type Checkpoint } from "@/components/progress-checkpoints";
import { MessageBubble } from "@/components/chat/MessageBubble";
import {
  PROFESSIONAL_TYPE_LABEL,
  ReadOnlyProofCategories,
  RowHistoryTable,
  AmountProgressBar,
  buildHistoryRows,
  firmAndPartialPercent,
  normalizeJalonSubmissionStatus,
  normalizeMissionSubmissionStatus,
  type Rejection,
} from "@/components/mission-history-table";
import { canHoldJalonSequential } from "@/lib/jalons";
import ProviderProofSubmissionModal from "@/components/deliverable/ProviderProofSubmissionModal";

type Jalon = {
  id: string; ordre: number; titre: string; montant: number; status: string;
  revisionCount: number; rejectionReason: string | null; declaredProgress: number; observedProgress: number;
  reviewOpenedAt: string | null;
};
type Attachment = {
  id: string;
  category: string;
  note: string | null;
  fileName: string | null;
  createdAt: string;
  url: string | null;
  // Type MIME (2026-09-08, aperçu "Voir" redessiné pour matcher la vue client — voir
  // ReadOnlyProofCategories) — les deux GET le renvoient déjà, seule la balise <source>
  // vidéo l'utilise (optionnel, un navigateur joue généralement la vidéo sans).
  mimeType?: string | null;
  // Taille réelle du fichier stocké (octets) — affichée sous chaque vignette de la modale de
  // soumission. null pour les preuves texte-seules (géolocalisation, note libre).
  size?: number | null;
  // Avis du client sur CETTE preuve (2026-09-05) — servi par GET .../deliverable et
  // GET .../jalons/[jalonId]/attachments, affiché au prestataire (badges + détail du rejet)
  // pour qu'il sache exactement quelle preuve fournir en remplacement.
  appreciation?: string | null; // null | "validee" | "rejetee"
  rejectionReason?: string | null;
  rejectionMotif?: string | null;
  requestNewProof?: boolean;
};
type MissionSummary = { titre: string; status: string; currency: string; budget: number; contractPrice: number | null; declaredProgress: number; observedProgress: number; reviewOpenedAt: string | null };

const JALON_STATUS_LABEL: Record<string, string> = {
  en_attente: "Non démarré",
  fonds_sous_sequestre: "Financé — prêt pour le livrable",
  livrable_soumis: "Livrable soumis, en attente du client",
  valide: "Validé — libération en cours",
  rejete: "Rejeté — à resoumettre",
  libere: "Payé",
};

// Pendant, au niveau MISSION ENTIÈRE (contrat sans jalon), de JALON_STATUS_LABEL — mêmes
// intitulés, seuls les statuts atteignables par une mission (DELIVERABLE_SUBMITTABLE_STATUSES,
// src/lib/attachments.ts) sont pertinents ici.
const MISSION_DELIVERABLE_STATUS_LABEL: Record<string, string> = {
  fonds_sous_sequestre: "Financé — prêt pour le livrable",
  en_cours: "Financé — prêt pour le livrable",
  livrable_soumis: "Livrable soumis, en attente du client",
};

// Utilisateur affiché dans le sidebar/navbar le temps que l'identité réelle (UserIdentityProvider)
// soit chargée — même convention que la page devis sœur (missions/[id]/devis/page.tsx).
const FALLBACK_USER: DashboardUser = { initials: "PR", name: "Prestataire", role: "Prestataire", avatarGradient: "from-[#FF7A00] to-[#E8112D]" };

// Catégories de preuves — photo/vidéo/document exigent un vrai fichier ; géolocalisation
// (navigator.geolocation, coordonnées réelles) et "autres preuves" (texte libre, comme la
// maquette) n'en exigent pas — voir POST .../deliverable.
const CATEGORIES: { id: string; label: string; accept?: string }[] = [
  { id: "photo", label: "📷 Photos", accept: "image/*" },
  { id: "video", label: "🎥 Vidéos", accept: "video/*" },
  { id: "document", label: "📄 Documents", accept: ".pdf,.doc,.docx,.zip" },
  { id: "geolocation", label: "📍 Géolocalisation" },
  { id: "other", label: "➕ Autres preuves" },
];

// Une "ligne" de la table récapitulative — un jalon réel, ou (contrat sans jalon) la mission
// entière traitée comme une ligne unique #01, pour présenter exactement le même écran dans
// les deux cas (maquette VJR : table # / JALON / PREUVES / STATUT / ACTION, clic sur
// "Soumettre preuve" → modale).
type Row = {
  key: string;
  ordre: number;
  titre: string;
  montant: number;
  currency: string;
  statusLabel: string;
  rejectionNote: string | null;
  canSubmitProofs: boolean;
  /** TOUTES les preuves accumulées sur ce périmètre (historique complet, tous tours
   *  confondus) — alimente le total "N preuves" de la carte et la construction du dropdown
   *  "Historique" (buildHistoryRows). */
  attachments: Attachment[];
  /** Preuves du TOUR COURANT uniquement (non encore décidées par le client) : celles ajoutées
   *  APRÈS le dernier événement de décision (point d'étape confirmé ou rejet). C'est ce lot
   *  que la modale de soumission affiche et compte — une nouvelle soumission ne repart jamais
   *  de l'historique déjà soumis/validé (signalé 2026-09-05). Égal au total tant qu'aucune
   *  décision n'a été rendue (première soumission). */
  openAttachments: Attachment[];
  scope: { kind: "jalon"; jalonId: string; jalon: Jalon } | { kind: "mission" };
};

/** Preuves du tour courant d'un périmètre (jalon ou mission) — celles ajoutées après le
 *  DERNIER événement de décision du client (point d'étape confirmé ou rejet, append-only).
 *  Sans aucun événement, TOUTES les preuves sont du tour courant (première soumission). */
function openProofsSince(attachments: Attachment[], decisions: { createdAt: string }[]): Attachment[] {
  if (decisions.length === 0) return attachments;
  const lastDecision = Math.max(...decisions.map((d) => new Date(d.createdAt).getTime()));
  return attachments.filter((a) => new Date(a.createdAt).getTime() > lastDecision);
}


// Soumission de livrable — réservé au prestataire. Si le contrat a des jalons (paiement
// fractionné, 2026-08-06), la soumission se fait jalon par jalon, avec des preuves typées
// (photo/vidéo/document/géolocalisation/autre) qui s'accumulent avant un envoi explicite pour
// validation (POST .../submit). Sinon (contrat sans jalon), même vue et même triptyque
// accumulation → liste → soumission, mais scopés à la mission entière — POST/GET
// .../deliverable et POST .../deliverable/submit (jalonId toujours null côté serveur).
//
// Présentation (2026-09-02) : reprend la maquette VJR à l'identique — table récapitulative
// # / JALON / PREUVES / STATUT / ACTION, clic sur "Soumettre preuve" (ou "Voir" si des
// preuves existent déjà) ouvre une VRAIE modale par-dessus la page (pas un panneau toujours
// déplié inline comme la version précédente) : titre + montant + statut, les 5 catégories,
// bouton bas dynamique gris/vert selon présence d'au moins une preuve. Une mission sans jalon
// est traitée comme une ligne unique #01 (même écran, même logique). Style harmonisé sur la
// palette Flexwork (#0f172a/#E2E8F0/#008751) — seuls les accents "+ Ajouter"/preuve gardent
// le violet de la maquette (#6d28d9/#ede9fe), qui les distingue visuellement des actions
// principales du reste de l'app (toujours vertes) : ce sont des actions secondaires
// d'accumulation, pas l'action de soumission finale elle-même.
export default function DeliverablePage() {
  const params = useParams();
  const missionId = params.id as string;
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: Role } | undefined)?.role;
  const missionsHref = missionsHrefForRole(role);
  const badgeCounts = useSidebarBadges("prestataire");

  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), pas
  // à chaque montage ; photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity
    ? { ...FALLBACK_USER, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...FALLBACK_USER, avatarUrl: null, id: userId };

  const [jalons, setJalons] = useState<Jalon[] | null>(null);
  // Jalons séquentiels (règle 18.8/18.9) — sans effet si faux (comportement historique).
  const [jalonsSequential, setJalonsSequential] = useState(false);
  const [mission, setMission] = useState<MissionSummary | null>(null);
  // Type professionnel de la mission — badge "Expert Digital" de l'en-tête carte (2026-09-04).
  // Propriété de la MISSION (pas du jalon), chargée une fois indépendamment du cas jalon/sans
  // jalon (contrairement à `mission`, qui ne l'est que pour le cas sans jalon).
  const [professionalType, setProfessionalType] = useState<string | null>(null);
  const [attachmentsByJalon, setAttachmentsByJalon] = useState<Record<string, Attachment[]>>({});
  const [missionAttachments, setMissionAttachments] = useState<Attachment[]>([]);
  // Motif du dernier rejet (contrat sans jalon) — symétrique à Jalon.rejectionReason, posé
  // par POST .../escrow/reject (src/app/api/missions/[id]/escrow/reject/route.ts).
  const [missionRejectionReason, setMissionRejectionReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null); // `${scope}:${category|"submit"|"progress"}`
  // Preuve (attachmentId) en cours de retrait via le ✕ de la modale — évite un double clic
  // pendant l'appel DELETE.
  const [removing, setRemoving] = useState<string | null>(null);
  const [declaredDraft, setDeclaredDraft] = useState<Record<string, number>>({});
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  // Champs propres à la modale de soumission (maquette Flexwork-Modal-Prestataire-
  // Soumission.html) : le commentaire « Difficultés rencontrées » part avec la soumission
  // (POST .../submit, transporté jusqu'au client via la notification), l'attestation « les
  // preuves sont réelles et prises sur site » conditionne le bouton d'envoi. Les deux sont
  // indexés par ligne (jalon ou mission) — deux jalons ouverts n'échangent pas leur texte.
  const [submissionComment, setSubmissionComment] = useState<Record<string, string>>({});
  const [submissionAttested, setSubmissionAttested] = useState<Record<string, boolean>>({});
  // Dropdown "Historique" par ligne de la table récapitulative — indépendant de la modale de
  // soumission (openRowKey) : consulter l'historique n'exige pas d'ouvrir le formulaire.
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  // Aperçu LECTURE SEULE d'un lot de preuves historique (bouton "Voir" du dropdown) — distinct
  // de openRowKey : ce lot est déjà écoulé, jamais éditable, donc pas la même modale que la
  // soumission en cours.
  const [viewingBatch, setViewingBatch] = useState<Attachment[] | null>(null);
  // Points d'étape ("validations partielles") posés par le CLIENT — lecture seule ici, le
  // prestataire doit pouvoir voir qu'une étape a été confirmée, pas seulement le client qui
  // l'a posée (voir GET .../checkpoints).
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  // Historique des rejets — pendant de `checkpoints`, lecture seule ici aussi (voir GET
  // .../rejections). Alimente le dropdown "Historique" (buildHistoryRows) pour distinguer une
  // soumission REJETÉE de son remplacement corrigé.
  const [rejections, setRejections] = useState<Rejection[]>([]);
  // Interlocuteur de la bulle de messagerie : le client du contrat de CETTE mission — non
  // ambigu (contrat déjà généré). Absente jusqu'ici de cette page (signalé 2026-09-04, même
  // manque que côté client sur ClientValidationWorkspace) : le prestataire n'avait aucun moyen
  // de discuter avec le client pendant la gestion des livrables sans quitter la page.
  const [interlocutor, setInterlocutor] = useState<{ id: string; name: string; avatarPath: string | null } | null>(null);
  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}/contract`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c?.client) return;
        const name = [c.client.firstname, c.client.lastname].filter(Boolean).join(" ") || "Client";
        setInterlocutor({ id: c.client.id, name, avatarPath: c.client.avatarPath ?? null });
      })
      .catch(() => {});
  }, [missionId]);

  // Réseau injoignable (serveur arrêté/en recompilation, connexion coupée) — `fetch` REJETTE
  // au lieu de renvoyer une réponse. Sans ce garde, la promesse non gérée remontait en
  // « Unhandled Runtime Error / TypeError: Failed to fetch » (overlay Next) au lieu d'un
  // message lisible. Pendant de onNetworkError dans ValidationClientView.
  function onNetworkError() {
    setError("Connexion au serveur perdue — vérifiez votre réseau puis réessayez.");
  }

  function reload() {
    fetchDedupe(`/api/missions/${missionId}/jalons`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items: Jalon[] = d.items ?? [];
        setJalons(items);
        setJalonsSequential(d.jalonsSequential === true);
        if (items.length > 0) {
          items.filter((j) => j.status === "fonds_sous_sequestre" || j.status === "rejete").forEach((j) => loadAttachments(j.id));
        } else {
          // Contrat sans jalon : la mission elle-même porte le statut/budget affichés, et ses
          // preuves accumulées (jalonId: null) — chargés seulement dans ce cas.
          fetchDedupe(`/api/missions/${missionId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => m && setMission({ titre: m.titre, status: m.status, currency: m.currency, budget: m.budget, contractPrice: m.contractPrice ?? null, declaredProgress: m.declaredProgress ?? 0, observedProgress: m.observedProgress ?? 0, reviewOpenedAt: m.reviewOpenedAt ?? null }))
            .catch(onNetworkError);
          loadMissionAttachments();
        }
      })
      .catch(() => { setJalons([]); onNetworkError(); });
    loadCheckpoints();
    loadRejections();
    // Chargé indépendamment du cas jalon/sans jalon (voir le state) — évite de dupliquer le
    // fetch mission uniquement pour ce badge quand le contrat a des jalons.
    fetchDedupe(`/api/missions/${missionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setProfessionalType(m.professionalType ?? null))
      .catch(() => {});
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
        setMissionRejectionReason(d.lastRejectionReason ?? null);
      }
    } catch {
      onNetworkError();
    }
  }

  useEffect(reload, [missionId]);
  // Resynchronisation quand l'onglet reprend le focus : l'autre partie (client sur
  // /missions/[id]) agit dans SON onglet — les choix de progression, le statut et les preuves
  // de CETTE vue reflètent alors l'état réel (2026-09-05).
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [missionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resynchronise les points d'étape avant d'ouvrir — le client a pu en confirmer un depuis
  // le dernier chargement de cette page (même logique que ValidationClientView.openVerification).
  function openVerification(key: string) {
    setOpenRowKey(key);
    loadCheckpoints();
    loadRejections();
  }

  // Fermeture au clavier (Échap) — même confort que les autres modales du projet
  // (sign-contract-modal.tsx).
  useEffect(() => {
    if (!openRowKey) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenRowKey(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRowKey]);

  async function uploadProof(jalonId: string, category: string, opts: { file?: File; note?: string }) {
    setError(null);
    setSubmitting(`${jalonId}:${category}`);
    const formData = new FormData();
    formData.append("category", category);
    if (opts.file) formData.append("file", opts.file);
    if (opts.note) formData.append("note", opts.note);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/deliverable`, { method: "POST", body: formData });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "jalon_not_ready" ? "Ce jalon n'est pas encore financé ou déjà soumis." : "Échec de l'envoi de la preuve.");
      return;
    }
    loadAttachments(jalonId);
  }

  // Pendant de uploadProof ci-dessus, scopé à la mission entière (jalonId toujours null côté
  // serveur) — même route .../deliverable, réécrite le 2026-09-02 pour accumuler au lieu de
  // soumettre directement (voir POST .../deliverable/submit ci-dessous).
  async function uploadMissionProof(category: string, opts: { file?: File; note?: string }) {
    setError(null);
    setSubmitting(`mission:${category}`);
    const formData = new FormData();
    formData.append("category", category);
    if (opts.file) formData.append("file", opts.file);
    if (opts.note) formData.append("note", opts.note);
    const res = await fetch(`/api/missions/${missionId}/deliverable`, { method: "POST", body: formData });
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "mission_not_ready" ? "La mission n'est pas prête pour la soumission du livrable." : "Échec de l'envoi de la preuve.");
      return;
    }
    loadMissionAttachments();
  }

  // Retire une preuve du TOUR COURANT (jalon ou mission) depuis la modale — seul le
  // prestataire, uniquement tant que la preuve n'a pas été close par une décision du client
  // (voir DELETE .../deliverable/[attachmentId] et .../jalons/[jalonId]/deliverable/[attachmentId]).
  async function removeProof(scope: Row["scope"], attachmentId: string) {
    const jalonId = scope.kind === "jalon" ? scope.jalonId : null;
    const url = jalonId
      ? `/api/missions/${missionId}/jalons/${jalonId}/deliverable/${attachmentId}`
      : `/api/missions/${missionId}/deliverable/${attachmentId}`;
    if (!window.confirm("Retirer cette preuve du tour en cours ?")) return;
    setError(null);
    setRemoving(attachmentId);
    const res = await fetch(url, { method: "DELETE" });
    setRemoving(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "proof_locked"
          ? "Cette preuve fait déjà partie de l'historique (validée ou rejetée) — elle n'est plus supprimable."
          : data.error === "forbidden"
            ? "Vous ne pouvez retirer que vos propres preuves."
            : "Échec de la suppression de la preuve."
      );
      return;
    }
    if (jalonId) loadAttachments(jalonId);
    else loadMissionAttachments();
  }

  function captureGeolocation(jalonId: string) {
    if (!navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => uploadProof(jalonId, "geolocation", { note: `${pos.coords.latitude},${pos.coords.longitude}` }),
      () => setError("Position non capturée — vérifiez l'autorisation de géolocalisation."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function captureMissionGeolocation() {
    if (!navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => uploadMissionProof("geolocation", { note: `${pos.coords.latitude},${pos.coords.longitude}` }),
      () => setError("Position non capturée — vérifiez l'autorisation de géolocalisation."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function saveDeclaredProgress(jalonId: string) {
    const progress = declaredDraft[jalonId];
    if (progress === undefined) return;
    setSubmitting(`${jalonId}:progress`);
    const res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/declare-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress }),
    });
    setSubmitting(null);
    if (!res.ok) {
      setError("Échec de l'enregistrement de la progression.");
      return;
    }
    reload();
  }

  // Pendant de saveDeclaredProgress ci-dessus, scopé à la mission entière — même route que
  // côté client (POST .../declare-progress, jalonId toujours implicite au niveau mission).
  async function saveMissionDeclaredProgress() {
    const progress = declaredDraft.mission;
    if (progress === undefined) return;
    setSubmitting("mission:progress");
    const res = await fetch(`/api/missions/${missionId}/declare-progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress }),
    });
    setSubmitting(null);
    if (!res.ok) {
      setError("Échec de l'enregistrement de la progression.");
      return;
    }
    reload();
  }

  // La modale de soumission (maquette prestataire) réunit le curseur de taux, le commentaire
  // et l'envoi dans un seul geste : le taux affiché doit donc partir AVEC la soumission —
  // sans cet enregistrement préalable, bouger le curseur puis cliquer « Soumettre » envoyait
  // les preuves sous l'ancien taux déclaré.
  async function submitJalonForValidation(jalonId: string) {
    setError(null);
    setSubmitting(`${jalonId}:submit`);
    const declared = declaredDraft[jalonId];
    if (declared !== undefined) {
      await fetch(`/api/missions/${missionId}/jalons/${jalonId}/declare-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: declared }),
      });
    }
    let res: Response;
    try {
      res = await fetch(`/api/missions/${missionId}/jalons/${jalonId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: submissionComment[jalonId] ?? "" }),
      });
    } catch {
      setSubmitting(null);
      onNetworkError();
      return;
    }
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "no_proof_attached" ? "Ajoutez au moins une preuve avant de soumettre." : "Échec de la soumission.");
      return;
    }
    setSubmissionComment((prev) => ({ ...prev, [jalonId]: "" }));
    setSubmissionAttested((prev) => ({ ...prev, [jalonId]: false }));
    setOpenRowKey(null);
    reload();
  }

  // Pendant, au niveau mission entière — voir submitJalonForValidation ci-dessus.
  async function submitMissionForValidation() {
    setError(null);
    setSubmitting("mission:submit");
    const declared = declaredDraft.mission;
    if (declared !== undefined) {
      await fetch(`/api/missions/${missionId}/declare-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress: declared }),
      });
    }
    let res: Response;
    try {
      res = await fetch(`/api/missions/${missionId}/deliverable/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: submissionComment.mission ?? "" }),
      });
    } catch {
      setSubmitting(null);
      onNetworkError();
      return;
    }
    setSubmitting(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "no_proof_attached" ? "Ajoutez au moins une preuve avant de soumettre." : "Échec de la soumission.");
      return;
    }
    setSubmissionComment((prev) => ({ ...prev, mission: "" }));
    setSubmissionAttested((prev) => ({ ...prev, mission: false }));
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center px-4">
        <div className="max-w-[560px] w-full bg-white border border-[#E2E8F0] rounded-xl p-8 text-center">
          <div className="text-[48px] mb-4">✅</div>
          <h1 className="text-[18px] font-bold text-[#008751] mb-2">Livrable soumis avec succès !</h1>
          <p className="text-[13px] text-[#64748B] mb-5">
            Le client va être notifié. La mission passe en statut &quot;Livrable soumis&quot;.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href={`/missions/${missionId}`} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold flex items-center hover:bg-[#007a49]" style={{ textDecoration: "none" }}>
              Voir la mission
            </Link>
            <Link href={missionsHref} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium flex items-center hover:bg-[#F8FAF9]" style={{ textDecoration: "none" }}>
              Toutes les missions
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (jalons === null) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;
  if (jalons.length === 0 && mission === null) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;

  // ── Lignes de la table récapitulative : un jalon réel, ou (sans jalon) la mission entière
  //    traitée comme une ligne unique #01 — même écran dans les deux cas.
  const rows: Row[] =
    jalons.length > 0
      ? jalons.map((j) => {
          // "Soumettre preuve" (en-tête de carte) tant que la progression validée n'atteint pas
          // 100 % : avant le premier envoi (fonds_sous_sequestre), après un REJET (rejete →
          // nouveau cycle) OU pendant une validation PARTIELLE du client (livrable_soumis,
          // 0 < observed < 100 — il reste des preuves à fournir pour finir les 100 %). À 100 %,
          // l'en-tête bascule sur « Mission Clôturée » (signalé 2026-09-05).
          const jalonAttachments = attachmentsByJalon[j.id] ?? [];
          const jalonDecisions = [
            ...checkpoints.filter((c) => c.jalonId === j.id),
            ...rejections.filter((r) => r.jalonId === j.id),
          ];
          // Jalon séquentiel verrouillé (règle 18.9) : le prestataire doit comprendre
          // POURQUOI il ne peut pas encore financer/travailler ce jalon — sans ça,
          // "Non démarré" ne dit rien du blocage sur le jalon précédent.
          const isLocked =
            j.status === "en_attente" &&
            !canHoldJalonSequential(
              j.status,
              j.ordre,
              jalons.map((sib) => ({ ordre: sib.ordre, status: sib.status })),
              jalonsSequential
            );
          return {
            key: j.id,
            ordre: j.ordre,
            titre: j.titre,
            montant: j.montant,
            currency: "XOF",
            statusLabel: isLocked ? "Verrouillé — en attente de la validation du jalon précédent" : JALON_STATUS_LABEL[j.status] ?? j.status,
            rejectionNote: j.status === "rejete" && j.rejectionReason ? `${j.rejectionReason} (révision n°${j.revisionCount})` : null,
            canSubmitProofs:
              j.status === "fonds_sous_sequestre" ||
              j.status === "rejete" ||
              (j.status === "livrable_soumis" && j.observedProgress > 0 && j.observedProgress < 100),
            attachments: jalonAttachments,
            openAttachments: openProofsSince(jalonAttachments, jalonDecisions),
            scope: { kind: "jalon" as const, jalonId: j.id, jalon: j },
          };
        })
      : mission
        ? (() => {
            // "Soumettre preuve" tant que la progression validée n'atteint pas 100 % : fonds
            // séquestrés / en cours, ou validation PARTIELLE du client (livrable_soumis,
            // 0 < observed < 100). À 100 %, l'en-tête bascule sur « Mission Clôturée ».
            const missionDecisions = [
              ...checkpoints.filter((c) => c.jalonId === null),
              ...rejections.filter((r) => r.jalonId === null),
            ];
            return [{
              key: "mission",
              ordre: 1,
              titre: mission.titre,
              montant: mission.contractPrice ?? mission.budget,
              currency: mission.currency,
              statusLabel: MISSION_DELIVERABLE_STATUS_LABEL[mission.status] ?? mission.status,
              rejectionNote: missionRejectionReason,
              canSubmitProofs:
                mission.status === "fonds_sous_sequestre" ||
                mission.status === "en_cours" ||
                (mission.status === "livrable_soumis" && mission.observedProgress > 0 && mission.observedProgress < 100),
              attachments: missionAttachments,
              openAttachments: openProofsSince(missionAttachments, missionDecisions),
              scope: { kind: "mission" as const },
            }];
          })()
        : [];

  const openRow = rows.find((r) => r.key === openRowKey) ?? null;
  // ── Valeurs dérivées consommées par la modale de soumission (maquette prestataire).
  //    Le sous-titre reprend la forme de la maquette (« Livrable initial 1 000€ - Jalon 1/3 »)
  //    avec les vraies données : intitulé + montant + rang du jalon dans le contrat.
  const submissionDraftKey = openRow ? (openRow.scope.kind === "jalon" ? openRow.scope.jalonId : "mission") : "mission";
  const submissionScopeLabel = openRow
    ? `${openRow.titre} ${openRow.montant.toLocaleString("fr-FR")} ${openRow.currency}${jalons.length > 0 ? ` - Jalon ${openRow.ordre}/${jalons.length}` : ""}`
    : "";
  // PLANCHER de la progression déclarée — même calcul de cumul que côté client
  // (ValidationClientView) : le plus haut point d'étape jamais confirmé, PAS le dernier.
  // `observedProgress` porte la dernière valeur posée par le client ; un point d'étape
  // historique en baisse (65% puis 15%, avant que le serveur ne refuse les régressions) la
  // laisse sous le cumul réellement acquis. On prend donc le max des deux : jamais sous ce que
  // le serveur exige (isAboveProgressFloor s'appuie sur observedProgress), jamais sous ce qui
  // est fermement acquis. Les deux vues affichent ainsi le même « déjà validé ».
  const openRowCheckpoints = openRow
    ? checkpoints.filter((c) => c.jalonId === (openRow.scope.kind === "jalon" ? openRow.scope.jalonId : null))
    : [];
  const submissionProgressFloor = openRow
    ? Math.max(
        cumulativeCheckpointProgress(openRowCheckpoints) ?? 0,
        openRow.scope.kind === "jalon" ? openRow.scope.jalon.observedProgress : mission?.observedProgress ?? 0
      )
    : 0;
  const submissionDeclaredProgress = openRow
    ? Math.max(
        declaredDraft[submissionDraftKey] ??
          (openRow.scope.kind === "jalon" ? openRow.scope.jalon.declaredProgress : mission?.declaredProgress ?? 0),
        submissionProgressFloor
      )
    : 0;
  // `submitting` vaut `${scope}:${category}` pendant un upload — la modale n'a besoin que de
  // la catégorie pour griser le bon bouton « +Ajouter ».
  const submissionBusyCategory =
    submitting && submitting.startsWith(`${submissionDraftKey}:`) ? submitting.split(":")[1] : null;
  // Pastille violette « position capturée » — la dernière preuve de géolocalisation du tour
  // courant, pas une valeur simulée.
  const submissionGeoLabel = (() => {
    const geo = openRow?.openAttachments.filter((a) => a.category === "geolocation").slice(-1)[0];
    if (!geo?.note) return null;
    const [latStr, lngStr] = geo.note.split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(4)}N ${lng.toFixed(4)}E` : geo.note;
  })();

  // Vue prestataire "Gestion des livrables — Mode Freelance" dans le chrome par défaut de
  // l'app (sidebar + navbar DashboardLayout, même pattern que missions/[id]/devis/page.tsx) :
  // atteinte depuis la rubrique "Missions" du dashboard prestataire (MissionsSection "Voir").
  return (
    <DashboardLayout
      mode="prestataire"
      user={user}
      navItems={providerNav(role ?? "expert_digital")}
      activeNav="missions"
      onNavChange={(id) => router.push(providerUrl(role ?? "expert_digital", id))}
      badgeCounts={badgeCounts}
      title="Gestion des livrables"
    >
      <div className="max-w-[860px] mx-auto space-y-4 text-[#0f172a]">
        {/* Bandeau d'évolution de la mission — même tracker que /missions/[id] (côté prestataire). */}
        <MissionTracker missionId={missionId} />

        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Livrable</span>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[13px] font-semibold">Gestion des livrables — Mode Freelance</h1>
            <p className="text-[12px] text-[#64748B] mt-0.5">
              Table {rows.length === 1 ? "jalon" : "jalons"} avec {rows.reduce((s, r) => s + r.attachments.length, 0)} preuve(s) — {rows[0]?.statusLabel ?? "—"}
            </p>
          </div>
        </div>

        {error && !openRow && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

        {/* En-tête carte par ligne — refonte complète (2026-09-04, remplace l'ancienne table
            # / JALON / PREUVES / STATUT / PROGRESSION / ACTION). Chaque carte : ligne méta
            (# + domaine + statut + total preuves + actions), titre, montant (+ conversion EUR
            indicative) avec barre de progression à DEUX teintes — pleine de 0 à `firmPercent`
            ("validé ferme" : état confirmé avant le lot de preuves en cours), hachurée de
            `firmPercent` à `totalPercent` ("validé partiel hachuré" : la validation la plus
            récente, pas encore suivie d'une nouvelle soumission qui la "consoliderait"). Le
            dropdown "Historique" (RowHistoryTable) reste inchangé, toujours déplié sous la
            carte via le chevron. */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#F1F5F9]">
          {rows.map((row) => {
            const rowScopeKey = row.scope.kind === "jalon" ? row.scope.jalonId : null;
            const rowCheckpoints = checkpoints.filter((c) => c.jalonId === rowScopeKey);
            const rowRejections = rejections.filter((r) => r.jalonId === rowScopeKey);
            const historyRows = buildHistoryRows(row.attachments, rowCheckpoints, rowRejections, row.montant, row.ordre);
            // Dropdown "Historique" CÔTÉ PRESTATAIRE : ne liste QUE les versions de SOUMISSION
            // ("01-V1", "01-V2"…), pas les validations ("01-V1-val") ni les rejets
            // ("01-V1-rej") — mêmes lignes que le tableau "Validation" côté client (règle de
            // synchronisation, mission-history-table.tsx : getRowTypeStatus), Type/Statut
            // seuls diffèrent selon la vue. `firmAndPartialPercent` reste calculé sur
            // `historyRows` au COMPLET juste en dessous — la barre reflète le cumul réel, pas
            // seulement ce que cette liste filtrée choisit d'afficher.
            const providerHistoryRows = historyRows.filter((r) => r.kind === "preuve");
            const hasHistory = providerHistoryRows.length > 0;
            const currentStatus =
              row.scope.kind === "jalon"
                ? normalizeJalonSubmissionStatus(row.scope.jalon.status)
                : normalizeMissionSubmissionStatus(mission?.status ?? "");
            const reviewOpenedAt = row.scope.kind === "jalon" ? row.scope.jalon.reviewOpenedAt : (mission?.reviewOpenedAt ?? null);
            // Taux cumulé CONFIRMÉ (monotone) : le plus haut niveau jamais confirmé par un
            // point d'étape — une confirmation en baisse (régression) ne fait pas reculer la
            // barre/l'en-tête (voir cumulativeCheckpointProgress).
            const totalPercent = cumulativeCheckpointProgress(rowCheckpoints) ?? 0;
            const { firmPercent, partialPercent } = firmAndPartialPercent(historyRows, totalPercent);
            // Progression constatée (cumul validé) de CE périmètre — 100 % ⇒ l'en-tête remplace
            // "Soumettre preuve" par le marqueur terminal "Mission Clôturée".
            const observed = row.scope.kind === "jalon" ? row.scope.jalon.observedProgress : (mission?.observedProgress ?? 0);
            // Avis du client sur les preuves du TOUR COURANT (2026-09-05) : le client apprécie
            // chaque preuve (Valider/Rejeter). L'avis est porté par les preuves encore ouvertes
            // (row.openAttachments) — une preuve rejetée doit être remplacée, une validée est
            // acceptée. Un rejet ne clôt PAS le tour (voir proof-appreciation.ts).
            const openValidated = row.openAttachments.filter((a) => a.appreciation === "validee");
            const openRejected = row.openAttachments.filter((a) => a.appreciation === "rejetee");
            const openPending = row.openAttachments.filter((a) => !a.appreciation).length;
            const hasClientFeedback =
              openValidated.length > 0 || openRejected.length > 0 || openPending > 0;
            return (
              <Fragment key={row.key}>
                <div className="p-4 lg:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-mono font-bold text-[#0f172a]">#{String(row.ordre).padStart(2, "0")}</span>
                      {professionalType && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#ede9fe] text-[#6d28d9] text-[11.5px] font-medium whitespace-nowrap">
                          {PROFESSIONAL_TYPE_LABEL[professionalType] ?? professionalType}
                        </span>
                      )}
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] text-[11.5px] font-medium whitespace-nowrap">
                        {row.statusLabel}
                      </span>
                      <span className="text-[#64748B] whitespace-nowrap">
                        {row.attachments.length} preuve{row.attachments.length !== 1 ? "s" : ""} total
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* "Soumettre preuve" vit ici, à droite de la ligne méta de la carte (à
                          côté du chevron Historique), tant que la progression validée n'atteint
                          pas 100 % : ouvre la modale pour ajouter/soumettre les preuves du tour
                          courant. À 100 %, le bouton devient le marqueur terminal
                          "Mission Clôturée" (signalé 2026-09-05). */}
                      {row.canSubmitProofs ? (
                        <button
                          onClick={() => openVerification(row.key)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#008751] text-white text-[11.5px] font-semibold hover:bg-[#007a49] shrink-0"
                          title="Ajouter / soumettre des preuves pour finir la progression"
                        >
                          Soumettre preuve
                        </button>
                      ) : observed >= 100 ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0A1931] text-white text-[11.5px] font-semibold whitespace-nowrap shrink-0"
                          title="Progression validée à 100 % — mission clôturée"
                        >
                          Mission Clôturée
                        </span>
                      ) : null}
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
                  {row.rejectionNote && <div className="text-[11.5px] text-[#E8112D] mt-0.5">Motif : {row.rejectionNote}</div>}

                  {/* Avis du client sur les preuves de ce tour — le prestataire voit quelles
                      preuves sont validées / en attente / rejetées (raison + motif + demande de
                      nouvelle preuve) avant de resoumettre (2026-09-05). */}
                  {hasClientFeedback && (
                    <div className="mt-2.5 rounded-xl border border-[#F1F5F9] bg-[#FAFBFB] px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-semibold text-[#0f172a]">Avis du client sur ce tour :</span>
                        {openValidated.length > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] font-semibold">✓ {openValidated.length} validée{openValidated.length > 1 ? "s" : ""}</span>
                        )}
                        {openRejected.length > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] font-semibold">✗ {openRejected.length} rejetée{openRejected.length > 1 ? "s" : ""}</span>
                        )}
                        {openPending > 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">{openPending} en attente</span>
                        )}
                      </div>
                      {openRejected.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {openRejected.map((p) => (
                            <div key={p.id} className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-2.5 py-1.5 text-[11.5px] text-[#991B1B]">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="truncate font-medium">{p.fileName ?? p.note ?? `Preuve ${p.category}`}</span>
                                <span className="shrink-0 font-semibold">{p.rejectionReason ?? "Preuve non conforme"}</span>
                              </div>
                              {p.rejectionMotif && <p className="mt-0.5 leading-relaxed">{p.rejectionMotif}</p>}
                              {p.requestNewProof && <p className="mt-0.5 italic">Une nouvelle preuve vous est demandée.</p>}
                            </div>
                          ))}
                          <p className="text-[11px] text-[#92400E]">Cliquez sur « Soumettre preuve » pour fournir une preuve corrigée.</p>
                        </div>
                      )}
                    </div>
                  )}

                  <AmountProgressBar
                    montant={row.montant}
                    currency={row.currency}
                    totalPercent={totalPercent}
                    firmPercent={firmPercent}
                    partialPercent={partialPercent}
                  />
                </div>
                {hasHistory && expandedHistory[row.key] && (
                  <div className="bg-[#FAFBFB] overflow-x-auto">
                    {/* Lecture seule (Voir) dans le dropdown : l'action de soumission vit
                        désormais dans l'en-tête de la carte ("Soumettre preuve"), plus dans la
                        colonne ACTION du sous-tableau (signalé 2026-09-05). */}
                    <RowHistoryTable
                      rows={providerHistoryRows}
                      montant={row.montant}
                      currency={row.currency}
                      totalPercent={totalPercent}
                      onViewBatch={setViewingBatch}
                      canSubmitProofs={false}
                      submitLabel=""
                      onSubmit={() => {}}
                      view="prestataire"
                      currentStatus={currentStatus}
                      reviewOpenedAt={reviewOpenedAt}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>

      {/* Modale de soumission « Soumettre vos preuves » — reproduction intégrale de la
          maquette Flexwork-Modal-Prestataire-Soumission.html (2026-09-08), branchée sur le
          lot COURANT de la ligne ouverte. Remplace la modale précédente (liste de pastilles
          par catégorie, ProofCategories) : mêmes données, même triptyque
          accumulation → progression déclarée → soumission, présentation de la maquette. */}
      {openRow && (
        <ProviderProofSubmissionModal
          open
          onClose={() => setOpenRowKey(null)}
          scopeLabel={submissionScopeLabel}
          statusLabel={openRow.statusLabel}
          providerName={user.name}
          providerInitials={user.initials}
          proofs={openRow.openAttachments}
          busyCategory={submissionBusyCategory}
          removingId={removing}
          error={error}
          declaredProgress={submissionDeclaredProgress}
          minProgress={submissionProgressFloor}
          onDeclaredProgressChange={(value) =>
            setDeclaredDraft((prev) => ({ ...prev, [submissionDraftKey]: Math.max(value, submissionProgressFloor) }))
          }
          comment={submissionComment[openRow.key] ?? ""}
          onCommentChange={(value) => setSubmissionComment((prev) => ({ ...prev, [openRow.key]: value }))}
          geoLabel={submissionGeoLabel}
          attested={submissionAttested[openRow.key] ?? false}
          onAttestedChange={(value) => setSubmissionAttested((prev) => ({ ...prev, [openRow.key]: value }))}
          onAddFile={(category, file) =>
            openRow.scope.kind === "jalon"
              ? uploadProof(openRow.scope.jalonId, category, { file, note: category === "other" ? file.name : undefined })
              : uploadMissionProof(category, { file, note: category === "other" ? file.name : undefined })
          }
          onCaptureGeo={() =>
            openRow.scope.kind === "jalon" ? captureGeolocation(openRow.scope.jalonId) : captureMissionGeolocation()
          }
          onRemove={(id) => removeProof(openRow.scope, id)}
          onSaveDraft={() => {
            // Les preuves sont déjà persistées au fil de l'eau : « enregistrer en brouillon »
            // ne fige que la progression déclarée, sans soumettre pour validation.
            if (openRow.scope.kind === "jalon") saveDeclaredProgress(openRow.scope.jalonId);
            else saveMissionDeclaredProgress();
            setTimeout(() => setOpenRowKey(null), 600);
          }}
          onSubmit={() => {
            // La progression déclarée du curseur part avec la soumission — sans ça, un
            // prestataire qui bouge le curseur puis soumet directement enverrait ses preuves
            // sous l'ancien taux.
            if (openRow.scope.kind === "jalon") submitJalonForValidation(openRow.scope.jalonId);
            else submitMissionForValidation();
          }}
          submitting={submitting === (openRow.scope.kind === "jalon" ? `${openRow.scope.jalonId}:submit` : "mission:submit")}
          submitDisabledReason={
            openRow.canSubmitProofs ? null : "Ce périmètre n'accepte pas de nouvelle soumission pour le moment."
          }
        />
      )}

      {/* Aperçu LECTURE SEULE d'un lot de preuves historique — ouvert depuis "Voir" dans le
          dropdown "Historique" (2026-09-04). Modale volontairement plus légère que celle de
          soumission ci-dessus (pas de progression, pas de bouton de validation) : ce lot est
          déjà écoulé, il n'y a rien à faire dessus, juste à le consulter. */}
      {viewingBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setViewingBatch(null)} />
          <div className="relative w-full max-w-[480px] max-h-[80vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-[15px]">Preuves soumises — lecture seule</h2>
                <p className="text-[11.5px] text-[#64748B] mt-0.5">
                  Soumission partielle déjà écoulée, non modifiable depuis cet aperçu.
                </p>
              </div>
              <button onClick={() => setViewingBatch(null)} className="p-1.5 rounded-full hover:bg-[#F1F5F9] shrink-0" aria-label="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4">
              <ReadOnlyProofCategories attachments={viewingBatch} />
            </div>
          </div>
        </div>
      )}
      {interlocutor && (identity?.id ?? userId) && (
        <MessageBubble
          missionId={missionId}
          currentUserId={(identity?.id ?? userId) as string}
          interlocutorId={interlocutor.id}
          interlocutorName={interlocutor.name}
          interlocutorAvatarPath={interlocutor.avatarPath}
        />
      )}
    </DashboardLayout>
  );
}
