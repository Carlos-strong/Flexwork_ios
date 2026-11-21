"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import {
  PROPOSAL_BADGE_STYLE,
  TRACKING_STEPS,
  summarizeProposals,
  trackProposal,
  type ProposalViewer,
  type TrackableProposal,
} from "@/lib/proposal-tracking";
import { personFullName } from "@/lib/person-name";

// État et suivi des candidatures, au TABLEAU DE BORD (2026-11-09).
//
// Jusqu'ici l'accueil n'affichait qu'un nombre (« Candidatures : N en cours » côté
// prestataire, « Propositions : N reçues » côté client). Cette carte donne, sans quitter
// l'accueil : la répartition par état, les candidatures qui attendent une action de
// l'utilisateur, et pour les plus récentes leur étape dans le parcours et la suite.
// Mêmes données et mêmes badges que les rubriques « Mes candidatures » / « Propositions »
// (src/lib/proposal-tracking.ts).

type Item = TrackableProposal & {
  id: string;
  createdAt: string;
  mission: {
    id: string;
    titre: string;
    status: string;
    client?: { firstname: string | null; lastname: string | null } | null;
  };
  provider?: { firstname: string | null; lastname: string | null } | null;
};

const SOURCE: Record<ProposalViewer, string> = {
  provider: "/api/dashboard/my-proposals",
  client: "/api/dashboard/client-proposals",
};

const MAX_ROWS = 5;


export function ApplicationsTrackingCard({ viewer, seeAllHref }: { viewer: ProposalViewer; seeAllHref: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDedupe(SOURCE[viewer])
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: Item[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [viewer]);

  const summary = useMemo(() => summarizeProposals(items ?? [], viewer), [items, viewer]);

  // Les plus utiles d'abord : celles qui attendent une action de l'utilisateur, puis les
  // candidatures encore en cours, puis les closes — chacune par date (l'API trie déjà par
  // date décroissante, et le tri est stable).
  const rows = useMemo(() => {
    const rank = (i: Item) => {
      const t = trackProposal(i, viewer);
      return t.actionRequired ? 0 : t.group === "close" ? 2 : 1;
    };
    return [...(items ?? [])].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_ROWS);
  }, [items, viewer]);

  const title = viewer === "provider" ? "Suivi de mes candidatures" : "Candidatures reçues";
  const tiles = [
    { key: "en_attente", label: viewer === "provider" ? "En attente" : "À examiner", value: summary.en_attente, tone: "text-[#1D4ED8]" },
    { key: "en_discussion", label: "En discussion", value: summary.en_discussion, tone: "text-[#854D0E]" },
    { key: "retenue", label: "Retenues", value: summary.retenue, tone: "text-[#047857]" },
    { key: "close", label: viewer === "provider" ? "Non retenues" : "Écartées", value: summary.close, tone: "text-[#B42318]" },
  ];

  return (
    <section aria-labelledby="applications-tracking-title" className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 id="applications-tracking-title" className="font-semibold text-[15px] text-[#191224]">
            {title}
          </h3>
          {items && summary.total > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#8B5CF6] text-white text-[10px] font-bold">{summary.total}</span>
          )}
        </div>
        <Link href={seeAllHref} className="shrink-0 text-[12px] font-medium text-[#6D28D9] hover:underline">
          Voir tout →
        </Link>
      </div>

      {failed ? (
        <div role="alert" className="px-5 py-8 text-center text-[13px] text-zinc-500">
          Le suivi des candidatures n&apos;a pas pu être chargé.
        </div>
      ) : !items ? (
        <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-zinc-500">
          {viewer === "provider"
            ? "Vous n'avez encore envoyé aucune candidature."
            : "Aucune candidature reçue pour le moment."}
        </div>
      ) : (
        <>
          {/* Répartition par état */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
            {tiles.map((t) => (
              <div key={t.key} className="bg-white px-4 py-3">
                <dt className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold">{t.label}</dt>
                <dd className={`text-[22px] font-bold ${t.tone}`}>{t.value}</dd>
              </div>
            ))}
          </dl>

          {summary.actionRequired > 0 && (
            <p role="status" className="mx-5 mt-4 px-3 py-2 rounded-xl bg-[#F0EAFF] border border-[#6D28D9]/25 text-[12.5px] font-medium text-[#9A3412]">
              {summary.actionRequired === 1
                ? "1 candidature attend votre action."
                : `${summary.actionRequired} candidatures attendent votre action.`}
            </p>
          )}

          {/* Dernières candidatures : étape et suite */}
          <ul className="divide-y divide-gray-50 mt-2">
            {rows.map((i) => {
              const t = trackProposal(i, viewer);
              const counterpart = viewer === "provider" ? (personFullName(i.mission.client) || "Client") : (personFullName(i.provider) || "Prestataire");
              return (
                <li key={i.id}>
                  <Link
                    href={`/missions/${i.mission.id}/proposals`}
                    className="block px-5 py-4 hover:bg-gray-50/50 transition-colors"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[#191224] truncate">{i.mission.titre}</div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {counterpart} • {new Date(i.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold border ${PROPOSAL_BADGE_STYLE[t.badge]}`}>
                        {t.badge}
                      </span>
                    </div>

                    {/* Étapes du parcours (une candidature close n'en a plus) */}
                    {t.step >= 0 && (
                      <div className="mt-2.5 flex items-center gap-3">
                        <ol className="flex flex-1 items-center gap-1" aria-label={`Étape ${t.step + 1} sur ${TRACKING_STEPS.length} : ${TRACKING_STEPS[t.step]}`}>
                          {TRACKING_STEPS.map((label, idx) => (
                            <li
                              key={label}
                              title={label}
                              className={`h-1.5 flex-1 rounded-full ${idx <= t.step ? "bg-[#4C1D95]" : "bg-gray-100"}`}
                            />
                          ))}
                        </ol>
                        <span aria-hidden className="shrink-0 text-[10.5px] font-medium text-zinc-400">
                          {TRACKING_STEPS[t.step]} · {t.step + 1}/{TRACKING_STEPS.length}
                        </span>
                      </div>
                    )}

                    <p className={`mt-2 text-[12px] ${t.actionRequired ? "font-semibold text-[#C2410C]" : "text-zinc-500"}`}>
                      {t.actionRequired && <span aria-hidden>→ </span>}
                      {t.next}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > MAX_ROWS && (
            <div className="px-5 py-3 border-t border-gray-50 text-[12px] text-zinc-500">
              {items.length - MAX_ROWS} autre{items.length - MAX_ROWS > 1 ? "s" : ""} —{" "}
              <Link href={seeAllHref} className="font-medium text-[#6D28D9] hover:underline">
                voir toutes les candidatures
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}
