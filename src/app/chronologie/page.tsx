"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronDown, ExternalLink, FileText, Check } from "lucide-react";
import { missionsHrefForRole, candidaturesHrefForRole, type Role } from "@/lib/role-dashboard";
import { fetchDedupe } from "@/lib/fetch-dedupe";

// ─────────────────────────────────────────────────────────────────────────────
// Chronologie des pages — Publication → Clôture
// Intégration de la vue « Chronologie-Pages-Publication-Cloture-Vjr.html » dans
// l'application : les 14 étapes de la maquette sont mappées sur les pages et
// fonctionnalités RÉELLEMENT implémentées (routes Next.js, composants, API).
// Les routes dépendantes d'une mission (`/missions/[id]/...`) sont résolues avec
// la première mission accessible via GET /api/missions (connecté) ; sinon le
// motif de route est affiché en code monospace sans lien.
// ─────────────────────────────────────────────────────────────────────────────

// Pipeline global — 7 phases de la maquette VJR.
const PHASES = [
  "Candidature",
  "Étude",
  "Négociation 3/3",
  "Contrat Draft",
  "Signature QR",
  "Escrow",
  "Clôture",
] as const;

// Badges de rôle — palette du design system Flexwork.
const ROLE_BADGE: Record<string, string> = {
  CLIENT: "bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]",
  PUBLIC: "bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]",
  TALENT: "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]",
  BOTH: "bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]",
  SYSTEM: "bg-[#F3E8FF] text-[#7C3AED] border border-[#E9D5FF]",
};

// Badges de statut — mêmes tons que MISSION_STATUS_STYLE (src/lib/mission-status.ts).
const STATUS_TONE = {
  green: "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]",
  gray: "bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]",
  blue: "bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]",
  amber: "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]",
  dark: "bg-[#0f172a] text-white border border-[#0f172a]",
} as const;

type RouteLink = {
  /** Label affiché (route réelle, `[id]` = mission résolue). */
  label: string;
  /** Route réelle avec éventuel placeholder `[id]`. */
  href: string;
  note?: string;
};

type ChronoStep = {
  id: string;
  phase: number;
  role: string;
  date: string;
  title: string;
  /** Fichiers sources de la maquette VJR d'origine. */
  src: string[];
  status: string;
  statusTone: keyof typeof STATUS_TONE;
  description: string;
  /** Pages/fonctionnalités réellement implémentées. */
  links: RouteLink[];
  detail: string;
};

const STEPS: ChronoStep[] = [
  {
    id: "01",
    phase: 0,
    role: "CLIENT",
    date: "J-12 · 08:30",
    title: "Formulaire Publication Mission",
    src: ["formulaire-publication-missions-vjr"],
    status: "Publié",
    statusTone: "green",
    description:
      "Page Mission publiée — ouverte aux candidatures. Formulaire réel de création : titre, description, domaine (risque MEDIUM auto), budget, délai, mode (FIXED / TAUX / QUOTE), tags, date d'expiration. Publication soumise au KYC vérifié.",
    links: [{ label: "/missions/new", href: "/missions/new", note: "Publier une mission" }],
    detail:
      "src/app/missions/new/page.tsx → POST /api/missions. Le domaine détermine le palier de risque (resolveMissionRisk) et l'éventuelle assurance effective. Un brouillon est enregistrable sans KYC ; la publication (status = publiee) l'exige.",
  },
  {
    id: "02",
    phase: 0,
    role: "PUBLIC",
    date: "J-12 · 09:15",
    title: "Liste Missions / Détail Mission",
    src: ["liste-missions-vjr", "offre-candidature-vjr-mobile-apercu"],
    status: "Ouvert",
    statusTone: "green",
    description:
      "Carte mission (tags, localisation, deadline J-X) dans le dashboard du rôle + page détail synchronisée sur le statut réel : budget publié vs prix convenu (contrat), délai souhaité vs convenu, risque, actions selon le statut.",
    links: [
      { label: "/missions/[id]", href: "/missions/[id]", note: "Détail mission" },
      { label: "Liste (dashboard rôle)", href: "ROLE_MISSIONS", note: "Mes missions / missions ouvertes" },
    ],
    detail:
      "Détail : src/app/missions/[id]/page.tsx + GET /api/missions/[id] (expose contractPrice / contractDelaiJours / escrowHoldStatus, jamais le termsSnapshot brut). Liste : missionsHrefForRole() → /dashboard/<role>/missions (prestataire) ou /client/missions (client).",
  },
  {
    id: "03",
    phase: 0,
    role: "TALENT",
    date: "J-11 · 14:00",
    title: "Formulaires Prestataire → Profil Extrait",
    src: ["profil-talent-extrait-vjr", "modeles-4-categories"],
    status: "KYC Validé",
    statusTone: "green",
    description:
      "Création de profil prestataire (Expert Digital / Expert BTP / Artisan / Manœuvre), portfolio, CV, tarif FCFA. Extrait public : badge unique « Identité vérifiée », blocs « Déclaré » (jamais vérifié pour compétences/assurance — A8/A11).",
    links: [
      { label: "/profile", href: "/profile", note: "Formulaire prestataire" },
      { label: "/profil/[id]", href: "/profil/[id]", note: "Extrait public" },
    ],
    detail:
      "Formulaire : src/app/profile/page.tsx (portfolio/cv via POST /api/profile/portfolio). Extrait : src/app/profil/[id]/page.tsx (données réelles public-profile, 3 blocs Vérifié/Déclaré/Activité). Badges : src/components/IdentityBadge.tsx.",
  },
  {
    id: "04",
    phase: 0,
    role: "TALENT",
    date: "J-10 · 10:45",
    title: "Offre de Candidature — Soumission devis",
    src: ["offre-candidature-vjr-mobile-apercu.html"],
    status: "Brouillon",
    statusTone: "gray",
    description:
      "Tableau jalons « # | Description | Qté | PU HT | Montant | Échéance » avec réordonnancement ▲▼, calcul auto du Total TTC, délai proposé et aperçu PDF en filigrane NON CONTRACTUEL · BROUILLON.",
    links: [
      { label: "/missions/[id]/devis", href: "/missions/[id]/devis", note: "Mode QUOTE (jalons)" },
      { label: "/missions/[id]", href: "/missions/[id]", note: "Candidature prix fixe / taux" },
    ],
    detail:
      "Mode devis : src/app/missions/[id]/devis/page.tsx + DevisPanel (src/components/devis/devis-panel.tsx) + src/lib/devis.ts (DevisData, jalons, totalTTC, TVA 18% incluse). Prix fixe/taux : candidature avec montant + delaiPropose via POST /api/missions/[id]/proposals.",
  },
  {
    id: "05",
    phase: 1,
    role: "CLIENT",
    date: "J-9 · 16:20",
    title: "Tableau Récap Candidatures",
    src: ["offre-soumise-vue-voir-devis.html"],
    status: "12 reçues",
    statusTone: "blue",
    description:
      "Tableau récapitulatif des candidatures reçues (desktop) / cartes (mobile) : Artisan | Montant TTC | Délai | Jalons | Statut | Voir. Adapté au mode (devis QUOTE vs prix fixe/taux).",
    links: [{ label: "/missions/[id]/proposals", href: "/missions/[id]/proposals", note: "Candidatures reçues" }],
    detail:
      "src/app/missions/[id]/proposals/page.tsx + GET /api/missions/[id]/proposals. Réservé au client propriétaire. Statistiques + filtres (Toutes / En négociation / Devis validé / Refusée / Contrat signé). Une candidature dont la révision est attendue s'affiche « Révision demandée » tant que la négociation n'est pas close (src/lib/proposal-status.ts).",
  },
  {
    id: "06",
    phase: 1,
    role: "CLIENT",
    date: "J-9 · 16:25",
    title: "Drawer Voir Offre Soumise",
    src: ["offre-soumise-vue-voir-devis.html [drawer]"],
    status: "Lecture seule",
    statusTone: "blue",
    description:
      "Tiroir de détail d'une offre soumise : devis détaillé en lecture seule (même tableau jalons que la soumission) + actions du mode (accepter, demander une révision, rejeter) et messagerie intégrée.",
    links: [{ label: "/missions/[id]/proposals", href: "/missions/[id]/proposals", note: "Bouton « Voir »" }],
    detail:
      "Composants DevisDetails / ValidateDevis / RequestRevision / RejectDevis (src/components/devis/devis-panel.tsx). Bouton « Contacter » du candidat → bulle de messagerie sur /missions/[id].",
  },
  {
    id: "07",
    phase: 1,
    role: "TALENT",
    date: "J-9 · 17:00",
    title: "Récap Offre Envoyée",
    src: ["recap-offre-candidature-envoyee-vjr"],
    status: "Révision demandée · R1/3",
    statusTone: "amber",
    description:
      "« Mes candidatures » du prestataire : statut de la candidature synchronisé sur le statut réel de la mission (Contrat signé, Fonds séquestrés…), historique des révisions, pièces jointes bloquées avant acceptation (anti travail-test gratuit).",
    links: [{ label: "Mes candidatures", href: "ROLE_CANDIDATURES", note: "/dashboard/<role>/candidatures" }],
    detail:
      "CandidaturesSection (src/components/dashboard/provider/) + GET /api/dashboard/my-proposals. Récap devis envoyé : DevisPanel côté prestataire, rounds de négociation et révisions.",
  },
  {
    id: "08",
    phase: 2,
    role: "BOTH",
    date: "J-8 → J-5",
    title: "Messagerie & Négociation Rounds",
    src: ["messagerie-vjr-rounds-0-3"],
    status: "Round 1→3",
    statusTone: "amber",
    description:
      "Rounds de négociation 0/3 → 1/3 → 2/3 → 3/3 : proposer une révision, resoumettre une nouvelle version du devis, échanger via la messagerie intégrée de la mission.",
    links: [
      { label: "/missions/[id]", href: "/missions/[id]", note: "Bulle messagerie + DevisPanel" },
      { label: "/client/messages", href: "/client/messages", note: "Messagerie (dashboard)" },
    ],
    detail:
      "Rounds : POST /api/missions/[id]/proposals (maxRevisionRounds) + devis/validate (demande de révision consommée). Messagerie : src/components/chat/MessageBubble + GET/POST /api/messages. Visibilité conditionnée à une candidature engagée (src/lib/messaging-visibility.ts).",
  },
  {
    id: "09",
    phase: 2,
    role: "CLIENT",
    date: "J-4 · 11:00",
    title: "Devis Validé",
    src: ["devis-valide-vjr"],
    status: "Validé",
    statusTone: "green",
    description:
      "Validation du devis par le client : badge vert, verrouillage des montants et échéances, mission → proposition_acceptee, montants figés pour le futur contrat.",
    links: [{ label: "/missions/[id]/proposals", href: "/missions/[id]/proposals", note: "Action « Valider le devis »" }],
    detail:
      "ValidateDevis (src/components/devis/devis-panel.tsx) → POST /api/missions/[id]/proposals/[proposalId]/devis/validate. Le devis gagnant reste « devis_valide » (jamais « acceptee ») dans ce parcours.",
  },
  {
    id: "10",
    phase: 3,
    role: "SYSTEM",
    date: "J-4 · 11:05",
    title: "Contrat Draft",
    src: ["FlexWork_recapoffre", "contrat-draft-vjr"],
    status: "BROUILLON",
    statusTone: "gray",
    description:
      "Génération automatique du contrat (10 articles, modèle béninois XOF) : termsSnapshot immuable chaîné par hash, filigrane BROUILLON, sans QR tant que non signé, export PDF officiel.",
    links: [
      { label: "/missions/[id]/contract", href: "/missions/[id]/contract", note: "Page contrat" },
      { label: "/api/missions/[id]/contract/document?format=pdf", href: "/api/missions/[id]/contract/document?format=pdf", note: "Export PDF" },
    ],
    detail:
      "POST /api/missions/[id]/contract + src/lib/contract-clauses.ts (buildContractSections, 10 articles + médiation) + src/lib/contract-document.ts (PDF via pdf-lib, bandeau, jalons, QR signatures). Délai = delaiPropose de la contre-proposition.",
  },
  {
    id: "11",
    phase: 4,
    role: "BOTH",
    date: "J-4 · 14:30",
    title: "Signature QR Bilatérale",
    src: ["signature-qr-bilaterale-vjr"],
    status: "Signé x2",
    statusTone: "green",
    description:
      "2 signatures électroniques (RSA-SHA256), hash SHA-256, QR de preuve généré, vérification publique. Ordre imposé serveur : le prestataire signe en premier, le client contre-signe (48 h max).",
    links: [{ label: "/missions/[id]/contract", href: "/missions/[id]/contract", note: "SignContractModal + SignatureQRCode" }],
    detail:
      "POST /api/signature/sign (ordre + expirations 48 h, src/lib/contract-expiry.ts) + /api/signature/verify. Composants SignContractModal (src/components/sign-contract-modal.tsx) et SignatureQRCode. À la contre-signature : déclenchement auto du séquestre.",
  },
  {
    id: "12",
    phase: 5,
    role: "SYSTEM",
    date: "J-4 · 14:35",
    title: "Escrow / Paiement Sécurisé",
    src: ["escrow-paiement-vjr"],
    status: "487k bloqués",
    statusTone: "blue",
    description:
      "Instruction HOLD au PSP agréé (FedaPay / Mobile Money) — la plateforme ne détient jamais les fonds. Montant = prix du contrat. Libération par jalons à la validation. Console sandbox en dev.",
    links: [
      { label: "/missions/[id]/escrow", href: "/missions/[id]/escrow", note: "Paiement sous séquestre" },
      { label: "/psp-sandbox", href: "/psp-sandbox", note: "Console sandbox (dev)" },
    ],
    detail:
      "src/app/missions/[id]/escrow/page.tsx + src/lib/escrow.ts (requestContractHold, contractPrice = prix convenu) + PSP virtuel src/lib/psp-virtual.ts (webhook signé HMAC, US-503). HOLD auto à la 2ᵉ signature.",
  },
  {
    id: "13",
    phase: 5,
    role: "TALENT",
    date: "J-3 → J0",
    title: "Exécution Jalons",
    src: ["execution-jalons-vjr"],
    status: "En cours",
    statusTone: "blue",
    description:
      "Suivi des échéances (2026-09-05 / 12 / 19), statut de chaque jalon (En attente / Financé / Livrable soumis / Validé / Payé), pointage de présence GPS (opt-in), soumission de livrables jalon par jalon avec preuves typées.",
    links: [
      { label: "/missions/[id]", href: "/missions/[id]", note: "Suivi jalons" },
      { label: "/missions/[id]/checkin", href: "/missions/[id]/checkin", note: "Pointage GPS" },
      { label: "/missions/[id]/deliverable", href: "/missions/[id]/deliverable", note: "Soumettre le livrable" },
    ],
    detail:
      "Jalons : GET /api/missions/[id]/jalons (progression déclarée/constatée — la libération exige 100% constaté par le client). Pointage : src/app/missions/[id]/checkin/page.tsx (opt-in, GPS, purge auto). Livrable : src/app/missions/[id]/deliverable/page.tsx (photo/vidéo/document/géoloc/autre).",
  },
  {
    id: "14",
    phase: 6,
    role: "CLIENT",
    date: "J0 · 18:00",
    title: "Clôture / Livraison / Avis",
    src: ["cloture-livraison-avis-vjr"],
    status: "Clôturé 4.9★",
    statusTone: "dark",
    description:
      "Validation du livrable → RELEASE escrow → mission « cloturee » (tous jalons libérés). Notation croisée client/prestataire (1 à 5), note moyenne dans le bloc Activité, satisfaction garantie.",
    links: [
      { label: "/missions/[id]", href: "/missions/[id]", note: "Valider le livrable" },
      { label: "/missions/[id]/reviews", href: "/missions/[id]/reviews", note: "Avis sur la mission" },
    ],
    detail:
      "Validation + release : POST /api/missions/[id]/deliverable/validate + escrow/release → src/lib/psp-webhook.ts (mission cloturee une fois TOUS les jalons libere). Avis : src/app/missions/[id]/reviews/page.tsx + POST /api/missions/[id]/reviews (suspendu si médiation ouverte).",
  },
];

// Aperçu du modèle de tableau jalons (identique à la maquette VJR) — référence
// pour l'étape 04, tel que produit par src/lib/devis.ts / DevisPanel.
const SAMPLE_JALONS = [
  { n: 1, desc: "Préparation surface & protection", qte: "1", pu: "85 000", montant: "85 000", echeance: "2026-09-05" },
  { n: 2, desc: "Enduit finition haute résistance", qte: "35", pu: "6 200", montant: "217 000", echeance: "2026-09-12" },
  { n: 3, desc: "Peinture velours + vernis", qte: "35", pu: "3 800", montant: "133 000", echeance: "2026-09-19" },
  { n: 4, desc: "Nettoyage & livraison finale", qte: "1", pu: "52 000", montant: "52 000", echeance: "2026-09-19" },
];

export default function ChronologiePage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role as Role | undefined;
  const [missionId, setMissionId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Résout une mission réelle pour construire les liens `/missions/[id]/...` :
  // connecté → première mission accessible (client : ses missions ; prestataire :
  // missions ouvertes). Anonyme → 401, les liens [id] restent en code monospace.
  useEffect(() => {
    fetchDedupe("/api/missions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = d?.items ?? [];
        if (items.length > 0) setMissionId(items[0].id);
      })
      .catch(() => {});
  }, []);

  const missionsHref = missionsHrefForRole(role);
  const candidaturesHref = candidaturesHrefForRole(role);
  const expand = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  // Construit le href réel d'une route : remplace le placeholder `[id]` par la
  // mission résolue, et les marqueurs de rôle par le lien du dashboard courant.
  const resolveHref = (href: string): string | null => {
    if (href === "ROLE_MISSIONS") return missionsHref;
    if (href === "ROLE_CANDIDATURES") return candidaturesHref;
    if (!href.includes("[id]")) return href;
    return missionId ? href.replace("[id]", missionId) : null;
  };

  const isResolvable = (href: string): boolean =>
    href === "ROLE_MISSIONS" || href === "ROLE_CANDIDATURES" || !href.includes("[id]") || !!missionId;

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[960px] mx-auto px-4 lg:px-0 py-8 space-y-6">
        {/* Bandeau */}
        <div className="rounded-xl overflow-hidden border border-[#E2E8F0]">
          <div className="h-1 w-full bg-gradient-to-r from-[#008751] via-[#FCD116] to-[#E8112D]" />
          <div className="bg-[#0A1931] text-white px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[11px] font-bold tracking-[0.2em] text-[#FCD116]">FLEXWORK</p>
              <p className="text-[13px] text-white/80">Bénin 🇧🇯 · Publication → Clôture</p>
            </div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-[12px] font-semibold">
              <FileText size={14} /> {STEPS.length} pages
            </span>
          </div>
        </div>

        {/* En-tête */}
        <div>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold tracking-tight">Chronologie des Pages Publication → Clôture</h1>
          <p className="text-[14px] text-[#64748B] mt-2 max-w-[720px] leading-relaxed">
            Vue complète Flexwork de la publication de la mission à la clôture.{" "}
            {STEPS.length} étapes ordonnées avec rôles, fichiers sources VJR, et pages réelles
            implémentées. Chaque carte s&apos;ouvre pour détailler la fonctionnalité et les routes associées.
          </p>
        </div>

        {/* Pipeline global — 7 phases */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
          <p className="text-[11px] font-bold tracking-widest text-[#94A3B8] uppercase mb-3">Pipeline final</p>
          <div className="flex flex-wrap items-center gap-2">
            {PHASES.map((p, i) => (
              <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F0FDF4] text-[#008751] border border-[#A7F3D0] text-[12px] font-semibold">
                <Check size={13} strokeWidth={3} /> {p}
              </span>
            ))}
          </div>
        </div>

        {/* Timeline verticale */}
        <div className="relative pl-6 lg:pl-8">
          {/* Ligne centrale */}
          <div className="absolute left-[7px] lg:left-[9px] top-2 bottom-2 w-[2px] bg-[#008751]/30" style={{ backgroundImage: "repeating-linear-gradient(#008751 0 6px, transparent 6px 12px)" }} />

          <div className="space-y-4">
            {STEPS.map((step) => {
              const open = openId === step.id;
              return (
                <div key={step.id} className="relative">
                  {/* Pastille */}
                  <span className={`absolute -left-6 lg:-left-8 top-6 w-4 h-4 rounded-full border-2 border-white shadow ${open ? "bg-[#008751]" : "bg-white"}`} style={{ boxShadow: open ? "0 0 0 3px rgba(0,135,81,0.18)" : undefined }} />
                  <div className={`bg-white border rounded-xl transition-shadow ${open ? "border-[#008751] shadow-md" : "border-[#E2E8F0] hover:border-[#008751]/40"}`}>
                    <button onClick={() => expand(step.id)} className="w-full text-left p-4 lg:p-5" aria-expanded={open}>
                      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-4">
                        {/* Rôle + date */}
                        <div className="lg:w-[150px] lg:shrink-0 flex lg:flex-col items-center lg:items-start gap-2 lg:gap-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider ${ROLE_BADGE[step.role] ?? ROLE_BADGE.PUBLIC}`}>
                            [{step.role}]
                          </span>
                          <span className="text-[11px] font-medium text-[#64748B] tabular-nums">{step.date}</span>
                        </div>

                        {/* Contenu principal */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <span className="text-[11px] font-extrabold text-[#008751] pt-0.5 tabular-nums">#{step.id}</span>
                              <div className="min-w-0">
                                <h3 className="text-[14px] font-bold leading-snug">{step.title}</h3>
                                <p className="text-[11px] text-[#94A3B8] mt-0.5 font-mono truncate">{step.src.join(" + ")}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`hidden sm:inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold border ${STATUS_TONE[step.statusTone]}`}>{step.status}</span>
                              <ChevronDown size={16} className={`text-[#94A3B8] transition-transform ${open ? "rotate-180" : ""}`} />
                            </div>
                          </div>
                          <p className="text-[13px] text-[#334155] mt-2 leading-relaxed">{step.description}</p>

                          {/* Lien de rôle sur mobile */}
                          <span className={`sm:hidden mt-2 inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold border ${STATUS_TONE[step.statusTone]}`}>{step.status}</span>
                        </div>
                      </div>
                    </button>

                    {/* Détail déplié */}
                    {open && (
                      <div className="border-t border-[#E2E8F0] px-4 lg:px-5 py-4 space-y-4 bg-[#F8FAF9] rounded-b-xl">
                        {/* Routes réelles */}
                        <div>
                          <p className="text-[11px] font-bold tracking-widest text-[#94A3B8] uppercase mb-2">Pages &amp; fonctionnalités implémentées</p>
                          <div className="flex flex-wrap gap-2">
                            {step.links.map((l) => {
                              const href = resolveHref(l.href);
                              const resolvable = isResolvable(l.href);
                              if (!resolvable || !href) {
                                return (
                                  <span key={l.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-[12px] font-mono text-[#94A3B8]">
                                    {l.label} <span className="text-[10px] font-sans">(connectez-vous)</span>
                                  </span>
                                );
                              }
                              return (
                                <Link
                                  key={l.href}
                                  href={href}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#008751]/30 hover:border-[#008751] text-[12px] font-mono font-medium text-[#008751] transition-colors"
                                  style={{ textDecoration: "none" }}
                                >
                                  {l.label} <ExternalLink size={12} />
                                  {l.note && <span className="font-sans text-[10px] text-[#64748B]">· {l.note}</span>}
                                </Link>
                              );
                            })}
                          </div>
                        </div>

                        {/* Détail technique */}
                        <p className="text-[12.5px] text-[#475569] leading-relaxed">{step.detail}</p>

                        {/* Aperçu tableau jalons — étape 04 */}
                        {step.id === "04" && (
                          <div className="rounded-lg border border-[#E2E8F0] overflow-hidden">
                            <div className="bg-[#0A1931] text-white px-3 py-2 text-[11px] font-semibold flex items-center justify-between">
                              <span>Aperçu tableau jalons — modèle officiel (Total HT)</span>
                              <span className="text-[10px] font-mono text-white/60">NON CONTRACTUEL · BROUILLON</span>
                            </div>
                            <table className="w-full text-[12px] bg-white">
                              <thead>
                                <tr className="bg-[#F1F5F9] text-[#475569] text-left text-[10px] uppercase tracking-wide">
                                  <th className="px-3 py-2 font-bold">#</th>
                                  <th className="px-3 py-2 font-bold">Description</th>
                                  <th className="px-3 py-2 font-bold text-right">Qté</th>
                                  <th className="px-3 py-2 font-bold text-right">PU HT</th>
                                  <th className="px-3 py-2 font-bold text-right">Montant</th>
                                  <th className="px-3 py-2 font-bold">Échéance</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E2E8F0]">
                                {SAMPLE_JALONS.map((j) => (
                                  <tr key={j.n}>
                                    <td className="px-3 py-2 text-[#64748B]">{j.n}</td>
                                    <td className="px-3 py-2">{j.desc}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{j.qte}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{j.pu}</td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium">{j.montant}</td>
                                    <td className="px-3 py-2 tabular-nums">{j.echeance}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-[#E2E8F0] bg-[#F8FAF9]">
                                  <td colSpan={4} className="px-3 py-2 text-[11px] font-bold">Total HT</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-bold text-[#008751]">487 000 XOF</td>
                                  <td className="px-3 py-2" />
                                </tr>
                              </tfoot>
                            </table>
                            <div className="px-3 py-2 bg-[#F0FDF4] text-[11px] text-[#008751] font-semibold border-t border-[#A7F3D0]">
                              TTC 487 000 XOF · TVA 18% incluse · Délai 4j — généré par <span className="font-mono">src/lib/devis.ts</span> / <span className="font-mono">DevisPanel</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Note de bas de page */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-[12px] text-[#64748B] leading-relaxed">
          <p className="text-[11px] font-bold tracking-widest text-[#94A3B8] uppercase mb-1">Fichiers sources de la maquette VJR</p>
          <p className="font-mono text-[11px] break-words">
            formulaire-publication-missions-vjr · offre-candidature-vjr-mobile-apercu.html · offre-soumise-vue-voir-devis.html ·
            recap-offre-candidature-envoyee-vjr · profil-talent-extrait-vjr · FlexWork_recapoffre · messagerie-vjr-rounds-0-3 ·
            devis-valide-vjr · contrat-draft-vjr · signature-qr-bilaterale-vjr · escrow-paiement-vjr · execution-jalons-vjr ·
            cloture-livraison-avis-vjr
          </p>
          <p className="mt-2 text-[11.5px]">
            Les liens <span className="font-mono">/missions/[id]/…</span> pointent vers la première mission accessible de votre
            session (client : vos missions ; prestataire : missions ouvertes). Rôle : {role ?? "visiteur"} · Statut du rendu : carte cliquable.
          </p>
        </div>
      </div>
    </div>
  );
}
