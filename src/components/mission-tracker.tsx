"use client";

// Bandeau « état d'évolution de la mission » — reproduit la carte de suivi de la maquette
// (phase + badge + message + barre de 6 phases), synchronisée sur les VRAIS états
// (mission.status + signatures du contrat). Affiche la phase courante, le contrat (id +
// montant) quand il existe, un message d'étape et la progression.
// Composant AUTONOME (charge mission + contrat) — posé en tête de /missions/[id] pour le
// CLIENT propriétaire (au-dessus de la vue Validation) et le PRESTATAIRE (au-dessus du
// détail), via MissionDetailPage + ClientValidationWorkspace.
//
// 6 phases (2026-09-04, remplace l'ancien stepper à 5 cases) — Offre & Candidature / Signature
// / Financement Escrow / Pilotage Jalons / Clôture / Litige. Litige est une case À PART, pas
// une réutilisation de la case Pilotage : une médiation ouverte n'est pas juste "toujours en
// pilotage", elle bloque la progression normale (le stepper doit le montrer distinctement,
// en rouge, sans faire croire que la Clôture a été atteinte). Local à ce composant — ne
// touche pas src/lib/contract-stepper.ts (CONTRACT_STEPS, 5 cases), qui reste le stepper de
// la page contrat (missions/[id]/contract), hors du périmètre de cette refonte (scopée à la
// validation des missions).
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";

type Mission = {
  id: string;
  titre: string;
  status: string;
  currency: string;
  budget: number;
  contractPrice: number | null;
  // Vrai uniquement pour le CLIENT propriétaire — permet au bandeau de s'adresser au bon
  // interlocuteur (le prestataire ne valide jamais un livrable : "validez / rejetez" est un
  // message client, pas prestataire).
  isOwner: boolean;
};
type Contract = { id: string; clientSignedAt: string | null; providerSignedAt: string | null };

type PhaseInfo = {
  step: number;
  badge: string;
  badgeClass: string;
  title: string;
  message: string;
};

const MISSION_PHASES = ["Offre & Candidature", "Signature", "Financement Escrow", "Pilotage Jalons", "Clôture", "Litige"] as const;
const LITIGE_INDEX = 5;

const BADGE_BLUE = "bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE]";
const BADGE_GRAY = "bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]";
const BADGE_GREEN = "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]";
const BADGE_AMBER = "bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]";
const BADGE_RED = "bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]";
const BADGE_DARK = "bg-[#0A1931] text-white border border-[#0A1931]";

function describe(mission: Mission, contract: Contract | null): PhaseInfo {
  const st = mission.status;
  // Le propriétaire d'une mission engagée est le CLIENT : le bandeau s'adresse à lui en
  // "vous" (valider/rejeter le livrable). Tout autre visiteur (prestataire du contrat ou
  // simple observateur) lit la version "tiers" ("le client", "le prestataire").
  const client = mission.isOwner;
  // Aucun contrat : mission pas encore engagée (brouillon / publiée).
  if (!contract) {
    if (st === "brouillon") {
      return {
        step: 0,
        badge: "Brouillon",
        badgeClass: BADGE_GRAY,
        title: "Offre & Candidature — Brouillon",
        message: "Mission en préparation. Publiez-la pour la soumettre aux candidatures de prestataires vérifiés.",
      };
    }
    return {
      step: 0,
      badge: "Mission ouverte",
      badgeClass: BADGE_BLUE,
      title: "Offre & Candidature — Sélection du prestataire",
      message: "Mission publiée et ouverte aux candidatures. Sélectionnez le prestataire pour générer le contrat sécurisé.",
    };
  }

  const clientSigned = !!contract.clientSignedAt;
  const providerSigned = !!contract.providerSignedAt;
  const money = `${(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} ${mission.currency}`;

  // Signature en cours (une des deux parties n'a pas encore signé).
  if (!clientSigned || !providerSigned) {
    const who = !clientSigned && !providerSigned ? "Les deux parties" : clientSigned ? "Le prestataire" : "Le client";
    const waiting = clientSigned ? "du prestataire" : providerSigned ? "du client" : "des deux parties";
    return {
      step: 1,
      badge: "Signature en attente",
      badgeClass: BADGE_AMBER,
      title: "Signature — Contrat à signer",
      message: `${who} ${clientSigned || providerSigned ? "ont signé" : "doivent signer"} — en attente de la signature ${waiting}. Chaque signature génère un QR code cryptographique vérifiable.`,
    };
  }

  switch (st) {
    case "contrat_signe":
      return {
        step: 2,
        badge: "Contrat signé",
        badgeClass: BADGE_GREEN,
        title: "Financement Escrow — Fonds à sécuriser",
        message: "Contrat signé par les deux parties. Les fonds seront séquestrés chez notre prestataire de paiement agréé avant le démarrage — Flexwork ne détient jamais les fonds.",
      };
    case "fonds_sous_sequestre":
    case "en_cours":
      return client
        ? {
            step: 3,
            badge: "Séquestre actif — fonds bloqués",
            badgeClass: BADGE_GREEN,
            title: "Pilotage Jalons — Travail en cours",
            message: "Les fonds sont séquestrés et bloqués. Le prestataire réalise la prestation ; les fonds ne seront libérés qu'après votre validation de la livraison.",
          }
        : {
            step: 3,
            badge: "Séquestre actif — fonds bloqués",
            badgeClass: BADGE_GREEN,
            title: "Pilotage Jalons — Travail en cours",
            message: "Les fonds sont séquestrés et bloqués. Réalisez la prestation ; ils ne seront libérés qu'après la validation du livrable par le client.",
          };
    case "livrable_soumis":
      return client
        ? {
            step: 3,
            badge: "À valider",
            badgeClass: BADGE_AMBER,
            title: "Pilotage Jalons — Livrable à valider",
            message: "Un livrable a été soumis. Vérifiez les preuves fournies puis validez (libération du paiement) ou rejetez avec un motif.",
          }
        : {
            step: 3,
            badge: "En attente de validation",
            badgeClass: BADGE_AMBER,
            title: "Pilotage Jalons — Livrable soumis",
            message: "Votre livrable a été soumis et attend la validation du client. Tant que 100 % ne sont pas constatés, vous pouvez ajouter d'autres preuves via « Soumettre preuve » ; les fonds ne seront libérés qu'après sa validation finale.",
          };
    case "validee":
      return {
        step: 4,
        badge: "Paiement libéré",
        badgeClass: BADGE_GREEN,
        title: "Clôture — Paiement libéré",
        message: `Livraison validée — le paiement de ${money} a été libéré au prestataire.`,
      };
    case "cloturee":
      return {
        step: 4,
        badge: "Terminée",
        badgeClass: BADGE_DARK,
        title: "Clôture — Mission terminée",
        message: "Mission clôturée. Merci de laisser un avis pour renforcer la confiance de la communauté.",
      };
    case "mediation_ouverte":
      return {
        step: LITIGE_INDEX,
        badge: "Médiation en cours",
        badgeClass: BADGE_RED,
        title: "Litige — Médiation en cours",
        message: "Une médiation est ouverte sur cette mission. Les fonds restent bloqués jusqu'à résolution.",
      };
    default:
      // Statut non couvert : repli neutre sur "Pilotage Jalons", plutôt que de dépendre du
      // stepper de la page contrat (portée différente, hors périmètre de cette refonte).
      return {
        step: 3,
        badge: "En cours",
        badgeClass: BADGE_BLUE,
        title: "Mission — Suivi en cours",
        message: "La mission progresse. Les fonds restent sécurisés jusqu'à la validation finale.",
      };
  }
}

// État visuel d'une case du stepper. Le Litige (index 5) est une case À PART, jamais
// "atteinte" par simple progression séquentielle (i < step) : quand elle est active, Clôture
// (index 4) doit rester "à venir", pas "faite" — la mission n'est pas close tant que la
// médiation n'est pas résolue. Les 4 phases qui précèdent le pilotage restent, elles,
// correctement marquées "faites" pour situer où la médiation est survenue.
function phaseState(i: number, step: number): "done" | "active" | "todo" {
  if (step === LITIGE_INDEX) {
    if (i === LITIGE_INDEX) return "active";
    return i <= 3 ? "done" : "todo";
  }
  if (i < step) return "done";
  if (i === step) return "active";
  return "todo";
}

export default function MissionTracker({ missionId }: { missionId: string }) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [contract, setContract] = useState<Contract | null | undefined>(undefined);

  useEffect(() => {
    fetchDedupe(`/api/missions/${missionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) =>
        m &&
        setMission({
          id: m.id,
          titre: m.titre,
          status: m.status,
          currency: m.currency,
          budget: m.budget,
          contractPrice: m.contractPrice ?? null,
          isOwner: !!m.isOwner,
        })
      );
    fetchDedupe(`/api/missions/${missionId}/contract`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setContract(c ? { id: c.id, clientSignedAt: c.clientSignedAt ?? null, providerSignedAt: c.providerSignedAt ?? null } : null));
  }, [missionId]);

  if (!mission || contract === undefined) return null;

  const info = describe(mission, contract);
  const money = `${(mission.contractPrice ?? mission.budget).toLocaleString("fr-FR")} ${mission.currency}`;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden">
      {/* En-tête : phase + badge */}
      <div className="p-4 lg:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#E6F4EE] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#008751]" />
          </div>
          <div>
            <h2 className="text-[14px] lg:text-[15px] font-bold text-[#0f172a] leading-tight">{info.title}</h2>
            <p className="text-[11.5px] text-[#64748B] mt-0.5 font-mono truncate">
              {contract ? `Contrat ID: ${contract.id}` : `Mission ${mission.id}`} · {money}
            </p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${info.badgeClass}`}>{info.badge}</span>
      </div>

      {/* Message d'étape */}
      <div className="mx-4 lg:mx-5 mb-4 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#475569]">
        <strong className="text-[#0f172a]">{info.badge} — </strong>
        {info.message}
      </div>

      {/* Barre de progression à 6 phases : OFFRE & CANDIDATURE → SIGNATURE → FINANCEMENT
          ESCROW → PILOTAGE JALONS → CLÔTURE → LITIGE (case à part, rouge, jamais "faite"). */}
      <div className="px-4 lg:px-5 pb-4">
        <div className="flex gap-1.5">
          {MISSION_PHASES.map((label, i) => {
            const state = phaseState(i, info.step);
            const isLitige = i === LITIGE_INDEX;
            const barClass = state === "todo" ? "bg-[#E2E8F0]" : isLitige ? "bg-[#DC2626]" : "bg-[#008751]";
            const labelClass =
              state === "todo" ? "text-[#94A3B8]" : isLitige ? "text-[#DC2626]" : state === "active" ? "text-[#008751]" : "text-[#008751]/70";
            return (
              <div key={label} className="flex-1 min-w-0">
                <div className={`h-[6px] rounded-full transition ${barClass}`} />
                <div className={`mt-1.5 text-center text-[9.5px] font-bold uppercase tracking-wide truncate ${labelClass}`}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
