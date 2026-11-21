"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PROFESSIONAL_TYPE_LABELS } from "@/lib/provider-options";
import { useSession } from "next-auth/react";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import { applicationDeadlineLabel, isOpenForApplications } from "@/lib/mission-expiry";
import { missionsHrefForRole, candidaturesHrefForRole, type Role } from "@/lib/role-dashboard";
import { canAttachLivrable, DELIVERABLE_SUBMITTABLE_STATUSES } from "@/lib/attachments";
import { DevisPanel, FixedPricePanel } from "@/components/devis/devis-panel";
import type { DevisProposalPayload } from "@/components/devis/types";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { isProposalEngaged } from "@/lib/messaging-visibility";
import { saveProposalDraft, loadProposalDraft, clearProposalDraft } from "@/lib/proposal-draft";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import ClientValidationWorkspace from "@/components/validation-client/ClientValidationWorkspace";
import MissionTracker from "@/components/mission-tracker";
import { FinancingModeNotice } from "@/components/financing/financing-mode-notice";
import { PaymentModelPicker } from "@/components/financing/payment-model-picker";
import { VALIDATION_MODE_LABEL } from "@/lib/validation-mode";
import { EscrowAccountPanel } from "@/components/escrow/escrow-account-panel";
import { AttendancePanel } from "@/components/spot-time/attendance-panel";
import { getFinancingMode } from "@/lib/financing-modes";
import { riskLevelLabel } from "@/lib/metier-risk";
import { ATTENDANCE_VALIDATION_LABEL, RATE_UNIT_LABEL } from "@/lib/spot-time";
import { PublicMissionView } from "@/components/mission/PublicMissionView";
import type { PublicMission } from "@/lib/public-mission";
import { personFullName } from "@/lib/person-name";
import { ArrowRight, Calendar, Clock, MapPin, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { categoryColor } from "@/components/dashboard/proto-ui";
import { proposalDraftFromPayload } from "@/lib/proposal-draft-restore";
import { heldCandidatureHref } from "@/components/dashboard/nav";

type OfferDetail = {
  id: string;
  titre: string;
  description: string;
  montant: number;
  currency: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  mission: { id: string };
};

// Mêmes libellés que OffresSection.tsx (dashboard prestataire) — une seule source de vérité
// pour l'affichage du statut d'une offre serait préférable, mais les deux vues restent
// suffisamment petites pour que la duplication documentée soit acceptable ici.
const OFFER_STATUS_LABEL: Record<string, string> = {
  brouillon: "Reçue",
  envoyee: "Reçue",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee: "Refusée",
  expiree: "Expirée",
};

type MissionDetail = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  budget: number;
  currency: string;
  delaiJours: number;
  // Dérivés serveur de GET /api/missions/[id] (voir src/app/api/missions/[id]/route.ts) : le
  // prix et le délai réellement CONVENUS (figés au contrat = proposition acceptée), dès que le
  // contrat existe — sinon null (la page retombe sur budget/delaiJours publiés).
  contractPrice: number | null;
  contractDelaiJours: number | null;
  riskLevel: string;
  insuranceRequired: boolean;
  status: string;
  clientId: string;
  client: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null; country?: string | null; kycStatus?: string | null; createdAt?: string } | null;
  createdAt: string;
  isOwner: boolean;
  ville?: string | null;
  quartier?: string | null;
  professionalType: string | null;
  requiredLevel: string | null;
  budgetType: string | null;
  financingModeKey: string | null;
  timeRate: number | null;
  timeMaxQuantity: number | null;
  attendanceValidation: "totale" | "partielle" | null;
  validationMode: "client" | "opr";
  isSiteManager?: boolean;
  tags: string[];
  maxRevisionRounds: number;
  dateExpiration: string | null;
  // Annonce et engagements (2026-11-10).
  parentMissionId?: string | null;
  parentMission?: { id: string; titre: string } | null;
  placesRecherchees?: number;
  prestatairesRetenus?: number;
  engagements?: {
    id: string;
    status: string;
    createdAt: string;
    provider: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null } | null;
  }[];
};

// Libellés alignés sur les filières (source unique : src/lib/provider-options.ts). Le client
// qui choisit la cible d'une mission doit lire les mêmes mots que le prestataire qui choisit
// sa filière.
const PROFESSIONAL_TYPE_LABEL: Record<string, string> = PROFESSIONAL_TYPE_LABELS;

const BUDGET_TYPE_LABEL: Record<string, string> = {
  FIXED: "Prix fixe",
  // Mêmes mots que le « Modèle de contrat » du formulaire de publication (2026-09-28).
  RATE: "Au temps",
  QUOTE: "Devis",
};

// Conditions au temps d'une mission S2 : le prestataire y chiffre un TARIF, et le plafond en
// découle. Null hors S2 (ou sur une mission S2 publiée avant que ses conditions existent).
function timeTermsOf(m: MissionDetail | null) {
  const mode = m ? getFinancingMode(m.financingModeKey ?? "") : null;
  if (!m || mode?.family !== "temps" || !mode.rateUnit || !m.timeMaxQuantity) return null;
  return { unit: RATE_UNIT_LABEL[mode.rateUnit], maxQuantity: m.timeMaxQuantity, rate: m.timeRate };
}

// Statuts où le séquestre est l'étape active côté client (contrat signé → paiement en
// cours/terminé) : la page mission expose l'accès au séquestre au même rythme que le statut
// réel de la mission.
const ESCROW_ACTIVE_STATUSES = new Set([
  "contrat_signe",
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
  "validee",
  "mediation_ouverte",
]);

// Soumission du livrable par le prestataire — source partagée avec la route (règle R03) :
// jamais avant le séquestre (A-2). Le bouton « Soumettre le livrable » n'apparaît plus à
// contrat_signe : fonds non sécurisés, voir DELIVERABLE_SUBMITTABLE_STATUSES (attachments.ts).
const DELIVERABLE_ACTIVE_STATUSES = new Set<string>(DELIVERABLE_SUBMITTABLE_STATUSES);

type AttachmentItem = { id: string; fileName: string | null; uploaderEmail: string | null; createdAt: string; url: string };

// Détail d'une mission — accessible au client propriétaire et aux prestataires.
// Affiche le statut, les informations clés et les actions disponibles.
export default function MissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const missionId = params.id as string;
  // Candidat ciblé par le bouton "Contacter" de la liste de candidatures (section
  // « Candidature ») — lu via window.location plutôt que useSearchParams pour rester un
  // simple useEffect, sans exiger de Suspense boundary (même convention que profile/page.tsx).
  const [requestedProviderId, setRequestedProviderId] = useState<string | null>(null);
  // `?candidater=1` (2026-11-03) : bouton « Candidater » des cartes de l'accueil. Le visiteur
  // passe par la connexion (ou l'inscription) et revient ici avec le formulaire déjà ouvert.
  const [wantsToApply, setWantsToApply] = useState(false);
  // `?chat=1` (2026-11-11) : bouton « Ouvrir le chat » des cartes de candidature — la bulle de
  // messagerie avec le candidat ciblé (`providerId`) s'ouvre directement.
  const [wantsChat, setWantsChat] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setRequestedProviderId(q.get("providerId"));
    setWantsChat(q.get("chat") === "1");
    setWantsToApply(q.get("candidater") === "1");
  }, []);
  const { data: session, status: sessionStatus } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isClient = role === "client";
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin === true;
  const missionsHref = missionsHrefForRole(role as Parameters<typeof missionsHrefForRole>[0]);

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [attachments, setAttachments] = useState<AttachmentItem[] | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [myProposal, setMyProposal] = useState<DevisProposalPayload | null | undefined>(undefined);
  const [myOffer, setMyOffer] = useState<OfferDetail | null | undefined>(undefined);
  // Candidatures reçues — affiché au client propriétaire (pastille "Statut • N candidatures",
  // façon maquette) ET utilisé pour résoudre l'interlocuteur non ambigu de la bulle de
  // messagerie (section H) quand le client a plusieurs candidats.
  const [proposals, setProposals] = useState<DevisProposalPayload[] | null>(null);
  const proposalsCount = proposals?.length ?? null;
  const [offerRespondError, setOfferRespondError] = useState<string | null>(null);
  const [respondingOffer, setRespondingOffer] = useState(false);

  // Candidature à prix fixe/taux (budgetType !== "QUOTE") — jusqu'ici le bouton
  // "Candidater" de cette page était un simple lien vers /dashboard/<role> : il ne
  // soumettait jamais rien, aucun formulaire n'existait pour ce mode (seul le mode QUOTE
  // avait DevisPanel). Un prestataire cliquant "Candidater" atterrissait juste sur son
  // dashboard sans que POST /api/missions/[id]/proposals ne soit jamais appelé.
  const [applying, setApplying] = useState(false);
  const [applyAmount, setApplyAmount] = useState("");
  const [applyDelay, setApplyDelay] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  // Modèle de paiement proposé avec le prix (fixe ou par jalons, 2026-10-01) — hors mission au
  // temps, où l'unité tarifaire publiée fixe déjà le régime.
  const [applyModeKey, setApplyModeKey] = useState<string | null>(null);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Refus `kyc_not_verified` : la seule issue est la vérification d'identité — un lien y mène.
  const [applyNeedsKyc, setApplyNeedsKyc] = useState(false);
  // Candidature retenue faute de KYC vérifié, mais ENREGISTRÉE en brouillon côté serveur
  // (src/lib/proposal-drafts.ts) : on le dit au lieu d'afficher un refus (2026-11-09).
  const [kycDraftSaved, setKycDraftSaved] = useState(false);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);
  // Blocage par profil incomplet (garant/assurance manquant) — même mécanisme que
  // la page devis (src/app/missions/[id]/devis/page.tsx, mode QUOTE) : distinct de `applyError`, il
  // n'affiche pas qu'une erreur, il enregistre un brouillon local et oriente vers l'action
  // à faire (compléter le profil sur /profile, avec retour automatique une fois fait).
  const [blockedByProfile, setBlockedByProfile] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // Confirmation de l'enregistrement manuel — état distinct d'`applySuccessMsg`, qui signifie
  // « candidature envoyée » et verrouille les boutons avant la redirection : un brouillon
  // enregistré, lui, laisse le formulaire pleinement utilisable.
  const [draftSavedMsg, setDraftSavedMsg] = useState<string | null>(null);

  // Restaure un brouillon local sauvegardé lors d'un précédent blocage — dès que l'écran de
  // candidature est pertinent (myProposal === null confirmé, donc pas encore candidaté).
  useEffect(() => {
    if (myProposal !== null) return;
    const draft = loadProposalDraft(missionId);
    if (!draft) {
      // Pas de brouillon sur cet appareil : peut-être une candidature retenue faute de KYC,
      // enregistrée côté serveur depuis un autre appareil.
      let stale = false;
      fetch(`/api/proposal-drafts?missionId=${encodeURIComponent(missionId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { kycVerified: boolean; items: { kind: string; payload: Record<string, unknown> }[] } | null) => {
          const item = d?.items.find((i) => i.kind === "proposal");
          if (stale || !item) return;
          const restored = proposalDraftFromPayload(item.payload);
          saveProposalDraft(missionId, restored);
          setApplyAmount(restored.montant > 0 ? String(restored.montant) : "");
          setApplyDelay(restored.delaiPropose ? String(restored.delaiPropose) : "");
          setApplyMessage(restored.message);
          if (restored.financingModeKey) setApplyModeKey(restored.financingModeKey);
          setKycDraftSaved(!d!.kycVerified);
          setRestoredFromDraft(true);
          setApplying(true);
        })
        .catch(() => {});
      return () => {
        stale = true;
      };
    }
    // Un brouillon enregistré à la main peut n'avoir aucun montant (montant: 0) : le champ
    // reste alors vide, plutôt que d'afficher un « 0 » que le candidat devrait effacer.
    setApplyAmount(draft.montant > 0 ? String(draft.montant) : "");
    setApplyDelay(draft.delaiPropose ? String(draft.delaiPropose) : "");
    setApplyMessage(draft.message);
    if (draft.financingModeKey) setApplyModeKey(draft.financingModeKey);
    setRestoredFromDraft(true);
    setApplying(true);
  }, [myProposal, missionId]);

  // Candidature en attente de la vérification d'identité (brouillon serveur) : quel que soit
  // l'appareil d'où le formulaire a été restauré, on le dit, et l'envoi devient une mise à jour.
  useEffect(() => {
    if (myProposal !== null) return;
    let stale = false;
    fetch(`/api/proposal-drafts?missionId=${encodeURIComponent(missionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { kycVerified: boolean; items: { kind: string }[] } | null) => {
        if (!stale && d && !d.kycVerified && d.items.some((i) => i.kind === "proposal")) setKycDraftSaved(true);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [myProposal, missionId]);

  // Mission publiée avant 2026-10-01 avec un mode fixe/jalons : point de départ du choix, que
  // le prestataire reste libre de changer.
  useEffect(() => {
    if (applyModeKey || !mission?.financingModeKey) return;
    const legacy = getFinancingMode(mission.financingModeKey);
    if (legacy && legacy.available && legacy.family !== "temps") setApplyModeKey(legacy.key);
  }, [mission, applyModeKey]);

  // Enregistrement manuel du brouillon (2026-09-10) — jusqu'ici la candidature à prix fixe
  // n'était sauvegardée QUE lorsque l'API la refusait pour profil incomplet : une saisie
  // interrompue autrement (fermeture d'onglet, aller-retour vers une autre mission) était
  // perdue, alors que le mode devis, lui, avait son bouton depuis l'origine.
  function saveProposalDraftNow() {
    const montant = Number(applyAmount) || 0;
    const message = applyMessage.trim();
    if (!montant && !message) {
      setApplyError("Renseignez au moins un montant ou un message avant d'enregistrer un brouillon.");
      return;
    }
    const delaiPropose = applyDelay.trim() ? Number(applyDelay) || undefined : undefined;
    saveProposalDraft(missionId, { montant, delaiPropose, message, financingModeKey: applyModeKey ?? undefined });
    setApplyError(null);
    setDraftSavedMsg("Brouillon enregistré sur cet appareil.");
  }

  async function submitProposal() {
    const montant = Number(applyAmount);
    const timeTerms = timeTermsOf(mission);
    if (!applyAmount || !(montant > 0)) {
      setApplyError(timeTerms ? "Indiquez un tarif valide." : "Indiquez un montant valide.");
      return;
    }
    if (timeTerms && !Number.isInteger(montant)) {
      setApplyError("Le tarif doit être un nombre entier.");
      return;
    }
    const delaiPropose = applyDelay.trim() ? Number(applyDelay) : undefined;
    if (applyDelay.trim() && (!delaiPropose || delaiPropose <= 0)) {
      setApplyError("Indiquez un délai valide (en jours).");
      return;
    }
    if (!timeTerms && !applyModeKey) {
      setApplyError("Choisissez le modèle de paiement : prix fixe ou par jalons.");
      return;
    }
    setApplySubmitting(true);
    setApplyError(null);
    setApplyNeedsKyc(false);
    setKycDraftSaved(false);
    setBlockedByProfile(null);
    const res = await fetch(`/api/missions/${missionId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Au temps, le prix du contrat est le plafond : le serveur le recalcule depuis le tarif, et
      // `montant` n'est envoyé que pour satisfaire le schéma commun.
      body: JSON.stringify(
        timeTerms
          ? { montant: Math.round(montant * timeTerms.maxQuantity), unitRate: montant, delaiPropose, message: applyMessage.trim() || undefined }
          : { montant, delaiPropose, message: applyMessage.trim() || undefined, financingModeKey: applyModeKey ?? undefined }
      ),
    });
    setApplySubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as { error?: string; message?: string }));
      // Profil incomplet (garant obligatoire manquant pour une mission présentiel/hybride,
      // ou assurance RC Pro manquante sur une mission à risque élevé —
      // checkCandidatureEligibility dans src/lib/candidature-guard.ts) : la candidature
      // n'est PAS perdue, on l'enregistre en brouillon local et on oriente vers l'action à
      // faire plutôt que d'afficher une simple erreur que le candidat ne saurait pas résoudre.
      if (data.error === "garant_required" || data.error === "insurance_required") {
        saveProposalDraft(missionId, { montant, delaiPropose, message: applyMessage.trim(), financingModeKey: applyModeKey ?? undefined });
        setBlockedByProfile(data.message ?? "Votre profil doit être complété avant de candidater à cette mission.");
        return;
      }
      // Gardes de sécurité (vagues 1-2) : auto-attribution et contrôle d'âge A13 (filière
      // chantier) — messages explicites au lieu du fallback générique.
      if (data.error === "self_dealing_forbidden") {
        setApplyError("Vous ne pouvez pas candidater à votre propre mission.");
        return;
      }
      if (data.error === "age_under_minimum") {
        setApplyError("Vous devez avoir l'âge minimum requis (18 ans) pour candidater à cette mission de chantier.");
        return;
      }
      if (data.error === "kyc_required_for_age") {
        setApplyError("Votre identité doit être vérifiée avant de candidater à une mission de chantier.");
        return;
      }
      const messages: Record<string, string> = {
        already_applied: "Vous avez déjà candidaté à cette mission.",
        mission_not_open: "Cette mission n'est plus ouverte aux candidatures.",
        kyc_not_verified: "Votre identité doit être vérifiée avant de candidater.",
        payment_mode_invalid: "Ce modèle de paiement n'est pas proposé — choisissez prix fixe ou par jalons.",
      };
      // KYC non vérifié : la candidature est enregistrée en brouillon (serveur, et sur cet
      // appareil) — elle partira telle quelle une fois l'identité vérifiée.
      if (data.error === "kyc_not_verified" && (data as { draftSaved?: boolean }).draftSaved) {
        saveProposalDraft(missionId, { montant, delaiPropose, message: applyMessage.trim(), financingModeKey: applyModeKey ?? undefined });
        setKycDraftSaved(true);
        // Direction la page des brouillons, qui dit en tête que la candidature n'est PAS partie
        // et permet de la modifier (2026-11-09).
        router.push(heldCandidatureHref(role, missionId));
        return;
      }
      setApplyError(messages[data.error ?? ""] ?? "Échec de l'envoi de la candidature.");
      setApplyNeedsKyc(data.error === "kyc_not_verified");
      return;
    }
    clearProposalDraft(missionId);
    setApplyAmount("");
    setApplyDelay("");
    setApplyMessage("");
    // Même comportement que la soumission d'un devis (src/app/missions/[id]/devis/page.tsx) :
    // laisser voir la confirmation un court instant avant de partir vers "Mes candidatures"
    // — avant ce correctif, les deux modes de candidature (devis vs prix fixe/taux) se
    // comportaient différemment après envoi (l'un redirigeait, l'autre restait sur place
    // sans jamais rediriger nulle part), sans raison fonctionnelle de diverger.
    // Pas de loadMyProposal() ici : on quitte la page dans l'instant, et rafraîchir
    // `myProposal` ferait disparaître ce bloc (gating sur myProposal === null) avant même
    // que le message de confirmation ait eu le temps de s'afficher.
    setApplySuccessMsg("Candidature envoyée — redirection vers vos candidatures...");
    setTimeout(() => router.push(candidaturesHrefForRole(role as Role)), 1200);
  }

  // Mémoïsées : elles sont passées en `onChanged` à deux panneaux enfants (lignes 572/741),
  // et une nouvelle identité à chaque rendu y relançait des effets. Elles ne dépendent que de
  // l'identité de la session et de la mission — donc rien qui bouge en cours de page.
  const loadMyOffer = useCallback(async () => {
    if (!userId || isClient) {
      setMyOffer(null);
      return;
    }
    try {
      const res = await fetchDedupe("/api/offers");
      const data = res.ok ? await res.json() : { items: [] };
      const found = (data.items ?? []).find((o: OfferDetail) => o.mission.id === missionId);
      setMyOffer(found ?? null);
    } catch {
      setMyOffer(null);
    }
  }, [userId, isClient, missionId]);

  async function respondToOffer(action: "accept" | "decline") {
    if (!myOffer) return;
    setRespondingOffer(true);
    setOfferRespondError(null);
    const res = await fetch(`/api/offers/${myOffer.id}/${action}`, { method: "POST" });
    setRespondingOffer(false);
    if (!res.ok) {
      setOfferRespondError("Échec de l'envoi de votre réponse. Réessayez.");
      return;
    }
    // Offre acceptée : le prestataire est retenu, son parcours se poursuit sur l'ENGAGEMENT
    // créé pour lui (2026-11-10) — l'offre et la candidature l'y ont suivi.
    const { engagementId } = (await res.json().catch(() => ({}))) as { engagementId?: string | null };
    if (action === "accept" && engagementId) {
      router.push(`/missions/${engagementId}`);
      return;
    }
    await loadMyOffer();
  }

  const loadMyProposal = useCallback(async () => {
    if (!userId || isClient) {
      setMyProposal(null);
      return;
    }
    try {
      const res = await fetchDedupe(`/api/missions/${missionId}/my-proposal`);
      setMyProposal(res.ok ? await res.json() : null);
    } catch {
      setMyProposal(null);
    }
  }, [userId, isClient, missionId]);

  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setMission)
      .finally(() => setLoading(false));
  }, [missionId]);

  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}/attachments`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAttachments(d.items))
      .catch(() => setAttachments([]));
  }, [missionId]);

  useEffect(() => {
    loadMyProposal();
  }, [loadMyProposal]);

  useEffect(() => {
    loadMyOffer();
  }, [loadMyOffer]);

  useEffect(() => {
    if (!mission?.isOwner) return;
    fetchDedupe(`/api/missions/${missionId}/proposals`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProposals(d.items ?? []))
      .catch(() => {});
  }, [missionId, mission?.isOwner]);

  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachError(null);
    setUploadingAttachment(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/missions/${missionId}/attachments`, { method: "POST", body: formData });
    setUploadingAttachment(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAttachError(
        data.error === "attachment_blocked_before_proposal_accepted"
          ? "Impossible de joindre un fichier avant qu'une proposition ne soit acceptée (évite le travail-test gratuit)."
          : "Échec de l'envoi du fichier."
      );
      return;
    }
    const listRes = await fetchDedupe(`/api/missions/${missionId}/attachments`);
    if (listRes.ok) setAttachments((await listRes.json()).items);
  }

  // Retour ici après connexion : la mission elle-même, avec l'intention de candidater conservée.
  const selfHref = `/missions/${missionId}${wantsToApply ? "?candidater=1" : ""}`;

  // Visiteur venu par « Candidater » : l'API refuse la mission sans session — on l'envoie se
  // connecter (ou s'inscrire depuis /signin), retour ici ensuite.
  useEffect(() => {
    if (wantsToApply && sessionStatus === "unauthenticated" && !loading && !mission) {
      router.replace(`/signin?callbackUrl=${encodeURIComponent(selfHref)}`);
    }
  }, [wantsToApply, sessionStatus, loading, mission, router, selfHref]);

  // Fiche PUBLIQUE (2026-11-09) : un visiteur non connecté lit une mission publiée — champs
  // filtrés par le serveur (src/lib/public-mission.ts). `undefined` = pas encore demandée,
  // `null` = mission non publique (brouillon, engagée, inexistante).
  const [publicMission, setPublicMission] = useState<PublicMission | null | undefined>(undefined);
  useEffect(() => {
    if (wantsToApply || sessionStatus !== "unauthenticated" || loading || mission) return;
    let alive = true;
    fetch(`/api/missions/${missionId}/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setPublicMission(d))
      .catch(() => alive && setPublicMission(null));
    return () => {
      alive = false;
    };
  }, [wantsToApply, sessionStatus, loading, mission, missionId]);

  // Prestataire de retour avec `?candidater=1` : formulaire ouvert et amené à l'écran, une seule
  // fois — fermer le formulaire ensuite reste possible.
  const [applyIntentHandled, setApplyIntentHandled] = useState(false);
  useEffect(() => {
    if (!wantsToApply || applyIntentHandled || !mission || myProposal === undefined) return;
    setApplyIntentHandled(true);
    if (mission.budgetType !== "QUOTE" && !mission.isOwner && !isClient && myProposal === null && isOpenForApplications(mission)) setApplying(true);
    requestAnimationFrame(() => document.getElementById("candidater")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [wantsToApply, applyIntentHandled, mission, myProposal, isClient]);

  if (loading) return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement...</div>;
  // Visiteur non connecté : l'API répond 401, la mission reste donc nulle — annoncer
  // « Mission introuvable » désignait alors une cause fausse (la mission existe, c'est la
  // session qui manque) et laissait l'utilisateur sans moyen d'aller plus loin. On l'envoie
  // se connecter, avec retour sur cette mission.
  if (!mission && sessionStatus === "unauthenticated") {
    // Venu par « Candidater » : direction la connexion sans étape intermédiaire (effet plus haut).
    if (wantsToApply) return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Redirection vers la connexion...</div>;
    if (publicMission === undefined) return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement...</div>;
    if (publicMission) return <PublicMissionView mission={publicMission} />;
    // Mission non publique (engagée, clôturée…) : seules ses parties la consultent, connectées.
    return (
      <div className="min-h-screen bg-[#F6F5FA] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-[13px] text-[#6B6478]">Connectez-vous pour consulter cette mission.</p>
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(selfHref)}`}
          className="inline-flex h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold items-center"
          style={{ textDecoration: "none" }}
        >
          Se connecter
        </Link>
      </div>
    );
  }
  if (!mission) return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Mission introuvable.</div>;

  // Le CLIENT PROPRIÉTAIRE d'une mission ENGAGÉE (contrat existant, hors brouillon/publiée)
  // voit directement la vue « Validation Client » (vérification des preuves/livrables) dans
  // le chrome client — remplace le détail générique à cette adresse (2026-09-03),
  // correspondance du pattern prestataire missions/[id]/deliverable. Sur une mission encore
  // brouillon/publiée, le propriétaire garde le détail ci-dessous (gérer ses propositions).
  // Les prestataires/visiteurs gardent toujours le détail mission (candidature, offre,
  // livrable à soumettre…).
  if (mission.isOwner && mission.status !== "brouillon" && mission.status !== "publiee") {
    return <ClientValidationWorkspace missionId={mission.id} />;
  }
  // Mode OPR : le responsable de chantier désigné sur le contrat vérifie dans le même espace.
  if (mission.isSiteManager) {
    return <ClientValidationWorkspace missionId={mission.id} role="site_manager" />;
  }

  // MISSION_STATUS_STYLE (src/lib/mission-status.ts) — même source que /missions et le
  // dashboard client, plutôt qu'une 3e copie locale qui, comme les deux précédentes,
  // omettait "fonds_sous_sequestre" et "validee" (statuts posés par le webhook PSP).
  const st = MISSION_STATUS_STYLE[mission.status as keyof typeof MISSION_STATUS_STYLE] ?? MISSION_STATUS_STYLE.brouillon;

  // Interlocuteur de la bulle de messagerie (section H) — non ambigu ET engagé :
  //   - prestataire (!isOwner) → le client, mais UNIQUEMENT s'il a lui-même candidaté et que
  //     la négociation est ouverte. Jusqu'ici la bulle s'affichait sur n'importe quelle
  //     mission consultée, y compris sans aucune candidature : n'importe quel prestataire
  //     pouvait ouvrir un canal vers n'importe quel client du catalogue.
  //   - client (isOwner) → le candidat visé par ?providerId= (bouton "Contacter" de la liste
  //     de candidatures), sinon le seul candidat s'il n'y en a qu'un, sinon aucune bulle
  //     (ambiguïté non résolue plutôt que de deviner lequel contacter) — et là aussi
  //     seulement si sa candidature est encore vivante.
  // Le prédicat est partagé et testé (src/lib/messaging-visibility.ts) plutôt que recopié ici.
  let interlocutor: { id: string; name: string; avatarPath: string | null } | null = null;
  if (!mission.isOwner && mission.client) {
    if (myProposal && isProposalEngaged(myProposal.status)) {
      const name = personFullName(mission.client) || "Client";
      interlocutor = { id: mission.client.id, name, avatarPath: mission.client.avatarPath };
    }
  } else if (mission.isOwner && proposals) {
    const targeted = requestedProviderId ? proposals.find((p) => p.provider.id === requestedProviderId) : null;
    const candidate = targeted ?? (proposals.length === 1 ? proposals[0] : null);
    if (candidate && isProposalEngaged(candidate.status)) {
      const name = personFullName(candidate.provider) || "Prestataire";
      interlocutor = { id: candidate.provider.id, name, avatarPath: candidate.provider.avatarPath ?? null };
    }
  }
  const canUploadAttachment = canAttachLivrable(mission.status as Parameters<typeof canAttachLivrable>[0]);
  // Une seule vraie donnée de montant à mettre en avant dans la barre mobile : le devis en
  // cours si mode QUOTE, sinon la candidature à prix fixe/taux, sinon le budget de la mission.
  const highlightAmount = myProposal?.devisData?.totalTTC ?? myProposal?.montant ?? mission.budget;
  // Le lien de retour ramène le prestataire vers SES candidatures (là où il vient
  // naturellement de cette page) plutôt que la liste générale des missions ; le client
  // (jamais candidat) garde "Retour aux missions" vers sa propre liste, inchangé.
  const backHref = !isClient && !mission.isOwner ? candidaturesHrefForRole(role as Role) : missionsHref;
  const backLabel = !isClient && !mission.isOwner ? "Retour aux candidatures" : "Retour aux missions";

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-doc [--fw:1200px] mx-auto px-4 lg:px-6 pb-[110px] lg:pb-10 pt-5 space-y-4">
        {/* Bandeau d'évolution de la mission — synchronisé sur le statut réel (client +
            prestataire), voir mission-tracker.tsx */}
        <MissionTracker missionId={mission.id} />

        {/* Fil d'Ariane */}
        <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap">
          <Link href={missionsHref} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Missions</Link>
          <span>›</span>
          <span className="text-[#191224] font-medium">{mission.titre}</span>
        </div>

        {/* Maquette « fiche mission » (2026-11-11) : contenu principal à gauche, encadrés
            « Paiement protégé » et « Date limite » à droite. Toutes les sections d'action
            (candidature, devis, offre, pièces jointes, séquestre…) suivent dans la colonne
            principale, inchangées. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="min-w-0 space-y-4">

        {/* Fiche : en-tête dégradé + budget + description + conditions */}
        <article className="bg-white border border-[#E7E2F0] rounded-3xl overflow-hidden">
          <header className="p-5 lg:p-7 text-white" style={{ background: `linear-gradient(120deg, ${categoryColor(mission.domaine || mission.titre)}, #0f766e)` }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold bg-black/25 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden /> {st.label}{mission.domaine ? ` • ${mission.domaine.replace(/[-_]+/g, " ")}` : ""}
              </span>
              <span className="text-[11px] font-semibold bg-black/20 px-2 py-1 rounded-full">ID #{mission.id.slice(-8).toUpperCase()}</span>
            </div>
            <h1 className="font-display font-extrabold leading-[1.08] mt-3" style={{ fontSize: "clamp(24px, 3.6vw, 40px)" }}>{mission.titre}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] font-medium text-white/90">
              {(mission.ville || mission.client?.country) && (
                <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" aria-hidden />{[mission.quartier, mission.ville].filter(Boolean).join(", ") || mission.client?.country}</span>
              )}
              <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden />{mission.contractDelaiJours ?? mission.delaiJours} jour{(mission.contractDelaiJours ?? mission.delaiJours) > 1 ? "s" : ""}{mission.contractDelaiJours ? " (contrat)" : ""}</span>
              <span className="inline-flex items-center gap-1"><Calendar className="w-4 h-4" aria-hidden />Publiée le {new Date(mission.createdAt).toLocaleDateString("fr-FR")}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${mission.riskLevel === "high" ? "bg-[#FEECEB] text-[#B42318]" : mission.riskLevel === "medium" ? "bg-[#FFF6E3] text-[#B45309]" : "bg-white/20 text-white"}`}>
                Risque {riskLevelLabel(mission.riskLevel).toLowerCase()}
              </span>
              {mission.insuranceRequired && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FEECEB] text-[#B42318]">Assurance obligatoire</span>}
            </div>
          </header>

          <div className="p-5 lg:p-6 space-y-5">
            {/* Budget + candidatures */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {/* Dès qu'une proposition est acceptée (contrat généré), le montant affiché est le
                    prix CONVENU (montant de la contre-proposition acceptée, figé au contrat), pas le
                    budget initialement publié — synchronisé sur le statut de la mission. */}
                <div className="text-[12px] text-[#6B6478]">
                  {mission.contractPrice
                    ? "Prix convenu (contrat)"
                    : mission.budgetType === "QUOTE" ? "Budget indicatif" : "Budget publié"}
                </div>
                <div className="font-display font-extrabold text-[#047857] leading-none mt-1" style={{ fontSize: "clamp(26px, 3.2vw, 34px)" }}>
                  {(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} {mission.currency === "XOF" ? "FCFA" : mission.currency}
                </div>
                {!mission.contractPrice && timeTermsOf(mission) && mission.timeRate && (
                  <div className="text-[13px] text-[#6B6478] mt-1">
                    Plafond — {mission.timeRate.toLocaleString("fr-FR")} / {timeTermsOf(mission)!.unit.one} × {timeTermsOf(mission)!.maxQuantity}
                  </div>
                )}
              </div>
              {mission.isOwner && mission.status === "publiee" && (
                <div className="text-right">
                  {proposalsCount !== null && <div className="text-[14px] font-bold text-[#191224]">{proposalsCount} candidature{proposalsCount > 1 ? "s" : ""}</div>}
                  <Link href={`/missions/${mission.id}/proposals`} className="mt-2 inline-flex px-4 py-2 rounded-full bg-[#4C1D95] text-white text-[13px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                    {mission.budgetType === "QUOTE" ? "Voir les devis reçus" : "Voir les candidatures"}
                  </Link>
                </div>
              )}
            </div>

            {/* Engagement : la mission d'UN prestataire retenu sur une annonce (2026-11-10). */}
            {mission.parentMission && (
              <p className="text-[13px] text-[#4A4258]">
                Engagement issu de l&apos;annonce{" "}
                <Link href={`/missions/${mission.parentMission.id}`} className="font-semibold text-[#4C1D95] hover:underline">
                  « {mission.parentMission.titre} »
                </Link>
              </p>
            )}
            {/* Annonce : période de candidature et places (2026-11-10). */}
            {!mission.parentMissionId && (mission.status === "publiee" || mission.status === "annonce_close") && (
              <AnnonceFacts mission={mission} />
            )}

            <p className="text-[15px] leading-[1.65] text-[#191224] whitespace-pre-wrap">{mission.description}</p>

            {/* Conditions publiées */}
            <div>
              <h2 className="font-display font-bold text-[16px] text-[#191224] mb-3">Conditions de la mission</h2>
              <dl className="grid sm:grid-cols-2 gap-2 text-[13px]">
                <Condition label="Domaine" value={mission.domaine} />
                {mission.professionalType && (
                  <Condition label="Recherché" value={`${PROFESSIONAL_TYPE_LABEL[mission.professionalType] ?? mission.professionalType}${mission.requiredLevel ? ` — Niveau ${mission.requiredLevel}` : ""}`} />
                )}
                {mission.budgetType && <Condition label="Rémunération" value={BUDGET_TYPE_LABEL[mission.budgetType] ?? mission.budgetType} />}
                {/* Vérification / validation : condition d'exécution publiée — le prestataire sait,
                    avant de candidater, qui constatera son travail. */}
                <Condition
                  label="Vérification"
                  title={VALIDATION_MODE_LABEL[mission.validationMode ?? "client"].definition}
                  value={mission.validationMode === "opr" ? "OPR / responsable chantier — il vérifie, le client valide définitivement" : "Par le client lui-même"}
                />
                {/* Au temps, le mode fait partie des conditions publiées. Sinon, fixe ou par jalons
                    se décide dans le devis du prestataire (2026-10-01). */}
                {getFinancingMode(mission.financingModeKey ?? "")?.family === "temps" ? (
                  <>
                    <Condition label="Financement" value={getFinancingMode(mission.financingModeKey ?? "")!.label} />
                    <Condition
                      label="Pointage"
                      title={ATTENDANCE_VALIDATION_LABEL[mission.attendanceValidation ?? "partielle"].definition}
                      value={ATTENDANCE_VALIDATION_LABEL[mission.attendanceValidation ?? "partielle"].label}
                    />
                  </>
                ) : mission.budgetType ? (
                  <Condition label="Paiement" value="Prix fixe ou par jalons — proposé par le prestataire dans son devis" />
                ) : null}
              </dl>
              {mission.tags && mission.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {mission.tags.map((tag) => (
                    <span key={tag} className="inline-flex px-2.5 py-1 rounded-full bg-[#EFEAF8] text-[#4A4258] text-[12px] font-medium">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Client de la mission */}
            {mission.client && (
              <div className="rounded-2xl bg-[#EFEAF8] p-4 flex items-center gap-3">
                <Avatar
                  src={mission.client.avatarPath ? `/api/users/${mission.client.id}/avatar` : null}
                  initials={((mission.client.firstname?.[0] ?? "") + (mission.client.lastname?.[0] ?? "")).toUpperCase() || "C"}
                  gradient="from-[#4C1D95] to-[#6D28D9]"
                  size={44}
                />
                <div className="min-w-0">
                  <div className="font-bold text-[15px] text-[#191224]">{personFullName(mission.client) || "Client"}{mission.isOwner ? " (vous)" : ""}</div>
                  <div className="text-[13px] text-[#6B6478] flex flex-wrap gap-x-1.5">
                    {mission.client.kycStatus === "verifie" && <span className="inline-flex items-center gap-1 font-semibold text-[#047857]"><ShieldCheck className="w-3.5 h-3.5" aria-hidden />Identité vérifiée</span>}
                    {mission.client.createdAt && <span>{mission.client.kycStatus === "verifie" ? "• " : ""}Membre depuis {new Date(mission.client.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>}
                  </div>
                </div>
              </div>
            )}

            {mission.isOwner && mission.status === "publiee" && (
              <Link href={`/missions/${mission.id}/proposals`} className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full bg-[#4C1D95] text-white text-[15px] font-bold hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                {mission.budgetType === "QUOTE" ? "Gérer les devis" : "Gérer les candidatures"} <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            )}
          </div>
        </article>

        {/* Mode devis (QUOTE) */}
        {mission.budgetType === "QUOTE" && !mission.isOwner && !isClient && (myProposal === undefined ? (
          <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
            <p className="text-[13px] text-[#6B6478]">Chargement de votre candidature...</p>
          </div>
        ) : (
          <div id="candidater" className="scroll-mt-20">
          <DevisPanel
            missionId={mission.id}
            maxRounds={mission.maxRevisionRounds ?? 3}
            proposal={myProposal}
            isClient={false}
            canSubmit={isOpenForApplications(mission)}
            onChanged={loadMyProposal}
            currency={mission.currency}
          />
          </div>
        ))}

        {/* Compte en mode client sur la mission d'un autre (2026-11-03) : candidater exige
            l'espace prestataire. Sans cet encadré, un visiteur inscrit depuis « Candidater »
            revenait sur une mission sans aucune action possible ni explication. */}
        {isClient && !isAdmin && !mission.isOwner && isOpenForApplications(mission) && (
          <div id="candidater" className="scroll-mt-20 bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
            <h3 className="text-[13px] font-semibold mb-1">Candidater à cette mission</h3>
            <p className="text-[13px] text-[#6B6478] mb-3">
              Votre compte est en mode client. Ouvrez votre espace prestataire — même compte, aucune nouvelle
              inscription — puis revenez ici pour proposer votre prix.
            </p>
            <Link
              href={`/devenir-prestataire?returnTo=${encodeURIComponent(`/missions/${missionId}?candidater=1`)}`}
              className="inline-flex h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold items-center hover:bg-[#3B1578]"
              style={{ textDecoration: "none" }}
            >
              Ouvrir mon espace prestataire
            </Link>
          </div>
        )}

        {/* Candidater à prix fixe/taux (hors mode QUOTE) — pendant du bloc DevisPanel
            ci-dessus pour le mode devis. N'apparaît que si aucune candidature n'existe
            encore (myProposal === null) et que la mission accepte des candidatures. */}
        {mission.budgetType !== "QUOTE" && !mission.isOwner && !isClient && myProposal === null && isOpenForApplications(mission) && (
          <div id="candidater" className="scroll-mt-20 bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
            <h3 className="text-[13px] font-semibold mb-2">Candidater à cette mission</h3>

            {/* quoteMode={false} : hors mode devis il n'y a aucune ligne à dériver en jalons —
                la consigne le dit explicitement au lieu de promettre un découpage que le
                montant unique saisi ici ne décidera pas (voir providerBrief). */}
            {timeTermsOf(mission) ? (
              <>
                <FinancingModeNotice modeKey={mission.financingModeKey} quoteMode={false} className="mb-3" />
                <p className="mb-3 -mt-1 text-[12px] text-[#4A4258] rounded-lg border border-[#E7E2F0] bg-[#F6F5FA] px-3 py-2">
                  <strong className="text-[#191224]">Mode de pointage : {ATTENDANCE_VALIDATION_LABEL[mission.attendanceValidation ?? "partielle"].label}.</strong>{" "}
                  {ATTENDANCE_VALIDATION_LABEL[mission.attendanceValidation ?? "partielle"].definition}
                </p>
              </>
            ) : (
              // Fixe ou par jalons : c'est la candidature qui le propose (2026-10-01), le client
              // l'accepte avec le prix. Affiché une fois le formulaire ouvert, avec le montant.
              applying && <PaymentModelPicker value={applyModeKey} onChange={setApplyModeKey} quoteMode={false} className="mb-3" />
            )}

            {kycDraftSaved && (
              <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2 mb-3">
                <p className="font-semibold">Candidature enregistrée — en attente de la vérification de votre identité.</p>
                <p>
                  Elle sera envoyée automatiquement au client dès que votre identité sera vérifiée : vous n&apos;aurez rien
                  à refaire. D&apos;ici là, vous pouvez la modifier ci-dessous puis cliquer « Mettre à jour ma candidature ».
                </p>
                <Link href="/kyc" className="inline-block font-semibold underline">Vérifier mon identité</Link>
              </div>
            )}

            {restoredFromDraft && !blockedByProfile && !kycDraftSaved && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 mb-3">
                {/* Formulation neutre depuis l'ajout du bouton d'enregistrement manuel : le
                    brouillon ne vient plus forcément d'un blocage pour profil incomplet, il
                    peut avoir été enregistré délibérément. Mentionner le profil serait faux
                    dans ce cas — et le vrai blocage, lui, a déjà son propre encadré. */}
                Brouillon restauré — reprenez votre candidature là où vous l&apos;aviez laissée.
              </div>
            )}

            {blockedByProfile && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-2 mb-3">
                <p className="font-semibold">{blockedByProfile}</p>
                <p>
                  Votre candidature a été enregistrée comme brouillon sur cet appareil — complétez votre profil, puis
                  revenez sur cette page pour la retrouver telle quelle et la valider.
                </p>
                <Link
                  href={`/profile?returnTo=${encodeURIComponent(`/missions/${missionId}`)}`}
                  className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                  style={{ textDecoration: "none" }}
                >
                  Compléter mon profil
                </Link>
              </div>
            )}

            {!applying ? (
              <>
                <p className="text-[13px] text-[#6B6478] mb-3">Proposez votre prix pour cette mission.</p>
                <button onClick={() => setApplying(true)} className="inline-flex h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold items-center hover:bg-[#3B1578]">
                  Candidater
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#4A4258] mb-1">
                    {timeTermsOf(mission) ? `Votre tarif par ${timeTermsOf(mission)!.unit.one} (${mission.currency}) *` : `Votre prix (${mission.currency}) *`}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={500}
                    value={applyAmount}
                    onChange={(e) => { setApplyAmount(e.target.value); setDraftSavedMsg(null); }}
                    placeholder={
                      timeTermsOf(mission)
                        ? String(mission.timeRate ?? "Ex: 7500")
                        : mission.budget ? String(mission.budget) : "Ex: 85000"
                    }
                    className="w-full h-10 px-3 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                  />
                  {timeTermsOf(mission) && (
                    <p className="text-[11px] text-[#6B6478] mt-1 tabular-nums">
                      {Number(applyAmount) > 0
                        ? `Plafond du contrat : ${Math.round(Number(applyAmount) * timeTermsOf(mission)!.maxQuantity).toLocaleString("fr-FR")} ${mission.currency} (${timeTermsOf(mission)!.maxQuantity} ${timeTermsOf(mission)!.unit.many} maximum). Seul le temps constaté vous sera versé.`
                        : `Mission au temps : ${timeTermsOf(mission)!.maxQuantity} ${timeTermsOf(mission)!.unit.many} maximum. Le client séquestre le plafond avant le démarrage.`}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Votre délai (en jours) — optionnel</label>
                  <input
                    type="number"
                    min={1}
                    value={applyDelay}
                    onChange={(e) => { setApplyDelay(e.target.value); setDraftSavedMsg(null); }}
                    placeholder={mission.delaiJours ? String(mission.delaiJours) : "Ex: 30"}
                    className="w-full h-10 px-3 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                  />
                  <p className="text-[11px] text-[#9A93A8] mt-1">
                    Sans indication, le délai de la mission ({mission.delaiJours} jours) s&apos;appliquera au contrat.
                  </p>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Message (optionnel)</label>
                  <textarea
                    value={applyMessage}
                    onChange={(e) => { setApplyMessage(e.target.value.slice(0, 2000)); setDraftSavedMsg(null); }}
                    rows={3}
                    placeholder="Présentez-vous, votre expérience, votre disponibilité..."
                    className="w-full px-3 py-2 rounded-lg border border-[#E7E2F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                  />
                </div>
                {applySuccessMsg && <p className="text-[12px] text-emerald-700">{applySuccessMsg}</p>}
                {draftSavedMsg && !applySuccessMsg && <p className="text-[12px] text-emerald-700">{draftSavedMsg}</p>}
                {applyError && (
                  <p className="text-[12px] text-red-600">
                    {applyError}
                    {applyNeedsKyc && (
                      <>
                        {" "}
                        <Link href="/kyc" className="font-semibold underline">Vérifier mon identité</Link>
                      </>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={submitProposal} className="h-10 px-5 rounded-full bg-[#047857] text-white text-[13px] font-semibold hover:bg-[#065F46] disabled:opacity-50">
                    {applySubmitting ? "Envoi..." : kycDraftSaved ? "Mettre à jour ma candidature" : "Envoyer ma candidature"}
                  </button>
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={saveProposalDraftNow} className="h-10 px-5 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium hover:bg-[#F6F5FA] disabled:opacity-50">
                    Enregistrer brouillon
                  </button>
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={() => { setApplying(false); setApplyError(null); setApplyNeedsKyc(false); }} className="h-10 px-5 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium hover:bg-[#F6F5FA]">
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Offre reçue (model Offer — envoyée par le client à partir d'une candidature) ──
            Distincte de "Ma candidature" ci-dessous : une offre formelle n'existe que si le
            client a explicitement fait progresser une proposition (voir POST
            /api/missions/[id]/proposals/[proposalId]/offer). */}
        {!mission.isOwner && !isClient && myOffer && (
          <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Offre reçue</h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FFF6E3] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">
                {OFFER_STATUS_LABEL[myOffer.status] ?? myOffer.status}
              </span>
            </div>
            <p className="mt-3 text-[13px] font-semibold text-[#191224]">{myOffer.titre}</p>
            <div className="mt-2 flex items-center justify-between text-[13px]">
              <span className="text-[#6B6478]">Montant proposé</span>
              <strong className="font-fraunces text-[#047857] text-[16px]">{myOffer.montant.toLocaleString("fr-FR")} {myOffer.currency}</strong>
            </div>
            {myOffer.description && <p className="mt-2 text-[13px] text-[#4A4258] leading-relaxed">{myOffer.description}</p>}
            <p className="mt-2 text-[11px] text-[#9A93A8]">Envoyée le {new Date(myOffer.sentAt ?? myOffer.createdAt).toLocaleDateString("fr-FR")}</p>
            {offerRespondError && <div className="mt-2 rounded-lg border border-[#FECACA] bg-[#FEECEB] p-2.5 text-[12px] text-[#B42318]">{offerRespondError}</div>}
            {myOffer.status === "envoyee" && (
              <div className="flex gap-2 mt-3">
                <button disabled={respondingOffer} onClick={() => respondToOffer("accept")} className="h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] disabled:opacity-50">
                  {respondingOffer ? "…" : "Accepter l'offre"}
                </button>
                <button disabled={respondingOffer} onClick={() => respondToOffer("decline")} className="h-10 px-5 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium hover:bg-[#F6F5FA] disabled:opacity-50">
                  Refuser
                </button>
              </div>
            )}
          </div>
        )}

        {/* Ma candidature (missions à prix fixe/taux, hors mode devis) — même modèle de
            négociation par rounds que le mode devis (FixedPricePanel réutilise
            NegotiationTracker/DevisDetails/RequestRevision/Revisions, voir
            src/components/devis/devis-panel.tsx) : round tracker, prix courant, demande de
            révision, resoumission par le prestataire, acceptation finale par le client
            (POST .../accept — jamais .../devis/validate, voir le commentaire dans
            devis-panel.tsx). Avant ce correctif, cette carte était en lecture seule (aucune
            négociation possible, seul un accord immédiat ou rien). */}
        {mission.budgetType !== "QUOTE" && !mission.isOwner && myProposal && (
          <FixedPricePanel
            missionId={mission.id}
            maxRounds={mission.maxRevisionRounds ?? 3}
            proposal={myProposal}
            isClient={false}
            onChanged={loadMyProposal}
            currency={mission.currency}
          />
        )}

        {/* Pièces jointes */}
        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold flex items-center gap-2">Pièces jointes</h3>

          {attachError && <div className="mt-3 rounded-lg border border-[#FDE68A] bg-[#FFF6E3] p-2.5 text-[12px] text-[#92400E]">{attachError}</div>}

          {attachments === null ? (
            <p className="mt-3 text-[13px] text-[#6B6478]">Chargement...</p>
          ) : attachments.length === 0 ? (
            <div className="mt-4 flex gap-3 p-3 rounded-xl bg-[#F6F5FA] border border-dashed border-[#E7E2F0]">
              <div className="w-9 h-9 rounded-lg bg-white border border-[#E7E2F0] flex items-center justify-center shrink-0 text-[#9A93A8]">📄</div>
              <div className="text-[13px] font-medium text-[#4A4258]">Aucune pièce jointe pour l&apos;instant.</div>
            </div>
          ) : (
            <ul className="mt-3 space-y-0 divide-y divide-[#EFEAF8]">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2.5 gap-3">
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-[#4C1D95] text-[13px] font-semibold" style={{ textDecoration: "none" }}>
                    {a.fileName ?? "Fichier"}
                  </a>
                  <span className="text-[#9A93A8] text-[11px] shrink-0">{a.uploaderEmail ?? "?"} · {new Date(a.createdAt).toLocaleDateString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          )}

          {canUploadAttachment ? (
            <div className="mt-4">
              <label className="inline-flex h-9 px-4 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium items-center cursor-pointer hover:bg-[#F6F5FA]">
                {uploadingAttachment ? "Envoi..." : "+ Joindre un fichier"}
                <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleAttachmentUpload} disabled={uploadingAttachment} style={{ display: "none" }} />
              </label>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[#9A93A8] italic flex items-start gap-1.5">
              ℹ️ L&apos;ajout de pièces jointes sera possible une fois une proposition acceptée (évite le travail-test gratuit).
            </p>
          )}
        </div>

        {/* Compte du séquestre (2026-09-14) — vue PRESTATAIRE. Sur une mission engagée, le
            client est redirigé vers son espace de validation (voir plus haut) : cette page est
            donc celle du prestataire, et c'est ici qu'il doit pouvoir constater ce qui lui est
            reconnu dû mais pas encore versé. Sans cela, la distinction « validé ≠ payé » ne
            protégeait que celui qui paie.
            La route renvoie 404 tant qu'aucun contrat n'existe, et le panneau ne rend alors
            rien — inutile de dupliquer ici la condition de statut. */}
        {!mission.isOwner && <EscrowAccountPanel missionId={mission.id} />}

        {/* Relevés de présence — contrats au temps uniquement. Le panneau ne rend rien sur les
            autres contrats (la route répond 409 `not_a_time_contract`), inutile de dupliquer ici
            une condition que le serveur porte déjà. */}
        {!mission.isOwner && <AttendancePanel missionId={mission.id} />}

        {/* Actions (desktop) */}
        <div className="hidden lg:flex items-center flex-wrap gap-2 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            {mission.status !== "brouillon" && mission.status !== "publiee" && (
              <Link href={`/missions/${mission.id}/contract`} className="inline-flex h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold items-center hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
                Voir le contrat
              </Link>
            )}
            {DELIVERABLE_ACTIVE_STATUSES.has(mission.status) && !mission.isOwner && (
              <Link href={`/missions/${mission.id}/deliverable`} className="inline-flex h-10 px-5 rounded-full bg-[#191224] text-white text-[13px] font-semibold items-center hover:bg-black" style={{ textDecoration: "none" }}>
                Soumettre le livrable
              </Link>
            )}
            {ESCROW_ACTIVE_STATUSES.has(mission.status) && mission.isOwner && (
              <Link href={`/missions/${mission.id}/escrow`} className="inline-flex h-10 px-5 rounded-full bg-[#191224] text-white text-[13px] font-semibold items-center hover:bg-black" style={{ textDecoration: "none" }}>
                Paiement sous séquestre
              </Link>
            )}
            {mission.status === "cloturee" && (
              <Link href={`/missions/${mission.id}/reviews`} className="inline-flex h-10 px-5 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium items-center hover:bg-[#F6F5FA]" style={{ textDecoration: "none" }}>
                Donner un avis
              </Link>
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          <Link href={backHref} className="text-[#6B6478] text-[13px]" style={{ textDecoration: "none" }}>
            ← {backLabel}
          </Link>
        </div>

        {/* Accès au pilotage — bouton dédié en bas de page (distinct du lien "Voir le
            contrat" de la barre d'actions ci-dessus, qui reste inchangé) : même destination,
            /missions/[id]/contract, où se trouve l'étape "Pilotage" du stepper (Contrat →
            Signature → Financement → Pilotage → Clôture, voir contract-stepper.ts) — le
            client/prestataire y suit le séquestre, les jalons et le livrable de CETTE
            mission. Même condition que "Voir le contrat" : rien à piloter avant qu'un
            contrat existe (brouillon/publiée). Visible sur toutes tailles d'écran,
            contrairement au reste de cette barre (desktop uniquement) ou à la barre fixe
            mobile (qui ne porte que "Retour").             */}
        {mission.status !== "brouillon" && mission.status !== "publiee" && (
          <div className="pt-2">
            <Link
              href={`/missions/${mission.id}/contract`}
              className="flex items-center justify-center gap-2 h-12 w-full rounded-xl bg-[#191224] text-white text-[13px] font-semibold hover:bg-black transition-colors"
              style={{ textDecoration: "none" }}
            >
              Accéder au pilotage de la mission →
            </Link>
          </div>
        )}
        </div>{/* fin colonne principale */}

        <MissionAside mission={mission} isOwner={mission.isOwner} canApply={!mission.isOwner && !isClient && isOpenForApplications(mission)} />
        </div>{/* fin grille */}
      </div>

      {/* Barre d'action fixe — mobile uniquement */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E7E2F0] p-3 z-40" style={{ boxShadow: "0 -8px 24px rgba(15,23,42,0.06)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#6B6478] font-semibold">{mission.budgetType === "QUOTE" ? "Devis" : "Budget"}</div>
            <div className="text-[18px] font-bold text-[#047857] leading-none mt-0.5">
              {highlightAmount.toLocaleString("fr-FR")} <span className="text-[12px] font-semibold">{mission.currency}</span>
            </div>
          </div>
          <Link href={backHref} className="h-11 px-6 rounded-xl border border-[#E7E2F0] text-[#6B6478] text-[13px] font-medium inline-flex items-center" style={{ textDecoration: "none" }}>
            {backLabel}
          </Link>
        </div>
      </div>

      {interlocutor && userId && (
        <MessageBubble
          missionId={missionId}
          currentUserId={userId}
          interlocutorId={interlocutor.id}
          interlocutorName={interlocutor.name}
          interlocutorAvatarPath={interlocutor.avatarPath}
          initialOpen={wantsChat}
        />
      )}
    </div>
  );
}

// Faits de l'annonce (2026-11-10) : jusqu'à quand elle reçoit des candidatures, combien de
// prestataires le client recherche et combien il en a déjà retenus — et, pour le client, la
// liste des prestataires retenus avec un lien vers leur engagement.
function AnnonceFacts({ mission }: { mission: MissionDetail }) {
  const deadline = mission.status === "annonce_close" ? "Candidatures closes" : applicationDeadlineLabel(mission.dateExpiration);
  const places = mission.placesRecherchees ?? 1;
  const retenus = mission.prestatairesRetenus ?? 0;
  const engagements = mission.engagements ?? [];
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2 text-[12px]">
        {deadline && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
              isOpenForApplications(mission) ? "border-[#4C1D95]/25 bg-[#4C1D95]/5 text-[#4C1D95]" : "border-[#E7E2F0] bg-[#F6F5FA] text-[#6B6478]"
            }`}
          >
            🗓 {deadline}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E2F0] bg-[#F6F5FA] px-2.5 py-1 font-semibold text-[#3F3850]">
          👥 {places} prestataire{places > 1 ? "s" : ""} recherché{places > 1 ? "s" : ""} · {retenus} retenu{retenus > 1 ? "s" : ""}
        </span>
      </div>
      {!mission.isOwner && retenus >= places && isOpenForApplications(mission) && (
        <p className="text-[12px] text-[#6B6478]">
          Le client a déjà retenu le nombre de prestataires recherchés. L&apos;annonce reste ouverte jusqu&apos;à sa date limite.
        </p>
      )}
      {mission.isOwner && engagements.length > 0 && (
        <ul className="space-y-1.5" aria-label="Prestataires retenus">
          {engagements.map((e) => {
            const name = [e.provider?.firstname, e.provider?.lastname].filter(Boolean).join(" ") || "Prestataire";
            const est = MISSION_STATUS_STYLE[e.status as keyof typeof MISSION_STATUS_STYLE] ?? MISSION_STATUS_STYLE.brouillon;
            return (
              <li key={e.id}>
                <Link
                  href={`/missions/${e.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#E7E2F0] px-3 py-2 text-[13px] hover:bg-[#F6F5FA]"
                  style={{ textDecoration: "none" }}
                >
                  <span className="font-semibold text-[#191224]">{name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${est.bg} ${est.text}`}>{est.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Condition({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-xl border border-[#E7E2F0] px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6478]">{label}</dt>
      <dd className="mt-0.5 text-[#191224] font-medium" title={title}>{value}</dd>
    </div>
  );
}

// Colonne latérale de la maquette (2026-11-11). « Paiement protégé » ne promet que ce que la
// plateforme fait réellement : séquestre avant démarrage, libération à la validation, médiation.
function MissionAside({ mission, isOwner, canApply }: { mission: MissionDetail; isOwner: boolean; canApply: boolean }) {
  const deadline = mission.status === "publiee" && mission.dateExpiration ? new Date(mission.dateExpiration) : null;
  return (
    <aside className="space-y-4 lg:sticky lg:top-20">
      <div className="bg-white border border-[#E7E2F0] rounded-3xl p-5">
        <ShieldCheck className="w-6 h-6 text-[#047857]" aria-hidden />
        <h2 className="font-display font-bold text-[17px] text-[#191224] mt-2">Paiement protégé</h2>
        <p className="text-[13px] text-[#6B6478] mt-1">Fonds séquestrés avant démarrage. Libération à la validation de chaque jalon.</p>
        <ul className="mt-3 space-y-2 text-[13px] text-[#191224]">
          <li>✓ Aucun versement sans validation du client</li>
          <li>✓ Médiation en cas de litige</li>
          <li>✓ Contrat signé par les deux parties</li>
        </ul>
      </div>
      {deadline && (
        <div className="rounded-3xl p-5 text-white bg-[#4C1D95]">
          <div className="font-display font-bold text-[16px]">Date limite : {deadline.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
          <p className="text-[13px] text-white/85 mt-1.5">
            {isOwner
              ? "Comparez les candidatures et retenez un prestataire avant cette date."
              : "Les candidatures sont reçues jusqu'à cette date."}
          </p>
          {isOwner ? (
            <Link href={`/missions/${mission.id}/proposals`} className="mt-3 inline-flex px-4 py-2 rounded-full bg-white text-[#4C1D95] text-[13px] font-bold hover:bg-[#F0EAFF]" style={{ textDecoration: "none" }}>
              Comparer les profils
            </Link>
          ) : canApply ? (
            <a href="#candidater" className="mt-3 inline-flex px-4 py-2 rounded-full bg-white text-[#4C1D95] text-[13px] font-bold hover:bg-[#F0EAFF]" style={{ textDecoration: "none" }}>
              Candidater
            </a>
          ) : null}
        </div>
      )}
    </aside>
  );
}
