"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, FileText, ScrollText } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { REVISION_REQUESTED_BADGE, REVISION_REQUESTED_LABEL } from "@/lib/proposal-status";
import {
  DEVIS_BUCKET_LABEL as DEVIS_BUCKET_LABEL_SHARED,
  CONTRAT_BUCKET_LABEL as CONTRAT_BUCKET_LABEL_SHARED,
  type DevisBucket as SharedDevisBucket,
  type ContratBucket as SharedContratBucket,
} from "@/lib/devis-contrats";

// Rubrique "Devis & Contrats" — accessible via le bloc sidebar "Documents Contractuels"
// (voir DashboardSidebar/DashboardLayout), même architecture de vue que OffresSection.tsx /
// CandidaturesSection.tsx (tuiles de stats, chips de filtre, cartes) pour rester cohérent
// avec le reste du dashboard plutôt que de reproduire littéralement la maquette Sidecar-
// Devis-Contrats-Signes-Vjr. Un seul composant partagé entre le dashboard client
// (/client/devis-contrats) et les 4 dashboards prestataire (/dashboard/<role>/devis-
// contrats) — GET /api/devis-contrats déduit lui-même le rôle de la session.

// Types et libellés viennent du module partagé (src/lib/devis-contrats.ts), qui sert déjà
// GET /api/devis-contrats : ils étaient redéclarés ici à l'identique.
type DevisBucket = SharedDevisBucket;
type ContratBucket = SharedContratBucket;

type DevisItem = {
  id: string;
  missionId: string;
  missionTitre: string;
  counterpartName: string;
  montant: number;
  currency: string;
  status: string;
  bucket: DevisBucket;
  // Le client a demandé une nouvelle version et le prestataire n'a pas encore resoumis.
  revisionPending?: boolean;
  createdAt: string;
};

type ContratItem = {
  id: string;
  missionId: string;
  missionTitre: string;
  counterpartName: string;
  montant: number;
  currency: string;
  hash: string;
  signedAt: string | null;
  missionStatus: string;
  bucket: ContratBucket;
  jalonsCount: number;
  createdAt: string;
};

type Payload = {
  devis: DevisItem[];
  contrats: ContratItem[];
  counts: { brouillon: number; negociation: number; valide: number; rejete: number; devisCloture: number; enCours: number; cloture: number };
};

const DEVIS_BUCKET_STYLE: Record<DevisBucket, string> = {
  brouillon: "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]",
  negociation: "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]",
  valide: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  rejete: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  // Même neutre gris que le « Clôturé » des contrats : c'est un état terminal, pas une alerte.
  cloture: "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]",
};
// Libellés repris du module partagé (src/lib/devis-contrats.ts) — ils étaient redéfinis ici
// à l'identique, avec le risque classique de divergence.
const DEVIS_BUCKET_LABEL = DEVIS_BUCKET_LABEL_SHARED;

const CONTRAT_BUCKET_STYLE: Record<ContratBucket, string> = {
  en_cours: "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  cloture: "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]",
};
const CONTRAT_BUCKET_LABEL = CONTRAT_BUCKET_LABEL_SHARED;

// Correspondance entre l'id de sous-rubrique du sidebar (?f=) et le bucket réel.
const DEVIS_FILTER_TO_BUCKET: Record<string, DevisBucket> = { brouillons: "brouillon", negociation: "negociation", valides: "valide", rejetes: "rejete", clotures: "cloture" };
const CONTRAT_FILTER_TO_BUCKET: Record<string, ContratBucket> = { "en-cours": "en_cours", clotures: "cloture" };

// L'état actif (tab/filtre) est dérivé de l'URL (?tab=&f=) via useSearchParams, pas d'un
// useState lu une seule fois au montage : ce composant reste monté d'une sous-rubrique du
// sidebar à l'autre (même route /dashboard/<role>/devis-contrats ou /client/devis-contrats,
// seule la query string change) — un état lu uniquement à l'effet initial resterait figé
// sur le premier clic. useSearchParams exige une frontière Suspense (Next 14 App Router) :
// isolée ici, dans le composant, pour que les 5 pages qui montent DevisContratsSection n'aient
// rien à changer.
export default function DevisContratsSection({ viewer }: { viewer: "client" | "provider" }) {
  return (
    <Suspense fallback={<div className="max-w-[1400px] w-full mx-auto text-[13px] text-gray-400">Chargement…</div>}>
      <DevisContratsSectionInner viewer={viewer} />
    </Suspense>
  );
}

function DevisContratsSectionInner({ viewer }: { viewer: "client" | "provider" }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: "devis" | "contrats" = searchParams.get("tab") === "contrats" ? "contrats" : "devis";
  const filter = searchParams.get("f") ?? "tous";

  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    fetchDedupe("/api/devis-contrats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const devisFilters = [
    { id: "tous", label: "Tous" },
    { id: "brouillons", label: "Brouillons", count: data?.counts.brouillon },
    { id: "negociation", label: "En négociation", count: data?.counts.negociation },
    { id: "valides", label: "Validés", count: data?.counts.valide },
    { id: "rejetes", label: "Rejetés", count: data?.counts.rejete },
    { id: "clotures", label: "Clôturés", count: data?.counts.devisCloture },
  ];
  const contratFilters = [
    { id: "tous", label: "Tous" },
    { id: "en-cours", label: "En cours", count: data?.counts.enCours },
    { id: "clotures", label: "Clôturés", count: data?.counts.cloture },
  ];

  const filteredDevis = useMemo(() => {
    const items = data?.devis ?? [];
    if (filter === "tous" || tab !== "devis") return items;
    const bucket = DEVIS_FILTER_TO_BUCKET[filter];
    return bucket ? items.filter((d) => d.bucket === bucket) : items;
  }, [data, filter, tab]);

  const filteredContrats = useMemo(() => {
    const items = data?.contrats ?? [];
    if (filter === "tous" || tab !== "contrats") return items;
    const bucket = CONTRAT_FILTER_TO_BUCKET[filter];
    return bucket ? items.filter((c) => c.bucket === bucket) : items;
  }, [data, filter, tab]);

  // "Voir" une négociation de devis : la vue existe déjà, mais diffère selon le rôle — le
  // prestataire a un espace de soumission dédié (/missions/[id]/devis), le client négocie
  // depuis la page mission elle-même (DevisPanel y est rendu inline).
  //
  // Un devis DÉFINITIF (validé, ou clôturé avec la mission) n'a plus rien à négocier : les
  // deux rôles vont à la même vue documentaire, exportable en PDF — l'équivalent de
  // /missions/[id]/contract un cran plus tôt dans la chaîne. Renvoyer le prestataire vers son
  // formulaire de chiffrage pour un prix déjà arrêté proposait une action qui n'existe plus.
  const devisHref = (d: DevisItem) => {
    if (d.bucket === "valide" || d.bucket === "cloture") return `/missions/${d.missionId}/devis/${d.id}`;
    return viewer === "provider" ? `/missions/${d.missionId}/devis` : `/missions/${d.missionId}`;
  };

  // Navigation par URL (?tab=&f=) plutôt que du state local : source unique avec les liens
  // du sidebar (DashboardSidebar), qui pointent vers ces mêmes query strings.
  function goTo(nextTab: "devis" | "contrats", nextFilter: string) {
    router.replace(`${pathname}?tab=${nextTab}&f=${nextFilter}`);
  }

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      <div>
        <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Devis & Contrats</h1>
        <p className="text-[13px] text-gray-500 mt-2">Tous tes devis en négociation et tes contrats signés, au même endroit.</p>
      </div>

      <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto border border-gray-100 shadow-sm w-fit max-w-full">
        {(
          [
            { id: "devis", label: "Devis", Icon: FileText },
            { id: "contrats", label: "Contrats Signés", Icon: ScrollText },
          ] as const
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => goTo(t.id, "tous")}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#0A1931] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
            >
              <t.Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto border border-gray-100 shadow-sm w-fit max-w-full">
        {(tab === "devis" ? devisFilters : contratFilters).map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => goTo(tab, f.id)}
              className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#FF7A00] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
            >
              {f.label} {typeof f.count === "number" && <span className={active ? "text-white/70" : "text-gray-400"}>{f.count}</span>}
            </button>
          );
        })}
      </div>

      {data === null ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : tab === "devis" ? (
        filteredDevis.length === 0 ? (
          <EmptyState icon="📄" title="Aucun devis pour ce filtre." />
        ) : (
          <div className="flex flex-col gap-3">
            {filteredDevis.map((d) => (
              <div key={d.id} className="bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Une révision en attente prime sur le libellé de sous-rubrique : le
                        bucket reste « négociation » (filtres/compteurs inchangés) mais la
                        ligne annonce l'action attendue, comme les autres vues de candidature. */}
                    <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${d.revisionPending ? REVISION_REQUESTED_BADGE : DEVIS_BUCKET_STYLE[d.bucket]}`}>
                      {d.revisionPending ? REVISION_REQUESTED_LABEL : DEVIS_BUCKET_LABEL[d.bucket]}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">#DEV-{d.id.slice(-6).toUpperCase()}</span>
                  </div>
                  <h3 className="font-bold text-[14px] mt-2 leading-snug">{d.missionTitre}</h3>
                  <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                    <span>{viewer === "client" ? "Prestataire" : "Client"} : {d.counterpartName}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full shrink-0" />
                    <span className="font-bold text-[#0A1931] shrink-0">{d.montant.toLocaleString("fr-FR")} {d.currency}</span>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {/* Devis DÉFINITIF (validé, ou clôturé avec la mission) : le chiffrage est
                      arrêté, il devient une pièce justificative. On l'ouvre et on l'exporte
                      en PDF comme le contrat — c'est le même document de référence, un cran
                      plus tôt dans la chaîne. Un devis encore en négociation n'a rien de
                      définitif à produire : le bouton n'apparaît pas. */}
                  {(d.bucket === "valide" || d.bucket === "cloture") && (
                    <a
                      href={`/api/missions/${d.missionId}/proposals/${d.id}/devis/document?format=pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ouvrir le devis définitif en PDF"
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 text-[12px] font-bold text-[#0A1931] transition"
                      style={{ textDecoration: "none" }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </a>
                  )}
                  <Link href={devisHref(d)} className="bg-[#0A1931] hover:bg-black text-white rounded-full px-5 py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                    Voir
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filteredContrats.length === 0 ? (
        <EmptyState icon="✒️" title="Aucun contrat pour ce filtre." />
      ) : (
        <div className="flex flex-col gap-3">
          {filteredContrats.map((c) => (
            <div key={c.id} className="bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${CONTRAT_BUCKET_STYLE[c.bucket]}`}>{CONTRAT_BUCKET_LABEL[c.bucket]}</span>
                  <span className="text-[10px] text-gray-400 font-mono">#CTR-{c.id.slice(-6).toUpperCase()}</span>
                  {c.jalonsCount > 0 && <span className="text-[10px] text-gray-400">{c.jalonsCount} jalon{c.jalonsCount > 1 ? "s" : ""}</span>}
                </div>
                <h3 className="font-bold text-[14px] mt-2 leading-snug">{c.missionTitre}</h3>
                <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                  <span>{viewer === "client" ? "Prestataire" : "Client"} : {c.counterpartName}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full shrink-0" />
                  <span className="font-bold text-[#0A1931] shrink-0">{c.montant.toLocaleString("fr-FR")} {c.currency}</span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full shrink-0" />
                  <span className="font-mono text-[11px] text-gray-400">{c.hash.slice(0, 10)}…</span>
                </div>
              </div>
              <Link href={`/missions/${c.missionId}/contract`} className="shrink-0 bg-[#0A1931] hover:bg-black text-white rounded-full px-5 py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                Voir
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
      <div className="text-[24px] mb-2">{icon}</div>
      <div className="font-bold text-[14px] text-[#0A1931]">{title}</div>
    </div>
  );
}
