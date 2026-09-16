"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
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
import { EscrowAccountPanel } from "@/components/escrow/escrow-account-panel";
import { AttendancePanel } from "@/components/spot-time/attendance-panel";
import { getFinancingMode } from "@/lib/financing-modes";
import { RATE_UNIT_LABEL } from "@/lib/spot-time";

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
  client: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null } | null;
  createdAt: string;
  isOwner: boolean;
  professionalType: string | null;
  requiredLevel: string | null;
  budgetType: string | null;
  financingModeKey: string | null;
  timeRate: number | null;
  timeMaxQuantity: number | null;
  tags: string[];
  maxRevisionRounds: number;
  dateExpiration: string | null;
};

const PROFESSIONAL_TYPE_LABEL: Record<string, string> = {
  EXPERT_DIGITAL: "Expert Digital",
  EXPERT_BTP: "Expert BTP / Autres",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

const BUDGET_TYPE_LABEL: Record<string, string> = {
  FIXED: "Prix fixe",
  RATE: "Taux (horaire/journalier)",
  QUOTE: "Demande de devis",
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
  useEffect(() => {
    setRequestedProviderId(new URLSearchParams(window.location.search).get("providerId"));
  }, []);
  const { data: session, status: sessionStatus } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isClient = role === "client";
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
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);
  // Blocage par profil incomplet (garant/assurance manquant) — même mécanisme que
  // src/components/devis/devis-form.tsx (mode QUOTE) : distinct de `applyError`, il
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
    if (!draft) return;
    // Un brouillon enregistré à la main peut n'avoir aucun montant (montant: 0) : le champ
    // reste alors vide, plutôt que d'afficher un « 0 » que le candidat devrait effacer.
    setApplyAmount(draft.montant > 0 ? String(draft.montant) : "");
    setApplyDelay(draft.delaiPropose ? String(draft.delaiPropose) : "");
    setApplyMessage(draft.message);
    setRestoredFromDraft(true);
    setApplying(true);
  }, [myProposal, missionId]);

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
    saveProposalDraft(missionId, { montant, delaiPropose, message });
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
    setApplySubmitting(true);
    setApplyError(null);
    setBlockedByProfile(null);
    const res = await fetch(`/api/missions/${missionId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Au temps, le prix du contrat est le plafond : le serveur le recalcule depuis le tarif, et
      // `montant` n'est envoyé que pour satisfaire le schéma commun.
      body: JSON.stringify(
        timeTerms
          ? { montant: Math.round(montant * timeTerms.maxQuantity), unitRate: montant, delaiPropose, message: applyMessage.trim() || undefined }
          : { montant, delaiPropose, message: applyMessage.trim() || undefined }
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
        saveProposalDraft(missionId, { montant, delaiPropose, message: applyMessage.trim() });
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
      };
      setApplyError(messages[data.error ?? ""] ?? "Échec de l'envoi de la candidature.");
      return;
    }
    clearProposalDraft(missionId);
    setApplyAmount("");
    setApplyDelay("");
    setApplyMessage("");
    // Même comportement que la soumission d'un devis (src/components/devis/devis-form.tsx) :
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

  const loadMyOffer = async () => {
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
  };

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
    await loadMyOffer();
  }

  const loadMyProposal = async () => {
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
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, userId, isClient]);

  useEffect(() => {
    loadMyOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, userId, isClient]);

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

  if (loading) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;
  // Visiteur non connecté : l'API répond 401, la mission reste donc nulle — annoncer
  // « Mission introuvable » désignait alors une cause fausse (la mission existe, c'est la
  // session qui manque) et laissait l'utilisateur sans moyen d'aller plus loin. On l'envoie
  // se connecter, avec retour sur cette mission.
  if (!mission && sessionStatus === "unauthenticated") {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-[13px] text-[#64748B]">Connectez-vous pour consulter cette mission.</p>
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(`/missions/${missionId}`)}`}
          className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center"
          style={{ textDecoration: "none" }}
        >
          Se connecter
        </Link>
      </div>
    );
  }
  if (!mission) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Mission introuvable.</div>;

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
      const name = [mission.client.firstname, mission.client.lastname].filter(Boolean).join(" ") || "Client";
      interlocutor = { id: mission.client.id, name, avatarPath: mission.client.avatarPath };
    }
  } else if (mission.isOwner && proposals) {
    const targeted = requestedProviderId ? proposals.find((p) => p.provider.id === requestedProviderId) : null;
    const candidate = targeted ?? (proposals.length === 1 ? proposals[0] : null);
    if (candidate && isProposalEngaged(candidate.status)) {
      const name = [candidate.provider.firstname, candidate.provider.lastname].filter(Boolean).join(" ") || "Prestataire";
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
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[900px] mx-auto px-4 lg:px-0 pb-[110px] lg:pb-10 pt-5 space-y-4">
        {/* Bandeau d'évolution de la mission — synchronisé sur le statut réel (client +
            prestataire), voir mission-tracker.tsx */}
        <MissionTracker missionId={mission.id} />

        {/* Fil d'Ariane */}
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={missionsHref} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Missions</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">{mission.titre}</span>
        </div>

        {/* En-tête */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[16px] lg:text-[18px] font-bold tracking-tight">{mission.titre}</h1>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${st.bg} ${st.text} text-[11px] font-semibold tracking-wide`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {st.label.toUpperCase()}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[12px] text-[#94A3B8]">
                Publiée le {new Date(mission.createdAt).toLocaleDateString("fr-FR")}
                {mission.isOwner && proposalsCount !== null && (
                  <span>• {proposalsCount} candidature{proposalsCount > 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#64748B]">
              <span className="px-2 py-1 rounded-md bg-[#F8FAF9] border border-[#E2E8F0]">ID #{mission.id.slice(-8).toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* Stat grid — Budget / Délai / Risque */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#F1F5F9]">
            <div className="py-3 sm:py-1 sm:px-4 first:pl-0">
              <div className="text-[11px] font-semibold tracking-widest text-[#64748B] uppercase mb-1">Budget</div>
              <div className="text-[22px] font-bold text-[#008751] leading-none">
                {(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} <span className="text-[13px] font-semibold">{mission.currency}</span>
              </div>
              {/* Dès qu'une proposition est acceptée (contrat généré), le montant affiché est le
                  prix CONVENU (montant de la contre-proposition acceptée, figé au contrat), pas le
                  budget initialement publié — synchronisé sur le statut de la mission. */}
              <div className="text-[11px] text-[#94A3B8] mt-1">
                {mission.contractPrice
                  ? "Prix convenu (contrat)"
                  : timeTermsOf(mission) && mission.timeRate
                    ? `Plafond — ${mission.timeRate.toLocaleString("fr-FR")} / ${timeTermsOf(mission)!.unit.one} × ${timeTermsOf(mission)!.maxQuantity}`
                    : mission.budgetType === "QUOTE" ? "Budget indicatif" : "Budget publié"}
              </div>
            </div>
            <div className="py-3 sm:py-1 sm:px-6">
              <div className="text-[11px] font-semibold tracking-widest text-[#64748B] uppercase mb-1">Délai</div>
              <div className="text-[22px] font-bold text-[#008751] leading-none">
                {mission.contractDelaiJours ?? mission.delaiJours} <span className="text-[14px] font-semibold">jour{(mission.contractDelaiJours ?? mission.delaiJours) > 1 ? "s" : ""}</span>
              </div>
              <div className="text-[11px] text-[#94A3B8] mt-1">{mission.contractDelaiJours ? "Délai convenu (contrat)" : "Délai souhaité"}</div>
            </div>
            <div className="py-3 sm:py-1 sm:px-6 last:pr-0">
              <div className="text-[11px] font-semibold tracking-widest text-[#64748B] uppercase mb-1">Risque</div>
              <div className={`inline-flex mt-1 px-2.5 py-1 rounded-full text-[11px] font-bold border items-center gap-1.5 ${mission.riskLevel === "high" ? "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]" : mission.riskLevel === "medium" ? "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]" : "bg-[#E6F4EE] text-[#008751] border-[#A7F3D0]"}`}>
                {mission.riskLevel?.toUpperCase?.()}
              </div>
              {mission.insuranceRequired && <div className="text-[11px] text-[#B91C1C] mt-2">Assurance obligatoire</div>}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Description mission</h3>
          <p className="text-[13px] leading-[1.6] text-[#475569] whitespace-pre-wrap">{mission.description}</p>
          <div className="mt-4 space-y-2.5 text-[13px]">
            <div className="flex gap-2"><span className="font-semibold min-w-[110px] text-[#0f172a]">Domaine :</span><span className="text-[#475569]">{mission.domaine}</span></div>
            {mission.professionalType && (
              <div className="flex gap-2"><span className="font-semibold min-w-[110px] text-[#0f172a]">Recherché :</span><span className="text-[#475569]">{PROFESSIONAL_TYPE_LABEL[mission.professionalType] ?? mission.professionalType}{mission.requiredLevel ? ` — Niveau ${mission.requiredLevel}` : ""}</span></div>
            )}
            {mission.budgetType && (
              <div className="flex gap-2"><span className="font-semibold min-w-[110px] text-[#0f172a]">Rémunération :</span><span className="text-[#475569]">{BUDGET_TYPE_LABEL[mission.budgetType] ?? mission.budgetType}</span></div>
            )}
            {/* Le mode retenu par le client à la publication fait partie des conditions de la
                mission au même titre que la rémunération — il décide de QUAND le prestataire
                est payé. Les missions publiées avant son introduction n'en ont pas : rien ne
                s'affiche alors, plutôt qu'un régime par défaut inventé. */}
            {getFinancingMode(mission.financingModeKey ?? "") && (
              <div className="flex gap-2"><span className="font-semibold min-w-[110px] text-[#0f172a]">Financement :</span><span className="text-[#475569]">{getFinancingMode(mission.financingModeKey ?? "")!.label}</span></div>
            )}
          </div>
          {mission.tags && mission.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {mission.tags.map((tag) => (
                <span key={tag} className="inline-flex px-2.5 py-1 rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] text-[11px] font-medium">{tag}</span>
              ))}
            </div>
          )}
        </div>

        {/* Mode devis (QUOTE) */}
        {mission.budgetType === "QUOTE" && !mission.isOwner && !isClient && (myProposal === undefined ? (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <p className="text-[13px] text-[#64748B]">Chargement de votre candidature...</p>
          </div>
        ) : (
          <>
          <FinancingModeNotice modeKey={mission.financingModeKey} quoteMode />
          <DevisPanel
            missionId={mission.id}
            maxRounds={mission.maxRevisionRounds ?? 3}
            proposal={myProposal}
            isClient={false}
            canSubmit={mission.status === "publiee"}
            onChanged={loadMyProposal}
            currency={mission.currency}
          />
          </>
        ))}

        {/* Candidater à prix fixe/taux (hors mode QUOTE) — pendant du bloc DevisPanel
            ci-dessus pour le mode devis. N'apparaît que si aucune candidature n'existe
            encore (myProposal === null) et que la mission accepte des candidatures. */}
        {mission.budgetType !== "QUOTE" && !mission.isOwner && !isClient && myProposal === null && mission.status === "publiee" && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <h3 className="text-[13px] font-semibold mb-2">Candidater à cette mission</h3>

            {/* quoteMode={false} : hors mode devis il n'y a aucune ligne à dériver en jalons —
                la consigne le dit explicitement au lieu de promettre un découpage que le
                montant unique saisi ici ne décidera pas (voir providerBrief). */}
            <FinancingModeNotice modeKey={mission.financingModeKey} quoteMode={false} className="mb-3" />

            {restoredFromDraft && !blockedByProfile && (
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
                <p className="text-[13px] text-[#64748B] mb-3">Proposez votre prix pour cette mission.</p>
                <button onClick={() => setApplying(true)} className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49]">
                  Candidater
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] font-medium text-[#475569] mb-1">
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
                    className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                  />
                  {timeTermsOf(mission) && (
                    <p className="text-[11px] text-[#64748B] mt-1 tabular-nums">
                      {Number(applyAmount) > 0
                        ? `Plafond du contrat : ${Math.round(Number(applyAmount) * timeTermsOf(mission)!.maxQuantity).toLocaleString("fr-FR")} ${mission.currency} (${timeTermsOf(mission)!.maxQuantity} ${timeTermsOf(mission)!.unit.many} maximum). Seul le temps constaté vous sera versé.`
                        : `Mission au temps : ${timeTermsOf(mission)!.maxQuantity} ${timeTermsOf(mission)!.unit.many} maximum. Le client séquestre le plafond avant le démarrage.`}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#475569] mb-1">Votre délai (en jours) — optionnel</label>
                  <input
                    type="number"
                    min={1}
                    value={applyDelay}
                    onChange={(e) => { setApplyDelay(e.target.value); setDraftSavedMsg(null); }}
                    placeholder={mission.delaiJours ? String(mission.delaiJours) : "Ex: 30"}
                    className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                  />
                  <p className="text-[11px] text-[#94A3B8] mt-1">
                    Sans indication, le délai de la mission ({mission.delaiJours} jours) s&apos;appliquera au contrat.
                  </p>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#475569] mb-1">Message (optionnel)</label>
                  <textarea
                    value={applyMessage}
                    onChange={(e) => { setApplyMessage(e.target.value.slice(0, 2000)); setDraftSavedMsg(null); }}
                    rows={3}
                    placeholder="Présentez-vous, votre expérience, votre disponibilité..."
                    className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                  />
                </div>
                {applySuccessMsg && <p className="text-[12px] text-emerald-700">{applySuccessMsg}</p>}
                {draftSavedMsg && !applySuccessMsg && <p className="text-[12px] text-emerald-700">{draftSavedMsg}</p>}
                {applyError && <p className="text-[12px] text-red-600">{applyError}</p>}
                <div className="flex flex-wrap gap-2">
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={submitProposal} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] disabled:opacity-50">
                    {applySubmitting ? "Envoi..." : "Envoyer ma candidature"}
                  </button>
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={saveProposalDraftNow} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50">
                    Enregistrer brouillon
                  </button>
                  <button disabled={applySubmitting || !!applySuccessMsg} onClick={() => { setApplying(false); setApplyError(null); }} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
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
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Offre reçue</h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">
                {OFFER_STATUS_LABEL[myOffer.status] ?? myOffer.status}
              </span>
            </div>
            <p className="mt-3 text-[13px] font-semibold text-[#0f172a]">{myOffer.titre}</p>
            <div className="mt-2 flex items-center justify-between text-[13px]">
              <span className="text-[#64748B]">Montant proposé</span>
              <strong className="font-fraunces text-[#008751] text-[16px]">{myOffer.montant.toLocaleString("fr-FR")} {myOffer.currency}</strong>
            </div>
            {myOffer.description && <p className="mt-2 text-[13px] text-[#475569] leading-relaxed">{myOffer.description}</p>}
            <p className="mt-2 text-[11px] text-[#94A3B8]">Envoyée le {new Date(myOffer.sentAt ?? myOffer.createdAt).toLocaleDateString("fr-FR")}</p>
            {offerRespondError && <div className="mt-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-2.5 text-[12px] text-[#B91C1C]">{offerRespondError}</div>}
            {myOffer.status === "envoyee" && (
              <div className="flex gap-2 mt-3">
                <button disabled={respondingOffer} onClick={() => respondToOffer("accept")} className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] disabled:opacity-50">
                  {respondingOffer ? "…" : "Accepter l'offre"}
                </button>
                <button disabled={respondingOffer} onClick={() => respondToOffer("decline")} className="h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50">
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
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold flex items-center gap-2">Pièces jointes</h3>

          {attachError && <div className="mt-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2.5 text-[12px] text-[#92400E]">{attachError}</div>}

          {attachments === null ? (
            <p className="mt-3 text-[13px] text-[#64748B]">Chargement...</p>
          ) : attachments.length === 0 ? (
            <div className="mt-4 flex gap-3 p-3 rounded-xl bg-[#F8FAF9] border border-dashed border-[#E2E8F0]">
              <div className="w-9 h-9 rounded-lg bg-white border border-[#E2E8F0] flex items-center justify-center shrink-0 text-[#94A3B8]">📄</div>
              <div className="text-[13px] font-medium text-[#475569]">Aucune pièce jointe pour l&apos;instant.</div>
            </div>
          ) : (
            <ul className="mt-3 space-y-0 divide-y divide-[#F1F5F9]">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2.5 gap-3">
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-[#008751] text-[13px] font-semibold" style={{ textDecoration: "none" }}>
                    {a.fileName ?? "Fichier"}
                  </a>
                  <span className="text-[#94A3B8] text-[11px] shrink-0">{a.uploaderEmail ?? "?"} · {new Date(a.createdAt).toLocaleDateString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          )}

          {canUploadAttachment ? (
            <div className="mt-4">
              <label className="inline-flex h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium items-center cursor-pointer hover:bg-[#F8FAF9]">
                {uploadingAttachment ? "Envoi..." : "+ Joindre un fichier"}
                <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleAttachmentUpload} disabled={uploadingAttachment} style={{ display: "none" }} />
              </label>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[#94A3B8] italic flex items-start gap-1.5">
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
            {mission.isOwner && mission.status === "publiee" && (
              <Link href={`/missions/${mission.id}/proposals`} className="inline-flex h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium items-center hover:bg-[#F8FAF9]" style={{ textDecoration: "none" }}>
                {mission.budgetType === "QUOTE" ? "Voir les devis reçus" : "Voir les propositions"}
              </Link>
            )}
            {mission.status !== "brouillon" && mission.status !== "publiee" && (
              <Link href={`/missions/${mission.id}/contract`} className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49]" style={{ textDecoration: "none" }}>
                Voir le contrat
              </Link>
            )}
            {DELIVERABLE_ACTIVE_STATUSES.has(mission.status) && !mission.isOwner && (
              <Link href={`/missions/${mission.id}/deliverable`} className="inline-flex h-10 px-5 rounded-lg bg-[#0f172a] text-white text-[13px] font-semibold items-center hover:bg-black" style={{ textDecoration: "none" }}>
                Soumettre le livrable
              </Link>
            )}
            {ESCROW_ACTIVE_STATUSES.has(mission.status) && mission.isOwner && (
              <Link href={`/missions/${mission.id}/escrow`} className="inline-flex h-10 px-5 rounded-lg bg-[#0f172a] text-white text-[13px] font-semibold items-center hover:bg-black" style={{ textDecoration: "none" }}>
                Paiement sous séquestre
              </Link>
            )}
            {mission.status === "cloturee" && (
              <Link href={`/missions/${mission.id}/reviews`} className="inline-flex h-10 px-5 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium items-center hover:bg-[#F8FAF9]" style={{ textDecoration: "none" }}>
                Donner un avis
              </Link>
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          <Link href={backHref} className="text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
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
              className="flex items-center justify-center gap-2 h-12 w-full rounded-xl bg-[#0f172a] text-white text-[13px] font-semibold hover:bg-black transition-colors"
              style={{ textDecoration: "none" }}
            >
              Accéder au pilotage de la mission →
            </Link>
          </div>
        )}
      </div>

      {/* Barre d'action fixe — mobile uniquement */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E2E8F0] p-3 z-40" style={{ boxShadow: "0 -8px 24px rgba(15,23,42,0.06)" }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#64748B] font-semibold">{mission.budgetType === "QUOTE" ? "Devis" : "Budget"}</div>
            <div className="text-[18px] font-bold text-[#008751] leading-none mt-0.5">
              {highlightAmount.toLocaleString("fr-FR")} <span className="text-[12px] font-semibold">{mission.currency}</span>
            </div>
          </div>
          <Link href={backHref} className="h-11 px-6 rounded-xl border border-[#E2E8F0] text-[#64748B] text-[13px] font-medium inline-flex items-center" style={{ textDecoration: "none" }}>
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
        />
      )}
    </div>
  );
}
