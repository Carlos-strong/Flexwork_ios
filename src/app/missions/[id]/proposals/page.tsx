"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Avatar } from "@/components/avatar";
import { countryFlag } from "@/components/person-card";
import { DevisDetails, ValidateDevis, RequestRevision, RejectDevis, AcceptFixedPrice, Revisions, DevisPanel, FixedPricePanel, MissionFlowSteps } from "@/components/devis/devis-panel";
import { PROPOSAL_STATUS_LABEL, authorDisplayName, type DevisProposalPayload } from "@/components/devis/types";
import { isRevisionPending, REVISION_REQUESTED_BADGE, REVISION_REQUESTED_LABEL } from "@/lib/proposal-status";
import { canClientRequestRevision } from "@/lib/devis";
import { candidaturesHrefForRole } from "@/lib/role-dashboard";
import { fetchDedupe } from "@/lib/fetch-dedupe";

type MissionMeta = { budgetType: string | null; maxRevisionRounds: number; status: string; currency: string; titre: string };

const CONTRACT_TILE_LABEL: Record<string, string> = {
  contrat_genere: "Généré",
  contrat_signe: "Signé",
  fonds_sous_sequestre: "Signé",
  en_cours: "Signé",
  livrable_soumis: "Signé",
  validee: "Signé",
  cloturee: "Signé",
};
// Statuts mission indiquant qu'un contrat existe déjà — utilisé pour le filtre "Contrat
// signé" (voir plus bas) : pas un statut de MissionProposal (le devis gagnant reste
// "devis_valide", jamais "acceptee", dans ce parcours — voir POST .../devis/validate).
const CONTRACT_EXISTS_STATUSES = new Set(Object.keys(CONTRACT_TILE_LABEL));

const STATUS_BADGE: Record<string, string> = {
  envoyee: "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]",
  en_negociation: "bg-[#FEF3C7] text-[#D97706] border border-[#FDE68A]",
  devis_valide: "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]",
  acceptee: "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]",
  refusee: "bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA]",
  annulee_definitive: "bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]",
};

// Statut affiché en tenant compte de la négociation par révisions (2026-09-09) : tant qu'une
// révision est réellement en attente, on affiche « Révision demandée » au lieu du statut brut
// — signal visible d'une nouvelle version attendue, côté client comme prestataire. La règle
// (drapeau posé ET négociation non close) est partagée avec les sections « Mes candidatures »
// et « Propositions » : voir src/lib/proposal-status.ts.
function statusLabelFor(p: { status: string; revisionRequestedAt: string | null }): string {
  return isRevisionPending(p) ? REVISION_REQUESTED_LABEL : (PROPOSAL_STATUS_LABEL[p.status] ?? p.status);
}
function statusBadgeFor(p: { status: string; revisionRequestedAt: string | null }): string {
  return isRevisionPending(p) ? REVISION_REQUESTED_BADGE : (STATUS_BADGE[p.status] ?? "bg-[#F1F5F9] text-[#64748B]");
}

type FilterId = "all" | "en_negociation" | "devis_valide" | "refusee" | "contrat_signe";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "en_negociation", label: "En négociation" },
  { id: "devis_valide", label: "Devis validé" },
  { id: "refusee", label: "Refusée" },
  { id: "contrat_signe", label: "Contrat signé" },
];

function matchesFilter(p: DevisProposalPayload, filter: FilterId, missionStatus: string | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "contrat_signe") return p.status === "devis_valide" && !!missionStatus && CONTRACT_EXISTS_STATUSES.has(missionStatus);
  return p.status === filter;
}

// Statuts atteignables par une candidature prix fixe/taux — jamais devis_valide (réservé au
// mode devis, l'acceptation finale prix fixe passe par .../accept, voir le commentaire dans
// src/components/devis/devis-panel.tsx au-dessus de FixedPricePanel). "en_negociation" y
// figure depuis l'introduction de la négociation par rounds (2026-08-29, voir POST
// /api/missions/[id]/proposals) : round 1 reste "envoyee", round 2+ passe par là.
type FixedFilterId = "all" | "envoyee" | "en_negociation" | "acceptee" | "refusee";
const FIXED_FILTERS: { id: FixedFilterId; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "envoyee", label: "Envoyées" },
  { id: "en_negociation", label: "En négociation" },
  { id: "acceptee", label: "Acceptée" },
  { id: "refusee", label: "Refusées" },
];
function matchesFixedFilter(p: DevisProposalPayload, filter: FixedFilterId): boolean {
  return filter === "all" || p.status === filter;
}

// Gestion des propositions reçues — réservé au client propriétaire de la mission.
// Les deux modes (devis QUOTE et prix fixe/taux) partagent maintenant le même modèle de
// vue — tableau récapitulatif (desktop) / cartes (mobile) + tiroir de détail façon Offre-
// Soumise-Vue-Voir-Devis.html — chacun adapté à ses propres champs et contraintes :
//   - Mode devis : devisData (jalons, délai, TTC), rounds de négociation, actions
//     accepter/réviser/rejeter un devis précis (voir DevisDetails/ValidateDevis/
//     RequestRevision/RejectDevis, src/components/devis/devis-panel.tsx).
//   - Mode prix fixe/taux : montant + message simples, un seul statut atteignable en dehors
//     de "envoyee" (accepter LA candidature refuse automatiquement les autres — voir
//     src/lib/accept-proposal.ts), donc pas de filtre "négociation"/"devis validé", pas de
//     colonne délai/jalons, pas de timeline de révisions.
// Avant ce correctif, le mode prix fixe/taux gardait une UI historique à base de classes
// CSS globales (.card, .btn-primary, style={{}} inline) sans rapport avec le système de
// design utilisé partout ailleurs (Tailwind, palette #0f172a/#E2E8F0/#008751) — deux
// expériences visuellement incohérentes pour la même action côté client.
export default function ProposalsPage() {
  const params = useParams();
  const missionId = params.id as string;
  // Page rôle-aware (2026-09-03) : le client propriétaire gère TOUTES les propositions reçues
  // (ci-dessous) ; un PRESTATAIRE arrivant ici (bouton « Voir » du dashboard candidatures)
  // voit SA candidature dans le même modèle — l'API ne renvoie que sa candidature.
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isProvider = !!role && role !== "client";

  const [proposals, setProposals] = useState<DevisProposalPayload[] | null>(null);
  const [missionMeta, setMissionMeta] = useState<MissionMeta | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("all");
  const [fixedFilter, setFixedFilter] = useState<FixedFilterId>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isQuote = missionMeta?.budgetType === "QUOTE";

  async function load() {
    const res = await fetchDedupe(`/api/missions/${missionId}/proposals`);
    if (res.ok) {
      const d = await res.json();
      setProposals(d.items ?? []);
      setMissionMeta(d.mission ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [missionId]);

  if (loading) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;

  // ── Mode PRESTATAIRE : même modèle que la vue client, vue « Ma candidature » ──
  // Déviations assumées (règle R03) : une seule candidature (la sienne), statut réel,
  // panneau de négociation PREstataire (DevisPanel/FixedPricePanel, isClient=false) —
  // resoumission quand le client a demandé une révision, historique des rounds.
  if (isProvider) {
    const mine = (proposals ?? [])[0] ?? null;
    const backHref = candidaturesHrefForRole(role as Parameters<typeof candidaturesHrefForRole>[0]);
    return (
      <div className="max-w-[900px] mx-auto px-4 lg:px-6 py-5 space-y-4 text-[#0f172a]">
        <div className="text-xs text-[#64748B]">
          <Link href={`/missions/${missionId}`} style={{ textDecoration: "none" }} className="hover:text-[#0f172a]">Mission</Link> › Ma candidature
        </div>

        {!missionMeta || proposals === null ? (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-10 text-center text-[13px] text-[#64748B]">Chargement…</div>
        ) : !mine ? (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-12 text-center">
            <p className="text-[14px] text-[#64748B]">Vous n&apos;avez pas candidaté à cette mission.</p>
            <Link href={backHref} className="mt-4 inline-block text-[13px] text-[#008751] font-semibold" style={{ textDecoration: "none" }}>← Retour à mes candidatures</Link>
          </div>
        ) : (
          <>
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-[18px] lg:text-[20px] font-bold leading-tight">{missionMeta.titre}</h1>
                  <p className="text-[12px] text-[#64748B] mt-1">
                    Votre candidature envoyée le {new Date(mine.createdAt).toLocaleDateString("fr-FR")} — suivez la négociation et répondez aux demandes de révision.
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeFor(mine)}`}>{statusLabelFor(mine)}</span>
              </div>
            </div>

            {isQuote ? (
              <DevisPanel missionId={missionId} maxRounds={missionMeta.maxRevisionRounds ?? 3} proposal={mine} isClient={false} onChanged={load} currency={missionMeta.currency} />
            ) : (
              <FixedPricePanel missionId={missionId} maxRounds={missionMeta.maxRevisionRounds ?? 3} proposal={mine} isClient={false} onChanged={load} currency={missionMeta.currency} />
            )}

            <div>
              <Link href={backHref} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
                ← Retour à mes candidatures
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  const totalOffresEnvoyees = (proposals ?? []).reduce((s, p) => s + (p.offersSent ?? 0), 0);
  const contractLabel = missionMeta ? (CONTRACT_TILE_LABEL[missionMeta.status] ?? "À signer") : "—";
  const currency = missionMeta?.currency ?? "XOF";
  const openProposal = proposals?.find((p) => p.id === openId) ?? null;

  // ── Mode devis (QUOTE) — tableau + tiroir façon Offre-Soumise-Vue-Voir-Devis ──
  if (isQuote) {
    const filtered = (proposals ?? []).filter((p) => matchesFilter(p, filter, missionMeta?.status));

    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-5 space-y-4">
          <div className="text-xs text-[#64748B]">
            <Link href={`/missions/${missionId}`} style={{ textDecoration: "none" }} className="hover:text-[#0f172a]">Mission</Link> › Candidatures
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-[20px] lg:text-[24px] font-bold">Offres de candidatures — {proposals?.length ?? 0} reçue{(proposals?.length ?? 0) > 1 ? "s" : ""}</h1>
              <p className="text-sm text-[#64748B] mt-1">Cliquez sur <b>Voir</b> pour ouvrir l&apos;offre soumise avec le devis détaillé.</p>
            </div>
          </div>

          {feedback && <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{feedback}</div>}

          {/* Filtres */}
          <div className="flex gap-2 overflow-auto" style={{ scrollbarWidth: "none" }}>
            {FILTERS.map((f) => {
              const count = (proposals ?? []).filter((p) => matchesFilter(p, f.id, missionMeta?.status)).length;
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${active ? "bg-[#0f172a] text-white" : "bg-white border border-[#E2E8F0] text-[#475569]"}`}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Table récap (desktop) / cartes (mobile) */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-[#64748B]">Aucune candidature dans ce filtre.</p>
            ) : (
              <>
                <div className="hidden lg:block overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                        <th className="text-left py-3 px-4 font-semibold">Artisan</th>
                        <th className="text-left py-3 px-3 font-semibold">Soumission</th>
                        <th className="text-right py-3 px-3 font-semibold">Montant TTC</th>
                        <th className="text-left py-3 px-3 font-semibold">Délai</th>
                        <th className="text-center py-3 px-3 font-semibold">Jalons</th>
                        <th className="text-left py-3 px-3 font-semibold">Statut</th>
                        <th className="text-right py-3 px-4 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => {
                        const initials = authorDisplayName(p.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
                        return (
                          <tr key={p.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAF9] group last:border-0">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initials} size={32} gradient="from-[#0f172a] to-[#334155]" />
                                <div>
                                  <div className="font-medium text-[13px] flex items-center gap-1.5">
                                    {authorDisplayName(p.provider)} {p.provider.country && <span>{countryFlag(p.provider.country)}</span>}
                                    {p.averageRating != null && (
                                      <span className="text-[11px] text-[#64748B]"><span className="text-[#F7C948]">★</span> {p.averageRating.toFixed(1)}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-xs text-[#64748B]">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</td>
                            <td className="py-3 px-3 text-right font-semibold text-[13px]">{p.devisData ? `${p.devisData.totalTTC.toLocaleString("fr-FR")} ${currency}` : "—"}</td>
                            <td className="py-3 px-3 text-xs">{p.devisData?.delay ?? "—"}</td>
                            <td className="py-3 px-3 text-center"><span className="px-2 py-0.5 rounded-full bg-[#F1F5F9] border border-[#E2E8F0] text-[11px]">{p.devisData?.lineItems.length ?? 0} jalon{(p.devisData?.lineItems.length ?? 0) > 1 ? "s" : ""}</span></td>
                            <td className="py-3 px-3"><span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeFor(p)}`}>{statusLabelFor(p)}</span></td>
                            <td className="py-3 px-4 text-right">
                              <button onClick={() => setOpenId(p.id)} className="h-8 px-3 rounded-lg bg-[#0f172a] text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition">👁 Voir</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="lg:hidden divide-y divide-[#F1F5F9]">
                  {filtered.map((p) => {
                    const initials = authorDisplayName(p.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
                    return (
                      <div key={p.id} className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initials} size={36} gradient="from-[#0f172a] to-[#334155]" />
                            <div>
                              <div className="font-medium text-sm">
                                {authorDisplayName(p.provider)} {p.provider.country && <span>{countryFlag(p.provider.country)}</span>}
                                {p.averageRating != null && <span className="text-xs text-[#64748B]"> <span className="text-[#F7C948]">★</span> {p.averageRating.toFixed(1)}</span>}
                              </div>
                              <div className="text-[11px] text-[#64748B]">{new Date(p.createdAt).toLocaleDateString("fr-FR")} • {p.devisData?.delay ?? "—"}</div>
                            </div>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeFor(p)}`}>{statusLabelFor(p)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <div className="text-sm">
                            <span className="font-bold">{p.devisData ? `${p.devisData.totalTTC.toLocaleString("fr-FR")} ${currency}` : "—"}</span>
                            <span className="text-xs text-[#64748B] ml-2">{p.devisData?.lineItems.length ?? 0} jalons</span>
                          </div>
                          <button onClick={() => setOpenId(p.id)} className="h-9 px-4 rounded-lg bg-[#008751] text-white text-sm font-medium">Voir le devis</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
            ← Retour au détail de la mission
          </Link>
        </div>

        {/* Tiroir "Voir" */}
        {openProposal && (
          <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpenId(null)} />
            <div className="absolute right-0 top-0 h-full w-full lg:w-[620px] bg-[#F8FAF9] shadow-2xl flex flex-col">
              <div className="h-[64px] bg-white border-b border-[#E2E8F0] flex items-center justify-between px-5 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => setOpenId(null)} className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center shrink-0">✕</button>
                  <div className="min-w-0">
                    <div className="text-[11px] tracking-widest text-[#64748B] uppercase font-semibold">Offre soumise</div>
                    <div className="font-semibold text-sm truncate">{authorDisplayName(openProposal.provider)} {openProposal.provider.country && countryFlag(openProposal.provider.country)} — {openProposal.devisData ? `${openProposal.devisData.totalTTC.toLocaleString("fr-FR")} ${currency}` : "—"}</div>
                  </div>
                  <span className={`ml-2 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${statusBadgeFor(openProposal)}`}>{statusLabelFor(openProposal)}</span>
                </div>
                {openProposal.devisData && (
                  <button onClick={() => setPreviewOpen(true)} className="h-8 px-3 rounded-lg bg-[#0f172a] text-white text-xs flex items-center gap-1 shrink-0">👁 Aperçu</button>
                )}
              </div>

              <div className="flex-1 overflow-auto">
                <div className="p-5 space-y-4">
                  {/* Candidat */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <Avatar src={openProposal.provider.avatarPath ? `/api/users/${openProposal.provider.id}/avatar` : null} initials={authorDisplayName(openProposal.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?"} size={48} gradient="from-[#0f172a] to-[#334155]" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{authorDisplayName(openProposal.provider)} {openProposal.provider.country && countryFlag(openProposal.provider.country)}</span>
                          {openProposal.averageRating != null && (
                            <span className="text-xs text-[#64748B]"><span className="text-[#F7C948]">★</span> {openProposal.averageRating.toFixed(1)}</span>
                          )}
                        </div>
                        <div className="text-xs text-[#64748B] mt-0.5">Candidature reçue le {new Date(openProposal.createdAt).toLocaleDateString("fr-FR")} • Round {openProposal.roundActuel}/{missionMeta?.maxRevisionRounds ?? 3}</div>
                      </div>
                      <Link href={`/profil/${openProposal.provider.id}?missionId=${missionId}`} className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white text-xs font-medium shrink-0" style={{ textDecoration: "none" }}>Voir profil</Link>
                    </div>
                    {openProposal.devisData?.notes && (
                      <div className="mt-3 text-sm text-[#475569] bg-[#F8FAF9] border border-[#E2E8F0] rounded-lg p-3 leading-relaxed whitespace-pre-wrap">{openProposal.devisData.notes}</div>
                    )}
                  </div>

                  {/* Devis détaillé */}
                  {openProposal.devisData ? (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm">Devis détaillé</h3>
                        <span className="text-[11px] text-[#64748B]">Round {openProposal.roundActuel} • max {missionMeta?.maxRevisionRounds ?? 3} rounds</span>
                      </div>
                      <DevisDetails devis={openProposal.devisData} currency={currency} />
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#64748B]">
                        {openProposal.devisData.delay && <span className="px-2 py-1 rounded-full bg-[#F1F5F9] border border-[#E2E8F0]">Délai {openProposal.devisData.delay}</span>}
                        <span className="px-2 py-1 rounded-full bg-[#E6F4EE] border border-[#A7F3D0] text-[#008751]">Exclusivité bloquée</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-[#64748B]">Aucun devis soumis pour le moment.</p>
                  )}

                  {/* Timeline négociation */}
                  {openProposal.revisions.length > 0 && (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                      <h4 className="font-semibold text-sm mb-3">Négociation — Round {openProposal.roundActuel}/{missionMeta?.maxRevisionRounds ?? 3}</h4>
                      <div className="space-y-3">
                        {openProposal.revisions.map((rev) => (
                          <div key={rev.id} className="flex gap-3">
                            <div className="w-6 h-6 rounded-full bg-[#008751] text-white flex items-center justify-center text-[10px] shrink-0">{rev.roundNumber}</div>
                            <div className="text-xs">
                              <div className="font-medium">Devis soumis par {authorDisplayName(rev.author)}</div>
                              <div className="text-[#64748B]">{new Date(rev.createdAt).toLocaleString("fr-FR")} • {rev.devisData.lineItems.length} jalons • {rev.devisData.totalTTC.toLocaleString("fr-FR")} {currency} TTC</div>
                            </div>
                          </div>
                        ))}
                        {openProposal.status === "en_negociation" && (
                          <div className="flex gap-3 opacity-50">
                            <div className="w-6 h-6 rounded-full border border-[#E2E8F0] flex items-center justify-center text-[10px] shrink-0">•</div>
                            <div className="text-xs">
                              <div>En attente de votre réponse</div>
                              <div className="text-[#64748B]">Accepter, proposer une révision, ou rejeter</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pièces jointes — aucun mécanisme d'envoi de fichier avec un devis
                      n'existe (POST /api/missions/[id]/devis n'accepte pas de fichier),
                      état honnête plutôt que des noms inventés. */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                    <h4 className="font-semibold text-sm mb-2">Pièces jointes</h4>
                    <p className="text-[12px] text-[#94A3B8] italic">Aucune pièce jointe pour ce devis.</p>
                  </div>
                </div>
              </div>

              {/* Pied de tiroir */}
              {openProposal.status === "en_negociation" ? (
                <div className="bg-white border-t border-[#E2E8F0] p-4 flex flex-col sm:flex-row gap-2 shrink-0">
                  <RejectDevis missionId={missionId} proposalId={openProposal.id} onRejected={load} />
                  <RequestRevision missionId={missionId} proposalId={openProposal.id} onRequested={load} />
                  <ValidateDevis missionId={missionId} proposalId={openProposal.id} onValidated={load} />
                </div>
              ) : (
                <div className="bg-white border-t border-[#E2E8F0] p-4 shrink-0 text-[13px] text-[#64748B]">
                  {openProposal.status === "refusee" ? (
                    <>Refusé{openProposal.devisRejectionReason && <> — motif : {openProposal.devisRejectionReason}</>}</>
                  ) : openProposal.status === "devis_valide" ? (
                    /* Devis validé = prestataire retenu : on enchaîne sur les étapes réelles
                       de la mission plutôt que de renvoyer le client se débrouiller ailleurs. */
                    <MissionFlowSteps missionId={missionId} missionStatus={missionMeta?.status} />
                  ) : (
                    statusLabelFor(openProposal)
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Aperçu — écran uniquement, aucun PDF généré */}
        {previewOpen && openProposal?.devisData && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 lg:p-8">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewOpen(false)} />
            <div className="relative mx-auto max-w-[900px] w-full bg-white rounded-2xl max-h-[90vh] overflow-auto p-8">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-30deg] text-[32px] font-extrabold text-black/[0.06] whitespace-nowrap pointer-events-none">BROUILLON — NON CONTRACTUEL</div>
              <div className="relative">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest text-[#64748B]">Devis</div>
                    <div className="font-bold text-lg">{authorDisplayName(openProposal.provider)} {openProposal.provider.country && countryFlag(openProposal.provider.country)}</div>
                    <div className="text-xs text-[#64748B]">Round {openProposal.roundActuel} • {new Date(openProposal.createdAt).toLocaleDateString("fr-FR")}</div>
                  </div>
                  <button onClick={() => setPreviewOpen(false)} className="w-8 h-8 rounded-lg border border-[#E2E8F0]">✕</button>
                </div>
                <div className="mt-6">
                  <DevisDetails devis={openProposal.devisData} currency={currency} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Mode prix fixe / taux — même modèle de vue que le mode devis ci-dessus ──
  const fixedFiltered = (proposals ?? []).filter((p) => matchesFixedFilter(p, fixedFilter));

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[1200px] mx-auto px-4 lg:px-6 py-5 space-y-4">
        <div className="text-xs text-[#64748B]">
          <Link href={`/missions/${missionId}`} style={{ textDecoration: "none" }} className="hover:text-[#0f172a]">Mission</Link> › Candidatures
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[20px] lg:text-[24px] font-bold">Candidatures reçues — {proposals?.length ?? 0} reçue{(proposals?.length ?? 0) > 1 ? "s" : ""}</h1>
            <p className="text-sm text-[#64748B] mt-1">
              {totalOffresEnvoyees > 0 && <>{totalOffresEnvoyees} offre{totalOffresEnvoyees > 1 ? "s" : ""} formelle{totalOffresEnvoyees > 1 ? "s" : ""} envoyée{totalOffresEnvoyees > 1 ? "s" : ""} · </>}
              Contrat : {contractLabel}. Cliquez sur <b>Voir</b> pour ouvrir la candidature.
            </p>
          </div>
        </div>

        {feedback && <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{feedback}</div>}

        {/* Filtres */}
        <div className="flex gap-2 overflow-auto" style={{ scrollbarWidth: "none" }}>
          {FIXED_FILTERS.map((f) => {
            const count = (proposals ?? []).filter((p) => matchesFixedFilter(p, f.id)).length;
            const active = fixedFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFixedFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${active ? "bg-[#0f172a] text-white" : "bg-white border border-[#E2E8F0] text-[#475569]"}`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Table récap (desktop) / cartes (mobile) */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          {fixedFiltered.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-[#64748B]">
              {proposals?.length === 0 ? "Aucune candidature reçue pour cette mission." : "Aucune candidature dans ce filtre."}
            </p>
          ) : (
            <>
              <div className="hidden lg:block overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                      <th className="text-left py-3 px-4 font-semibold">Candidat</th>
                      <th className="text-left py-3 px-3 font-semibold">Soumission</th>
                      <th className="text-right py-3 px-3 font-semibold">Montant</th>
                      <th className="text-left py-3 px-3 font-semibold">Message</th>
                      <th className="text-left py-3 px-3 font-semibold">Statut</th>
                      <th className="text-right py-3 px-4 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixedFiltered.map((p) => {
                      const initials = authorDisplayName(p.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
                      return (
                        <tr key={p.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAF9] group last:border-0">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initials} size={32} gradient="from-[#0f172a] to-[#334155]" />
                              <div>
                                <div className="font-medium text-[13px] flex items-center gap-1.5">
                                  {authorDisplayName(p.provider)} {p.provider.country && <span>{countryFlag(p.provider.country)}</span>}
                                  {p.averageRating != null && (
                                    <span className="text-[11px] text-[#64748B]"><span className="text-[#F7C948]">★</span> {p.averageRating.toFixed(1)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-[#64748B]">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</td>
                          <td className="py-3 px-3 text-right font-semibold text-[13px]">{p.montant.toLocaleString("fr-FR")} {currency}</td>
                          <td className="py-3 px-3 text-xs text-[#64748B] max-w-[220px] truncate">{p.message || "—"}</td>
                          <td className="py-3 px-3"><span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeFor(p)}`}>{statusLabelFor(p)}</span></td>
                          <td className="py-3 px-4 text-right">
                            <button onClick={() => setOpenId(p.id)} className="h-8 px-3 rounded-lg bg-[#0f172a] text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition">👁 Voir</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="lg:hidden divide-y divide-[#F1F5F9]">
                {fixedFiltered.map((p) => {
                  const initials = authorDisplayName(p.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
                  return (
                    <div key={p.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <Avatar src={p.provider.avatarPath ? `/api/users/${p.provider.id}/avatar` : null} initials={initials} size={36} gradient="from-[#0f172a] to-[#334155]" />
                          <div>
                            <div className="font-medium text-sm">
                              {authorDisplayName(p.provider)} {p.provider.country && <span>{countryFlag(p.provider.country)}</span>}
                              {p.averageRating != null && <span className="text-xs text-[#64748B]"> <span className="text-[#F7C948]">★</span> {p.averageRating.toFixed(1)}</span>}
                            </div>
                            <div className="text-[11px] text-[#64748B]">{new Date(p.createdAt).toLocaleDateString("fr-FR")}</div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeFor(p)}`}>{statusLabelFor(p)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="font-bold text-sm">{p.montant.toLocaleString("fr-FR")} {currency}</span>
                        <button onClick={() => setOpenId(p.id)} className="h-9 px-4 rounded-lg bg-[#008751] text-white text-sm font-medium">Voir la candidature</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>

      {/* Tiroir "Voir" — même structure que le tiroir devis, sans devisData/rounds/révisions
          (contraintes propres au mode prix fixe/taux : une candidature = un seul montant,
          jamais de négociation). */}
      {openProposal && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpenId(null)} />
          <div className="absolute right-0 top-0 h-full w-full lg:w-[620px] bg-[#F8FAF9] shadow-2xl flex flex-col">
            <div className="h-[64px] bg-white border-b border-[#E2E8F0] flex items-center justify-between px-5 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => setOpenId(null)} className="w-8 h-8 rounded-lg border border-[#E2E8F0] flex items-center justify-center shrink-0">✕</button>
                <div className="min-w-0">
                  <div className="text-[11px] tracking-widest text-[#64748B] uppercase font-semibold">Candidature</div>
                  <div className="font-semibold text-sm truncate">{authorDisplayName(openProposal.provider)} {openProposal.provider.country && countryFlag(openProposal.provider.country)} — {openProposal.montant.toLocaleString("fr-FR")} {currency}</div>
                </div>
                <span className={`ml-2 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${statusBadgeFor(openProposal)}`}>{statusLabelFor(openProposal)}</span>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <div className="p-5 space-y-4">
                {/* Candidat */}
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={openProposal.provider.avatarPath ? `/api/users/${openProposal.provider.id}/avatar` : null} initials={authorDisplayName(openProposal.provider).split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?"} size={48} gradient="from-[#0f172a] to-[#334155]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{authorDisplayName(openProposal.provider)} {openProposal.provider.country && countryFlag(openProposal.provider.country)}</span>
                        {openProposal.averageRating != null && (
                          <span className="text-xs text-[#64748B]"><span className="text-[#F7C948]">★</span> {openProposal.averageRating.toFixed(1)}</span>
                        )}
                      </div>
                      <div className="text-xs text-[#64748B] mt-0.5">
                        Candidature reçue le {new Date(openProposal.createdAt).toLocaleDateString("fr-FR")}
                        {(openProposal.offersSent ?? 0) > 0 && <> • {openProposal.offersSent} offre{(openProposal.offersSent ?? 0) > 1 ? "s" : ""} formelle{(openProposal.offersSent ?? 0) > 1 ? "s" : ""} envoyée{(openProposal.offersSent ?? 0) > 1 ? "s" : ""}</>}
                      </div>
                    </div>
                    <Link href={`/profil/${openProposal.provider.id}?missionId=${missionId}`} className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white text-xs font-medium shrink-0" style={{ textDecoration: "none" }}>Voir profil</Link>
                  </div>
                  {openProposal.message && (
                    <div className="mt-3 text-sm text-[#475569] bg-[#F8FAF9] border border-[#E2E8F0] rounded-lg p-3 leading-relaxed whitespace-pre-wrap">{openProposal.message}</div>
                  )}
                </div>

                {/* Montant proposé — pendant de "Devis détaillé" côté QUOTE, réduit à ce
                    que ce mode porte réellement (un seul montant, pas de jalons), mais avec
                    le même round tracker : la négociation prix fixe/taux suit désormais le
                    même modèle par rounds que le devis (voir POST /api/missions/[id]/
                    proposals et FixedPricePanel, src/components/devis/devis-panel.tsx). */}
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">Montant proposé</h3>
                    <span className="text-[11px] text-[#64748B]">Round {openProposal.roundActuel} • max {missionMeta?.maxRevisionRounds ?? 3} rounds</span>
                  </div>
                  <div className="text-[22px] font-bold text-[#008751]">{openProposal.montant.toLocaleString("fr-FR")} {currency}</div>
                </div>

                {openProposal.revisionRequestedAt && (
                  <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[12.5px] text-[#1E40AF]">
                    Révision demandée le {new Date(openProposal.revisionRequestedAt).toLocaleDateString("fr-FR")}
                    {openProposal.revisionRequestMessage && <> — « {openProposal.revisionRequestMessage} »</>}
                    {" "}— en attente d&apos;un nouveau prix du prestataire.
                  </div>
                )}

                <Revisions revisions={openProposal.revisions} />
              </div>
            </div>

            {/* Pied de tiroir — mêmes actions que le mode devis (statut "ouvert" =
                envoyee/en_negociation, voir OPEN_NEGOTIATION_STATUSES dans src/lib/devis.ts),
                sauf l'acceptation qui passe par AcceptFixedPrice (.../accept) et non
                ValidateDevis (.../devis/validate, réservé au mode QUOTE — voir le commentaire
                dans devis-panel.tsx). "Demander une révision" est en plus gardé par
                canClientRequestRevision (exige devisData) : quelques candidatures créées
                avant l'introduction de ce modèle de négociation (2026-08-29) n'en ont pas —
                sans cette garde, le bouton s'affichait quand même et l'API renvoyait 409
                "cannot_request_revision" au clic, sans qu'aucun message n'explique pourquoi. */}
            {openProposal.status === "envoyee" || openProposal.status === "en_negociation" ? (
              <div className="bg-white border-t border-[#E2E8F0] p-4 flex flex-col sm:flex-row gap-2 shrink-0">
                <RejectDevis missionId={missionId} proposalId={openProposal.id} onRejected={load} />
                {canClientRequestRevision({
                  hasDevis: !!openProposal.devisData,
                  status: openProposal.status as Parameters<typeof canClientRequestRevision>[0]["status"],
                  revisionAlreadyRequested: !!openProposal.revisionRequestedAt,
                }) && <RequestRevision missionId={missionId} proposalId={openProposal.id} onRequested={load} />}
                <AcceptFixedPrice missionId={missionId} proposalId={openProposal.id} onAccepted={() => { setOpenId(null); load(); }} />
              </div>
            ) : (
              <div className="bg-white border-t border-[#E2E8F0] p-4 shrink-0 text-[13px] text-[#64748B]">
                {openProposal.status === "acceptee" ? (
                  /* Même enchaînement qu'en mode devis (voir MissionFlowSteps). */
                  <MissionFlowSteps missionId={missionId} missionStatus={missionMeta?.status} />
                ) : openProposal.status === "refusee" ? (
                  <>Refusée{openProposal.devisRejectionReason && <> — motif : {openProposal.devisRejectionReason}</>}</>
                ) : (
                  statusLabelFor(openProposal)
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
