// Carte d'une mission publiée et de ses engagements (2026-11-11) — tableau de bord client. Une
// annonce et les engagements de ses prestataires retenus forment UNE carte
// (src/lib/annonce-groups.ts) : « 2/3 retenus » et candidatures totales. Le suivi détaillé de
// chaque retenu est sur Mes Missions et sur la page Candidatures.
import { Badge, MissionCard, type Tone } from "@/components/dashboard/proto-ui";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";

export type GroupCardEngagement = { id: string; status: string; providerName: string | null; progress: number };
export type GroupCardModel = {
  id: string;
  titre: string;
  domaine: string;
  ville: string | null;
  budget: number;
  currency: string;
  status: string;
  /** Candidatures reçues sur l'annonce ET déplacées sur ses engagements. */
  candidatures: number;
  /** Places recherchées (annonce) — null hors annonce. */
  places: number | null;
  progress: number;
  /** Livrable à valider sur la mission ou l'un de ses engagements. */
  toReview: boolean;
  engagements: GroupCardEngagement[];
  /** Échéance affichée dans l'en-tête (« J-14 », « Close »…) — Mes Missions. */
  deadline?: string | null;
  /** Référence courte (#ABC123) — Mes Missions. */
  showRef?: boolean;
};


function toneOf(status: string, toReview: boolean): Tone {
  if (toReview) return "warning";
  if (status === "mediation_ouverte") return "danger";
  if (status === "publiee") return "info";
  if (["brouillon", "remboursee", "annonce_close"].includes(status)) return "muted";
  return "success";
}
const labelOf = (status: string) => MISSION_STATUS_STYLE[status as keyof typeof MISSION_STATUS_STYLE]?.label ?? status;

export function MissionGroupCard({ m }: { m: GroupCardModel }) {
  const retenus = m.engagements.length;
  const isAnnonce = m.places !== null && (m.status === "publiee" || m.status === "annonce_close" || retenus > 0);
  return (
    <MissionCard
      href={`/missions/${m.id}/publique`}
      title={m.titre}
      category={m.domaine}
      place={m.ville}
      deadline={m.deadline ?? null}
      badges={
        <>
          <Badge tone={toneOf(m.status, m.toReview && retenus === 0)}>{labelOf(m.status)}</Badge>
          {isAnnonce && (
            <Badge tone={retenus >= (m.places ?? 1) ? "success" : "info"}>
              {retenus}/{m.places} retenu{retenus > 1 ? "s" : ""}
            </Badge>
          )}
          {m.toReview && <Badge tone="warning">Livrable à valider</Badge>}
          {m.showRef && <span className="text-[10px] text-[#9A93A8] font-mono self-center">#{m.id.slice(-6).toUpperCase()}</span>}
        </>
      }
      amount={`${m.budget.toLocaleString("fr-FR")} ${m.currency === "XOF" ? "FCFA" : m.currency}`}
      meta={`${m.candidatures} candidature${m.candidatures > 1 ? "s" : ""}`}
      progress={m.progress}
      secondary={{ href: `/missions/${m.id}/proposals`, label: "Candidatures" }}
    />
  );
}

/** Progression d'un groupe : moyenne des engagements s'il y en a, sinon celle de la mission. */
export function groupProgress(own: number, engagements: { progress: number }[]): number {
  if (engagements.length === 0) return own;
  return Math.round(engagements.reduce((s, e) => s + e.progress, 0) / engagements.length);
}
