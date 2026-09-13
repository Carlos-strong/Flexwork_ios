"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import DashboardLayout, { providerNav, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { useUserIdentity } from "@/components/user-identity";
import { providerUrl } from "@/lib/provider-urls";
import { Avatar } from "@/components/avatar";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import { RISK_BADGE } from "@/components/dashboard/types";
import { canProviderReviseDevis } from "@/lib/devis";
import type { DevisLineItemInput } from "@/lib/devis";
import { computeDevisData } from "@/lib/devis";
import { saveDevisDraft, loadDevisDraft, clearDevisDraft, restorableDateDebut } from "@/lib/devis-draft";
import { candidaturesHrefForRole, type Role } from "@/lib/role-dashboard";
import type { DevisProposalPayload } from "@/components/devis/types";
import { countryFlag } from "@/components/person-card";
import { FinancingModeNotice } from "@/components/financing/financing-mode-notice";

// Reproduction fidèle de la maquette Offre-Candidature-Vjr — seule la barre de navigation de gauche
// change (vraie sidebar prestataire, DashboardLayout, au lieu de celle fictive de la
// maquette). Toute la logique de soumission (jalons, calcul HT/TVA/TTC, brouillon local,
// blocage garant/assurance) reprend exactement celle de DevisForm — reskin, pas réécriture.
// Voir /Users/apple/.claude/plans/binary-giggling-puffin.md pour le détail des écarts
// assumés (pas de fabrication de données absentes du modèle).

type MissionDetail = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  currency: string;
  status: string;
  budgetType: string | null;
  financingModeKey: string | null;
  professionalType: string | null;
  requiredLevel: string | null;
  tags: string[];
  mode: string;
  riskLevel: string;
  maxRevisionRounds: number;
  dateExpiration: string | null;
  createdAt: string;
  isOwner: boolean;
  client: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null; country: string | null } | null;
  clientStats: { averageRating: number | null; missionsCompleted: number; memberSince: string | null; kycVerified: boolean };
  _count: { proposals: number };
};

type AttachmentItem = { id: string; fileName: string | null; uploaderEmail: string | null; createdAt: string; url: string };

type EditableItem = DevisLineItemInput & { id: string };

const UNITS = ["forfait", "m2", "ml", "u", "h", "jour"];
const DELAY_PRESETS = ["14 jours (2 semaines)", "21 jours (3 semaines)", "28 jours (4 semaines)"];

const PROFESSIONAL_TYPE_LABEL: Record<string, string> = {
  EXPERT_DIGITAL: "Expert Digital",
  EXPERT_BTP: "Expert BTP / Autres",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

const FALLBACK_USER: DashboardUser = { initials: "PR", name: "Prestataire", role: "Prestataire", avatarGradient: "from-[#FF7A00] to-[#E8112D]" };

/**
 * Formate une date de champ `<input type="date">` (`yyyy-mm-dd`) en `jj/mm/aaaa`, PAR DÉCOUPAGE
 * DE CHAÎNE et jamais via `new Date(...)`.
 *
 * `new Date("2026-09-16")` est parsé comme un instant UTC puis rendu dans le fuseau local :
 * sous tout fuseau négatif, `toLocaleDateString("fr-FR")` affiche la VEILLE (« 15/09/2026 »).
 * Une date de calendrier saisie à la main n'a pas d'heure ni de fuseau — la convertir en
 * instant est une erreur de nature, pas un défaut d'affichage. Et le décalage ne restait pas
 * cosmétique : la chaîne fautive était concaténée aux `notes` du devis, donc ENREGISTRÉE en
 * base et relue telle quelle par le client.
 */
function formatDateSaisie(value: string): string {
  const [annee, mois, jour] = value.split("-");
  return annee && mois && jour ? `${jour}/${mois}/${annee}` : value;
}

export default function OffreCandidaturePage() {
  const params = useParams();
  const missionId = params.id as string;
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: Role } | undefined)?.role;
  const isClient = role === "client";
  const badgeCounts = useSidebarBadges("prestataire");

  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), PAS
  // à chaque montage. Photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity ? { ...FALLBACK_USER, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id } : { ...FALLBACK_USER, avatarUrl: null, id: userId };

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [myProposal, setMyProposal] = useState<DevisProposalPayload | null | undefined>(undefined);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then(setMission).finally(() => setLoading(false));
    fetchDedupe(`/api/missions/${missionId}/my-proposal`).then((r) => (r.ok ? r.json() : null)).then(setMyProposal).catch(() => setMyProposal(null));
    fetchDedupe(`/api/missions/${missionId}/attachments`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setAttachments(d.items ?? [])).catch(() => {});
  }, [missionId]);

  // Accès réservé au prestataire, sur une mission en mode devis, avec le droit de
  // soumettre/réviser — mêmes gardes que canProviderReviseDevis (DevisPanel), pas de
  // duplication de règle. Redirection silencieuse vers le détail de la mission sinon.
  useEffect(() => {
    if (sessionStatus === "unauthenticated") { router.push("/signin"); return; }
    if (!mission || myProposal === undefined) return;
    if (isClient || mission.budgetType !== "QUOTE") { router.push(`/missions/${missionId}`); return; }
    const allowed = canProviderReviseDevis({ hasDevis: !!myProposal?.devisData, revisionRequested: !!myProposal?.revisionRequestedAt });
    if (!allowed) router.push(`/missions/${missionId}`);
  }, [sessionStatus, mission, myProposal, isClient, missionId, router]);

  // ── État du formulaire (mêmes champs/logique que DevisForm, reskinnés) ──
  const devis = myProposal?.devisData ?? null;
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const [delay, setDelay] = useState<string | null>(null);
  const [dateDebut, setDateDebut] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [tvaRate, setTvaRate] = useState(0);
  const [laborCost, setLaborCost] = useState(0);
  const [priceMode, setPriceMode] = useState<"fixe" | "horaire">("fixe"); // cosmétique — aucune donnée/calcul distinct n'existe pour ces 2 modes
  const [highlightProfile, setHighlightProfile] = useState(false); // cosmétique — aucun effet réel
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [blockedByProfile, setBlockedByProfile] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // Date de début du brouillon écartée car déjà passée — sert l'avertissement, effacé dès que
  // le prestataire en saisit une nouvelle.
  const [expiredDateDebut, setExpiredDateDebut] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Échap ferme l'aperçu, comme n'importe quelle modale de l'application (la modale de
  // validation client le gère déjà) : seul le clic sur le fond fonctionnait ici, ce qui
  // laisse sans issue au clavier.
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);
  // Bascule d'onglets mobile (Détails/Devis/Client) — sur lg: et plus, les 3 sections restent
  // toujours affichées (mise en page 2 colonnes) ; en dessous, une seule à la fois pour
  // éviter un défilement interminable sur petit écran.
  const [mobileTab, setMobileTab] = useState<"details" | "devis" | "client">("details");

  // Initialise le formulaire une fois myProposal connu (devis existant = révision, sinon
  // brouillon local éventuel, sinon 1 ligne vide) — équivalent de l'initialiseur de DevisForm.
  useEffect(() => {
    if (myProposal === undefined || items !== null) return;
    if (devis?.lineItems?.length) {
      setItems(devis.lineItems.map((i, idx) => ({ id: String(idx), description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, echeance: i.echeance })));
      setDelay(devis.delay);
      setMessage(devis.notes);
      setTvaRate(devis.tvaRate);
      setLaborCost(devis.laborCost);
      return;
    }
    const draft = loadDevisDraft(missionId);
    if (draft) {
      setItems(draft.lineItems.map((i, idx) => ({ id: String(idx), ...i })));
      setDelay(draft.delay);
      // Règle et motif dans restorableDateDebut : une date déjà passée n'est pas restaurée,
      // et le prestataire doit alors en choisir une nouvelle AVANT de pouvoir soumettre —
      // d'où l'avertissement dédié plutôt qu'un champ silencieusement vide.
      const dateFromDraft = restorableDateDebut(draft);
      setDateDebut(dateFromDraft.value);
      if (dateFromDraft.expired) setExpiredDateDebut(dateFromDraft.expiredValue ?? null);
      setMessage(draft.notes);
      setTvaRate(draft.tvaRate);
      setLaborCost(draft.laborCost);
      setRestoredFromDraft(true);
      return;
    }
    setItems([{ id: "1", description: "", quantity: 1, unit: "forfait", unitPrice: 0 }]);
    setDelay(DELAY_PRESETS[0]);
    setMessage("");
  }, [myProposal, devis, missionId, items]);

  const totals = items ? computeDevisData(items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, echeance: i.echeance })), delay ?? "", message ?? "", tvaRate, laborCost) : null;

  function addItem() {
    setItems((prev) => [...(prev ?? []), { id: crypto.randomUUID(), description: "", quantity: 1, unit: "forfait", unitPrice: 0 }]);
  }
  function updateItem(id: string, patch: Partial<EditableItem>) {
    setItems((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function moveItem(idx: number, dir: -1 | 1) {
    setItems((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function confirmDelete() {
    if (!deleteId) return;
    setItems((prev) => ((prev?.length ?? 0) > 1 ? (prev ?? []).filter((i) => i.id !== deleteId) : prev));
    setDeleteId(null);
  }

  const validItems = (items ?? []).every((i) => i.description.trim() && i.unitPrice > 0);
  const messageValid = (message ?? "").trim().length >= 20;
  const canSubmitForm = validItems && !!delay?.trim() && !!dateDebut && messageValid;

  async function submit() {
    if (!items || !delay) return;
    if (!validItems) { setFeedback({ ok: false, msg: "Vérifiez les jalons (description + prix unitaire > 0)." }); return; }
    if (!dateDebut) { setFeedback({ ok: false, msg: "Indiquez une date de début souhaitée." }); return; }
    if (!messageValid) { setFeedback({ ok: false, msg: "Le message au client doit contenir au moins 20 caractères." }); return; }

    // La date de début n'a pas de champ dédié côté serveur (devisSchema) — plutôt que de
    // l'inventer silencieusement, elle est intégrée au vrai message envoyé au client
    // (`notes`), qui la verra donc réellement, sans fabriquer de structure de donnée.
    const notesWithStartDate = `Date de début souhaitée : ${formatDateSaisie(dateDebut)}\n\n${(message ?? "").trim()}`;
    const lineItemsPayload = items.map((i) => ({ description: i.description.trim(), quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, echeance: i.echeance?.trim() || undefined }));

    setPending(true);
    setFeedback(null);
    setBlockedByProfile(null);
    const res = await fetch(`/api/missions/${missionId}/devis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineItems: lineItemsPayload, delay: delay.trim(), notes: notesWithStartDate, tvaRate: Number(tvaRate) || 0, laborCost: Number(laborCost) || 0 }),
    });
    setPending(false);

    if (res.ok) {
      clearDevisDraft(missionId);
      setFeedback({ ok: true, msg: "Devis soumis — redirection vers vos candidatures..." });
      setTimeout(() => router.push(candidaturesHrefForRole(role)), 1200);
      return;
    }
    const d = await res.json().catch(() => ({}));
    if (d.error === "garant_required" || d.error === "insurance_required") {
      saveDevisDraft(missionId, { lineItems: lineItemsPayload, delay: delay.trim(), dateDebut, notes: message ?? "", tvaRate: Number(tvaRate) || 0, laborCost: Number(laborCost) || 0 });
      setBlockedByProfile(d.message ?? "Votre profil doit être complété avant de candidater à cette mission.");
      return;
    }
    setFeedback({ ok: false, msg: d.message ?? d.error ?? "Échec de la soumission." });
  }

  function saveDraftNow() {
    if (!items || !delay) return;
    saveDevisDraft(missionId, {
      lineItems: items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, echeance: i.echeance })),
      delay,
      dateDebut,
      notes: message ?? "",
      tvaRate,
      laborCost,
    });
    setFeedback({ ok: true, msg: "Brouillon enregistré sur cet appareil." });
  }

  if (loading || !mission || items === null || totals === null) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#008751] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const st = MISSION_STATUS_STYLE[mission.status as keyof typeof MISSION_STATUS_STYLE] ?? MISSION_STATUS_STYLE.brouillon;
  const risk = RISK_BADGE[mission.riskLevel] ?? RISK_BADGE.low;
  const clientName = mission.client ? [mission.client.firstname, mission.client.lastname].filter(Boolean).join(" ") || "Client" : "Client";
  const clientInitials = clientName.split(" ").slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";

  return (
    <DashboardLayout
      mode="prestataire"
      user={user}
      navItems={providerNav(role ?? "expert_digital")}
      // Cette page sert deux parcours sous la même URL : candidater à une mission ouverte
      // (venu de « Missions disponibles », pas encore de proposition → "missions") ou réviser
      // un devis déjà soumis (venu de « Mes candidatures » ou du bloc Documents Contractuels
      // en négociation, myProposal déjà chargé → "candidatures"). Auparavant "missions" restait
      // actif dans ce 2ᵉ cas, déplaçant à tort le bandeau hors de sa rubrique d'origine
      // (signalé 2026-09-04, même cause que /missions/[id]/proposals — voir MissionPageShell).
      activeNav={myProposal ? "candidatures" : "missions"}
      onNavChange={(id) => router.push(providerUrl(role ?? "expert_digital", id))}
      badgeCounts={badgeCounts}
      title="Offre de candidature"
    >
      <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-6 pb-[96px] lg:pb-0">
        <main className="flex-1 min-w-0">
          {/* Fil d'Ariane */}
          <div className="flex items-center gap-1.5 text-[13px] text-[#64748B] mb-4 flex-wrap">
            <Link href={providerUrl(role ?? "expert_digital", "missions")} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Missions</Link>
            <span>›</span>
            <span className="hover:text-[#0f172a]">{mission.domaine}</span>
            <span>›</span>
            <span className="text-[#0f172a] font-medium">{mission.titre}</span>
          </div>

          {/* En-tête mission */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 lg:p-6 mb-6">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${st.bg} ${st.text} text-[11px] font-bold tracking-wide`}>
                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} /> {st.label.toUpperCase()}
              </span>
              <span className="inline-flex px-2.5 py-1 rounded-full bg-[#F3E8FF] text-[#7C3AED] text-[11px] font-semibold">Mode Devis</span>
              {mission.dateExpiration && (
                <span className="inline-flex px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">
                  Expiration {new Date(mission.dateExpiration).toLocaleDateString("fr-FR")}
                </span>
              )}
            </div>
            <h1 className="text-[22px] lg:text-[26px] font-bold leading-tight tracking-tight mb-3">{mission.titre}</h1>
            <div className="flex flex-wrap items-center gap-4 text-[13px] text-[#64748B]">
              <span>Publié le {new Date(mission.createdAt).toLocaleDateString("fr-FR")}</span>
              <span>{mission._count.proposals} candidature{mission._count.proposals > 1 ? "s" : ""}</span>
              <span>Réf {mission.id.slice(-8).toUpperCase()}</span>
            </div>
          </div>

          {/* Bascule d'onglets — mobile uniquement */}
          <div className="lg:hidden flex gap-1 p-1 bg-white border border-[#E2E8F0] rounded-xl mb-4">
            {([
              ["details", "Détails"],
              ["devis", "Devis"],
              ["client", "Client"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMobileTab(id)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${mobileTab === id ? "bg-[#0f172a] text-white" : "text-[#64748B]"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={mobileTab === "details" ? "block" : "hidden lg:block"}>
          {/* Contexte client */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 lg:p-6 mb-6">
            <h2 className="text-[14px] font-semibold tracking-tight mb-3">Contexte client</h2>
            <p className="text-[13.5px] leading-6 text-[#334155] mb-4 whitespace-pre-wrap">{mission.description}</p>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {attachments.map((a) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] text-[12px]" style={{ textDecoration: "none", color: "inherit" }}>
                    <span className="font-medium">{a.fileName ?? "Fichier"}</span>
                  </a>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0]">
                <div className="text-[11px] text-[#64748B] uppercase tracking-wide font-semibold">Domaine</div>
                <div className="text-[14px] font-semibold mt-1">{mission.domaine}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0]">
                <div className="text-[11px] text-[#64748B] uppercase tracking-wide font-semibold">Négociation</div>
                <div className="text-[14px] font-semibold mt-1">{mission.maxRevisionRounds} rounds max</div>
              </div>
              <div className="p-3 rounded-lg bg-[#FEFCE8] border border-[#FDE68A]">
                <div className="text-[11px] text-[#92400E] uppercase tracking-wide font-semibold">Échéance offre</div>
                <div className="text-[14px] font-semibold mt-1 text-[#92400E]">{mission.dateExpiration ? new Date(mission.dateExpiration).toLocaleDateString("fr-FR") : "Non communiquée"}</div>
              </div>
            </div>
          </div>

          {/* Détails réels de la mission (remplace la carte "Détails BTP" fabriquée de la maquette) */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 lg:p-6 mb-6">
            <h2 className="text-[14px] font-semibold tracking-tight mb-4">Détails de la mission</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-[13px]">
              <div>
                <div className="text-[#64748B] text-[11px] uppercase font-semibold tracking-wide">Profil recherché</div>
                <div className="font-medium mt-1">{mission.professionalType ? (PROFESSIONAL_TYPE_LABEL[mission.professionalType] ?? mission.professionalType) : "Non spécifié"}{mission.requiredLevel ? ` — ${mission.requiredLevel}` : ""}</div>
              </div>
              <div>
                <div className="text-[#64748B] text-[11px] uppercase font-semibold tracking-wide">Mode</div>
                <div className="font-medium mt-1 capitalize">{mission.mode}</div>
              </div>
              <div>
                <div className="text-[#64748B] text-[11px] uppercase font-semibold tracking-wide">Palier de risque</div>
                <div className="mt-1"><span className={`inline-flex px-2 py-0.5 rounded-full text-[12px] font-semibold ${risk.bg} ${risk.text}`}>{risk.label}</span></div>
              </div>
              {mission.tags.length > 0 && (
                <div className="col-span-2 lg:col-span-3">
                  <div className="text-[#64748B] text-[11px] uppercase font-semibold tracking-wide mb-1.5">Compétences</div>
                  <div className="flex flex-wrap gap-1.5">
                    {mission.tags.map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-full bg-[#F8FAF9] border border-[#E2E8F0] text-[12px]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>

          <div className={mobileTab === "devis" ? "block" : "hidden lg:block"}>
          {/* Devis à soumettre */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 lg:p-6 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
              <h2 className="text-[15px] font-semibold tracking-tight">Devis à soumettre</h2>
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-lg bg-[#F1F5F9] border border-[#E2E8F0] flex">
                  <button onClick={() => setPriceMode("fixe")} className={`px-3 h-7 rounded-md text-[12px] font-medium transition ${priceMode === "fixe" ? "bg-white shadow-sm border border-[#E2E8F0] text-[#0f172a]" : "text-[#64748B]"}`}>Prix fixe</button>
                  <button onClick={() => setPriceMode("horaire")} className={`px-3 h-7 rounded-md text-[12px] font-medium transition ${priceMode === "horaire" ? "bg-white shadow-sm border border-[#E2E8F0] text-[#0f172a]" : "text-[#64748B]"}`}>Taux horaire</button>
                </div>
                <button onClick={() => setPreviewOpen(true)} className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-medium hover:bg-[#F8FAF9]">Aperçu</button>
              </div>
            </div>

            {restoredFromDraft && !blockedByProfile && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 mb-4">
                Brouillon restauré — reprenez votre devis là où vous l&apos;aviez laissé.
              </div>
            )}
            {blockedByProfile && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-2 mb-4">
                <p className="font-semibold">{blockedByProfile}</p>
                <p>Votre devis a été enregistré comme brouillon sur cet appareil — complétez votre profil, puis revenez ici.</p>
                <Link href={`/profile?returnTo=${encodeURIComponent(`/missions/${missionId}/devis`)}`} className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700" style={{ textDecoration: "none" }}>
                  Compléter mon profil
                </Link>
              </div>
            )}

            {/* Le mode dicte ce que doit être une ligne : en J1 une ligne = un jalon payé
                séparément, en F3 le découpage n'a aucun effet sur le paiement. À lire AVANT
                de remplir le tableau, donc juste au-dessus de lui. */}
            <FinancingModeNotice modeKey={mission.financingModeKey} quoteMode className="mb-4" />

            {/* Demande de révision du client — affichée ICI, sur le formulaire où le prestataire
                rédige la nouvelle version. Elle n'existait que dans la cloche et l'e-mail, alors
                que le bouton « Voir » de la liste des devis mène directement à cette page : le
                prestataire arrivait devant le tableau sans la consigne à laquelle il doit
                répondre. Le round en cours est rappelé, la demande valant pour celui-ci. */}
            {myProposal?.revisionRequestedAt && (
              <div className="mb-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
                <div className="text-[12px] font-semibold text-[#92400E]">
                  Révision demandée par le client
                  {typeof myProposal.roundActuel === "number" && ` — round ${myProposal.roundActuel + 1}`}
                </div>
                <p className="text-[12.5px] text-[#92400E] mt-1 leading-relaxed whitespace-pre-wrap">
                  {myProposal.revisionRequestMessage?.trim()
                    ? `« ${myProposal.revisionRequestMessage.trim()} »`
                    : "Aucune précision n'a été jointe à la demande — ajustez votre devis puis resoumettez-le."}
                </p>
              </div>
            )}

            <div className="hidden lg:block w-full overflow-x-auto border border-[#E2E8F0] rounded-xl">
              <div className="min-w-[760px]">
                <table className="w-full text-[13px]">
                  <thead className="bg-[#F8FAF9] text-[11px] uppercase tracking-wide font-semibold text-[#64748B] border-b border-[#E2E8F0]">
                    <tr>
                      <th className="text-left px-4 py-2.5 w-[56px]">#</th>
                      <th className="text-left px-3 py-2.5">Description</th>
                      <th className="text-center px-2 py-2.5 w-[72px]">Qté</th>
                      <th className="text-center px-2 py-2.5 w-[90px]">Unité</th>
                      <th className="text-right px-2 py-2.5 w-[110px]">PU HT</th>
                      <th className="text-right px-3 py-2.5 w-[110px]">Montant</th>
                      <th className="text-center px-2 py-2.5 w-[110px]">Échéance</th>
                      <th className="w-[84px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.id} className="border-b border-[#F1F5F9] hover:bg-[#FBFDFC] group">
                        <td className="px-4 py-2.5 font-mono text-[12px] font-semibold">{String(idx + 1).padStart(2, "0")}</td>
                        <td className="px-3 py-2">
                          <input
                            value={item.description}
                            onChange={(e) => updateItem(item.id, { description: e.target.value })}
                            placeholder="Description du jalon..."
                            className={`w-full h-8 px-2 rounded-md border text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] ${!item.description.trim() ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E2E8F0] bg-white"}`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: Math.max(1, Number(e.target.value)) })} className="w-full h-8 text-center rounded-md border border-[#E2E8F0] bg-white text-[12.5px] focus:outline-none focus:border-[#008751]" />
                        </td>
                        <td className="px-2 py-2">
                          <select value={item.unit} onChange={(e) => updateItem(item.id, { unit: e.target.value })} className="w-full h-8 rounded-md border border-[#E2E8F0] bg-white text-[12.5px] focus:outline-none focus:border-[#008751]">
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min={0} step={0.01} value={item.unitPrice || ""} onChange={(e) => updateItem(item.id, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })} className={`w-full h-8 text-right rounded-md border text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] px-2 ${item.unitPrice <= 0 ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E2E8F0] bg-white"}`} />
                        </td>
                        <td className="px-3 py-2 text-right font-medium font-mono text-[13px]">{(item.quantity * item.unitPrice).toLocaleString("fr-FR")}</td>
                        <td className="px-2 py-2">
                          <input value={item.echeance ?? ""} onChange={(e) => updateItem(item.id, { echeance: e.target.value })} placeholder="Ex. S3" className="w-full h-8 text-center rounded-md border border-[#E2E8F0] bg-white text-[11px] font-medium focus:outline-none focus:border-[#008751]" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="w-6 h-6 rounded bg-white border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F8FAF9] disabled:opacity-30">↑</button>
                            <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="w-6 h-6 rounded bg-white border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F8FAF9] disabled:opacity-30">↓</button>
                            <button onClick={() => setDeleteId(item.id)} disabled={items.length <= 1} className="w-6 h-6 rounded bg-white border border-[#FECACA] text-[#EF4444] flex items-center justify-center hover:bg-[#FEF2F2] disabled:opacity-30">✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#F8FAF9]">
                    <tr className="border-t border-[#E2E8F0]">
                      <td colSpan={5} className="px-4 py-2.5 text-right text-[12px] font-medium text-[#64748B]">Main d&apos;œuvre</td>
                      <td className="px-3 py-2.5 text-right">
                        <input type="number" min={0} step={0.01} value={laborCost || ""} onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)} placeholder="0" className="w-full h-7 text-right rounded-md border border-[#E2E8F0] bg-white text-[12.5px] px-2" />
                      </td>
                      <td colSpan={2} />
                    </tr>
                    <tr className="border-t border-[#E2E8F0]">
                      <td colSpan={5} className="px-4 py-2.5 text-right text-[12px] font-medium text-[#64748B]">Total HT</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{totals.totalHT.toLocaleString("fr-FR")}</td>
                      <td colSpan={2} />
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-4 py-2 text-right text-[12px] font-medium text-[#64748B]">
                        <span className="inline-flex items-center gap-1.5">
                          TVA <input type="number" min={0} max={100} step={0.5} value={tvaRate} onChange={(e) => setTvaRate(parseFloat(e.target.value) || 0)} className="w-14 h-6 text-center rounded border border-[#E2E8F0] text-[11px]" />%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#64748B]">{totals.tva.toLocaleString("fr-FR")}</td>
                      <td colSpan={2} />
                    </tr>
                    <tr className="border-t border-[#E2E8F0] bg-white">
                      <td colSpan={5} className="px-4 py-3 text-right text-[13px] font-bold">Total TTC</td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-[15px] text-[#008751]">{totals.totalTTC.toLocaleString("fr-FR")}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Jalons — cartes empilées, mobile uniquement (même état, même logique que le
                tableau ci-dessus — juste une présentation adaptée au tactile : boutons
                toujours visibles, pas de survol). */}
            <div className="lg:hidden space-y-3">
              {items.map((item, idx) => (
                <div key={item.id} className="bg-[#F8FAF9] border border-[#E2E8F0] rounded-xl p-3">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-semibold text-[#008751] px-2 py-0.5 bg-[#E6F4EE] rounded-full">#{String(idx + 1).padStart(2, "0")}</span>
                    <div className="flex gap-1">
                      <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="w-7 h-7 rounded-lg border border-[#E2E8F0] bg-white text-[10px] disabled:opacity-30">▲</button>
                      <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} className="w-7 h-7 rounded-lg border border-[#E2E8F0] bg-white text-[10px] disabled:opacity-30">▼</button>
                      <button onClick={() => setDeleteId(item.id)} disabled={items.length <= 1} className="w-7 h-7 rounded-lg border border-[#E2E8F0] bg-white text-red-500 text-xs disabled:opacity-30">✕</button>
                    </div>
                  </div>
                  <input
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder="Description du jalon..."
                    className={`mt-2 w-full text-sm font-medium border rounded-lg px-3 py-2 ${!item.description.trim() ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E2E8F0] bg-white"}`}
                  />
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div>
                      <div className="text-[10px] text-[#64748B] uppercase tracking-widest">Qté</div>
                      <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: Math.max(1, Number(e.target.value)) })} className="mt-1 w-full h-9 rounded-lg border border-[#E2E8F0] px-2 text-sm" />
                    </div>
                    <div>
                      <div className="text-[10px] text-[#64748B] uppercase tracking-widest">PU HT</div>
                      <input type="number" min={0} step={0.01} value={item.unitPrice || ""} onChange={(e) => updateItem(item.id, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })} className={`mt-1 w-full h-9 rounded-lg border px-2 text-sm ${item.unitPrice <= 0 ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E2E8F0]"}`} />
                    </div>
                    <div>
                      <div className="text-[10px] text-[#64748B] uppercase tracking-widest">Montant</div>
                      <div className="mt-1 h-9 flex items-center justify-end font-medium text-sm bg-white border border-[#E2E8F0] rounded-lg px-2">{(item.quantity * item.unitPrice).toLocaleString("fr-FR")}</div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="text-[10px] text-[#64748B] uppercase tracking-widest">Échéance</div>
                    <input value={item.echeance ?? ""} onChange={(e) => updateItem(item.id, { echeance: e.target.value })} placeholder="Ex. S3" className="mt-1 w-full h-9 rounded-lg border border-[#E2E8F0] px-2 text-sm" />
                  </div>
                </div>
              ))}

              {/* Totaux — équivalent mobile du tfoot du tableau desktop */}
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B]">Main d&apos;œuvre</span>
                  <input type="number" min={0} step={0.01} value={laborCost || ""} onChange={(e) => setLaborCost(parseFloat(e.target.value) || 0)} placeholder="0" className="w-28 h-8 text-right rounded-md border border-[#E2E8F0] px-2 text-[13px]" />
                </div>
                <div className="flex justify-between"><span className="text-[#64748B]">Total HT</span><span className="font-medium">{totals.totalHT.toLocaleString("fr-FR")}</span></div>
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] flex items-center gap-1.5">TVA <input type="number" min={0} max={100} step={0.5} value={tvaRate} onChange={(e) => setTvaRate(parseFloat(e.target.value) || 0)} className="w-12 h-6 text-center rounded border border-[#E2E8F0] text-[11px]" />%</span>
                  <span className="text-[#64748B]">{totals.tva.toLocaleString("fr-FR")}</span>
                </div>
                <div className="flex justify-between text-[16px] font-bold pt-2 border-t border-[#E2E8F0]"><span>Total TTC</span><span className="text-[#008751]">{totals.totalTTC.toLocaleString("fr-FR")}</span></div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3">
              <button onClick={addItem} className="h-8 px-3 rounded-lg border border-dashed border-[#94A3B8] text-[12px] font-medium hover:border-[#008751] hover:text-[#008751]">+ Ajouter jalon</button>
              <span className="text-[11px] text-[#94A3B8]">{items.length} jalons • Calcul live</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-4 mt-6">
              <div>
                <label className="text-[11px] font-semibold tracking-wide uppercase text-[#64748B] mb-1.5 block">Délai d&apos;exécution</label>
                <select value={delay ?? ""} onChange={(e) => setDelay(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[13px] focus:outline-none focus:border-[#008751]">
                  {DELAY_PRESETS.map((d) => <option key={d} value={d}>{d}</option>)}
                  {delay && !DELAY_PRESETS.includes(delay) && <option value={delay}>{delay}</option>}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold tracking-wide uppercase text-[#64748B] mb-1.5 block">Date début souhaitée</label>
                <input type="date" value={dateDebut} onChange={(e) => { setDateDebut(e.target.value); if (e.target.value) setExpiredDateDebut(null); }} className={`w-full h-10 px-3 rounded-lg border bg-white text-[13px] focus:outline-none focus:border-[#008751] ${!dateDebut ? "border-[#FCA5A5]" : "border-[#E2E8F0]"}`} />
                {expiredDateDebut && (
                  <p className="mt-1.5 text-[11px] leading-4 text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-2.5 py-2">
                    {/* Voir `formatDateSaisie` en tête de fichier pour le motif : une date de
                        calendrier ne passe jamais par `new Date(...)`. */}
                    La date de début de votre brouillon ({formatDateSaisie(expiredDateDebut)}) est passée
                    et n&apos;a pas été reprise. Choisissez une nouvelle date avant de soumettre votre devis.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[11px] font-semibold tracking-wide uppercase text-[#64748B] mb-1.5 flex items-center justify-between">
                <span>Message au client *</span>
                <span className={`text-[11px] font-normal ${(message ?? "").length < 20 ? "text-[#EF4444]" : "text-[#94A3B8]"}`}>{(message ?? "").length} caractères • min 20</span>
              </label>
              <textarea
                value={message ?? ""}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="Présentez votre approche, références similaires, garanties..."
                className={`w-full rounded-lg border p-3 text-[13px] leading-6 resize-none focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] ${(message ?? "").trim().length < 20 ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E2E8F0] bg-white"}`}
              />
            </div>

            <label className="mt-5 flex items-start gap-3 p-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] cursor-pointer">
              <input type="checkbox" checked={highlightProfile} onChange={(e) => setHighlightProfile(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-[#CBD5E1] text-[#008751]" />
              <span className="text-[13px] leading-5">
                <span className="font-semibold">Mettre en avant mon profil avec réalisations</span>
              </span>
            </label>
          </div>
          </div>
        </main>

        {/* Panneau latéral droit */}
        <aside className={`w-full lg:w-[380px] shrink-0 space-y-4 ${mobileTab === "client" ? "block" : "hidden lg:block"}`}>
          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5">
            <Link href={mission.client ? `/profil/${mission.client.id}` : "#"} className="flex items-start gap-3" style={{ textDecoration: "none", color: "inherit" }}>
              <Avatar src={mission.client?.avatarPath ? `/api/users/${mission.client.id}/avatar` : null} initials={clientInitials} size={44} gradient="from-[#0f172a] to-[#334155]" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold text-[14px]">{clientName} {mission.client?.country && <span>{countryFlag(mission.client.country)}</span>}</div>
                  {mission.clientStats.kycVerified && (
                    <span className="px-2 py-0.5 rounded-full bg-[#E6F4EE] text-[#008751] text-[10px] font-bold">KYC Validé</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[12px] text-[#64748B] mt-1 flex-wrap">
                  <span>{mission.clientStats.missionsCompleted} mission{mission.clientStats.missionsCompleted > 1 ? "s" : ""} clôturée{mission.clientStats.missionsCompleted > 1 ? "s" : ""}</span>
                  {mission.clientStats.averageRating != null && <span><span className="text-[#F7C948]">★</span> {mission.clientStats.averageRating.toFixed(1)}</span>}
                  {mission.clientStats.memberSince && <span>Membre {new Date(mission.clientStats.memberSince).getFullYear()}</span>}
                </div>
              </div>
            </Link>
            <div className="mt-3 p-2.5 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] text-[12px] text-[#475569]">
              Paiement sécurisé via escrow — les fonds ne sont libérés qu&apos;après validation du livrable.
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-[13px] mb-4 flex items-center justify-between">
              Récap Devis
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B]">{priceMode === "fixe" ? "Prix fixe" : "Taux horaire"}</span>
            </h3>
            <div className="space-y-2.5 text-[13px]">
              <div className="flex justify-between"><span className="text-[#64748B]">Montant TTC</span><span className="font-bold font-mono text-[15px] text-[#008751]">{totals.totalTTC.toLocaleString("fr-FR")} {mission.currency}</span></div>
              <div className="flex justify-between"><span className="text-[#64748B]">Total HT</span><span className="font-medium font-mono">{totals.totalHT.toLocaleString("fr-FR")}</span></div>
              <div className="flex justify-between"><span className="text-[#64748B]">TVA ({tvaRate}%)</span><span className="font-mono text-[#64748B]">{totals.tva.toLocaleString("fr-FR")}</span></div>
              <div className="h-px bg-[#E2E8F0] my-2" />
              <div className="flex justify-between"><span className="text-[#64748B]">Jalons</span><span className="font-medium">{items.length}</span></div>
              <div className="flex justify-between"><span className="text-[#64748B]">Délai</span><span className="font-medium">{delay}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
            <div className="text-[12.5px] leading-5 text-[#92400E]">
              <div className="font-semibold mb-1">Exclusivité candidature</div>
              En soumettant ce devis, vous ne pouvez pas avoir une autre négociation active en parallèle sur une autre mission.
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5">
            <button
              disabled={!canSubmitForm || pending}
              onClick={submit}
              className={`w-full h-11 rounded-lg font-semibold text-[14px] transition ${canSubmitForm && !pending ? "bg-[#008751] hover:bg-[#006E42] text-white shadow-sm" : "bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed"}`}
            >
              {pending ? "Envoi..." : `Soumettre mon devis – ${totals.totalTTC.toLocaleString("fr-FR")} ${mission.currency}`}
            </button>
            <button onClick={saveDraftNow} className="w-full mt-2.5 h-10 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9]">
              Enregistrer brouillon
            </button>
            {!canSubmitForm && (
              <div className="mt-3 p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[11px] text-[#B91C1C] leading-4">
                • Vérifiez les jalons (description + prix &gt; 0) • Message min 20 caractères • Date de début requise
              </div>
            )}
            {feedback && <p className={`mt-3 text-sm ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.msg}</p>}
          </div>
        </aside>
      </div>

      {/* Barre d'action fixe — mobile uniquement, pour garder le total et l'action de
          soumission accessibles sans avoir à faire défiler jusqu'au panneau latéral droit
          (masqué hors de l'onglet "Client" sur petit écran). */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-[#E2E8F0] p-3 z-20 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] text-[#64748B]">Total TTC</div>
          <div className="font-bold">{totals.totalTTC.toLocaleString("fr-FR")} {mission.currency}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPreviewOpen(true)} className="h-10 px-4 rounded-lg border border-[#E2E8F0] text-sm">👁</button>
          <button
            disabled={!canSubmitForm || pending}
            onClick={submit}
            className={`h-10 px-5 rounded-lg text-sm font-medium ${canSubmitForm && !pending ? "bg-[#008751] text-white" : "bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed"}`}
          >
            {pending ? "Envoi..." : "Soumettre"}
          </button>
        </div>
      </div>

      {/* Modale confirmation suppression jalon */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#0f172a]/50" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-[360px] p-5">
            <h4 className="font-semibold text-[14px] mb-1">Supprimer ce jalon ?</h4>
            <p className="text-[12px] text-[#64748B] leading-5 mb-4">Cette action recalcule automatiquement le total.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium">Annuler</button>
              <button onClick={confirmDelete} className="h-9 px-4 rounded-lg bg-[#EF4444] text-white text-[13px] font-medium hover:bg-[#DC2626]">Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale aperçu — écran uniquement, aucun PDF généré */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8">
          <div className="absolute inset-0 bg-[#0f172a]/60" onClick={() => setPreviewOpen(false)} />
          <div className="relative bg-white rounded-xl border border-[#E2E8F0] shadow-2xl w-full max-w-[780px] max-h-[90vh] overflow-hidden flex flex-col">
            <div className="h-14 px-6 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
              <span className="font-semibold text-[14px]">Aperçu du devis</span>
              <button onClick={() => setPreviewOpen(false)} className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center hover:bg-[#F8FAF9]">✕</button>
            </div>
            <div className="overflow-auto p-8 bg-[#F8FAF9]">
              <div className="bg-white border border-[#E2E8F0] rounded-lg p-8 shadow-sm">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <div className="text-[11px] tracking-widest font-bold text-[#94A3B8] uppercase">Devis • Flexwork</div>
                    <div className="text-[20px] font-bold mt-1">{mission.titre}</div>
                    <div className="text-[12px] text-[#64748B] mt-1">Réf {mission.id.slice(-8).toUpperCase()} • {new Date().toLocaleDateString("fr-FR")}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] text-[#64748B]">Total TTC</div>
                    <div className="text-[22px] font-bold font-mono text-[#008751]">{totals.totalTTC.toLocaleString("fr-FR")} {mission.currency}</div>
                  </div>
                </div>
                <table className="w-full text-[12px] border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <thead className="bg-[#F8FAF9] text-[10px] uppercase tracking-wide font-semibold text-[#64748B]">
                    <tr><th className="text-left p-2.5">#</th><th className="text-left p-2.5">Prestation</th><th className="text-right p-2.5">Montant HT</th></tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id} className="border-t border-[#F1F5F9]">
                        <td className="p-2.5 font-mono">{String(idx + 1).padStart(2, "0")}</td>
                        <td className="p-2.5">{it.description || <span className="text-[#94A3B8] italic">— description vide —</span>}</td>
                        <td className="p-2.5 text-right font-mono">{(it.quantity * it.unitPrice).toLocaleString("fr-FR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-6 grid grid-cols-2 gap-6 text-[12px]">
                  <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0]">
                    <div className="font-semibold mb-1">Conditions</div>
                    <div className="text-[#64748B] leading-5">Délai {delay} {dateDebut && `• Début ${formatDateSaisie(dateDebut)}`}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0]">
                    <div className="font-semibold mb-1">Message</div>
                    <div className="text-[#64748B] leading-5 whitespace-pre-wrap line-clamp-4">{message}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
