"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ForbiddenNotice, PublishBar } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";
import type { FrontendModule } from "@/lib/frontend-modules";

type Overview = {
  modules: FrontendModule[];
  release: {
    version: number;
    publishedAt: string;
    note: string | null;
    publishedBy: { firstname: string | null; lastname: string | null; email: string } | null;
  } | null;
  releaseCount: number;
  counts: {
    categories: number;
    metiers: number;
    services: number;
    sections: Record<string, number>;
    sectionsTotal: number;
    sectionItems: number;
    menuItems: number;
    menusKnown: number;
    pages: number;
    pagesKnown: number;
    settings: number;
  };
};

// Lien de l'écran de la console qui pilote chaque module actif. Vide = le module est piloté
// par cette page même.
const MODULE_ROUTES: Record<string, string> = {
  taxonomie: "/backoffice/catalog",
  accueil: "/backoffice/content/accueil",
  menus: "/backoffice/content/menus",
  pages: "/backoffice/content/pages",
  seo: "/backoffice/settings",
  parametres: "/backoffice/settings",
  versions: "/backoffice/content/versions",
  logs: "/admin/audit",
};

// Vue d'ensemble de la console.
//
// Elle répond à une question précise : que pilote réellement cette administration ? Les
// vingt-deux modules des maquettes y figurent tous, les neuf qui fonctionnent comme les treize
// qui n'existent pas — ces derniers avec le motif de leur absence plutôt qu'un écran vide qui
// laisserait croire à une panne. Les compteurs sont mesurés en base ; aucun n'est décoratif.
export default function FrontendOverviewPage() {
  const readOnly = useIsReadOnly("contenu");
  const [data, setData] = useState<Overview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/overview");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (res.ok) setData(await res.json());
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (forbidden) return <ForbiddenNotice />;
  if (!data) return <p className="text-[13px] text-[#9C9A95]">Chargement…</p>;

  const active = data.modules.filter((m) => m.state === "actif");
  const absent = data.modules.filter((m) => m.state === "absent");

  const metrics: { label: string; value: string; detail: string }[] = [
    {
      label: "Catégories",
      value: String(data.counts.categories),
      detail: `${data.counts.metiers} métiers · ${data.counts.services} services`,
    },
    {
      label: "Sections d’accueil",
      value: `${data.counts.sectionsTotal}`,
      detail: `${data.counts.sections.publie ?? 0} visibles · ${data.counts.sectionItems} entrées`,
    },
    {
      label: "Entrées de menu",
      value: String(data.counts.menuItems),
      detail: `réparties sur ${data.counts.menusKnown} menus`,
    },
    {
      label: "Pages éditoriales",
      value: `${data.counts.pages}/${data.counts.pagesKnown}`,
      detail: "entrées / routes publiques servies",
    },
  ];

  return (
    <>
      <AdminPageHeader
        icon="🖼️"
        title="Contenu du site"
        subtitle="Sections d’accueil, menus, référencement. Toute modification reste en brouillon jusqu’à une publication, qui fige une version et devient ce que sert /api/frontend/config. La taxonomie, elle, s’édite en direct."
        readOnly={readOnly}
      />
      <PublishBar revision={revision} onPublished={load} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white border border-[#E2E0D9] rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-[#9C9A95] font-semibold">{m.label}</p>
            <p className="mt-1 text-[24px] font-extrabold leading-none text-[#1A1916]">{m.value}</p>
            <p className="mt-1.5 text-[11px] text-[#9C9A95]">{m.detail}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-[14px] font-bold mb-2">Modules actifs — {active.length}</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {active.map((m) => (
            <div key={m.id} className="bg-white border border-[#E2E0D9] rounded-xl p-4">
              <div className="flex items-center gap-2">
                <span className="text-[15px] leading-none">{m.icon}</span>
                <p className="text-[13px] font-bold">{m.label}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                  actif
                </span>
                {MODULE_ROUTES[m.id] && (
                  <Link href={MODULE_ROUTES[m.id]} className="ml-auto text-[12px] font-bold text-[#2D5BE3] hover:underline">
                    Ouvrir →
                  </Link>
                )}
              </div>
              <p className="mt-1.5 text-[12px] text-[#5A5750]">{m.summary}</p>
              {m.drives.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {m.drives.map((file) => (
                    <li key={file} className="text-[11px] font-mono text-[#9C9A95]">
                      {file}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[14px] font-bold mb-2">Modules des maquettes sans contrepartie — {absent.length}</h2>
        <p className="mb-2 text-[12px] text-[#5A5750] max-w-3xl">
          Les maquettes <span className="font-mono text-[11px]">Flexwork-Admin-Complet.html</span> et{" "}
          <span className="font-mono text-[11px]">Flexwork-Taxonomie.html</span> décrivent ces modules.
          Aucun n’a de table, de composant ni de route dans ce dépôt. Ils sont listés avec ce qui leur
          manque, plutôt que livrés en coquilles vides : un écran qui paraît fonctionner sans rien
          piloter coûte plus cher qu’un écran absent.
        </p>
        <div className="bg-white border border-[#E2E0D9] rounded-xl divide-y divide-[#E2E0D9]">
          {absent.map((m) => (
            <div key={m.id} className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] leading-none opacity-50">{m.icon}</span>
                <p className="text-[13px] font-bold text-[#5A5750]">{m.label}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F4F3EF] text-[#9C9A95] border border-[#E2E0D9]">
                  non implémenté
                </span>
                <span className="text-[11px] text-[#9C9A95]">{m.group}</span>
              </div>
              <p className="mt-1.5 text-[12px] text-[#5A5750] max-w-3xl">{m.missing}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-[#E2E0D9] rounded-xl p-4">
        <h2 className="text-[13px] font-bold">Dernière publication</h2>
        {data.release ? (
          <p className="mt-1.5 text-[12px] text-[#5A5750]">
            Version {data.release.version}, le {new Date(data.release.publishedAt).toLocaleString("fr-FR")}
            {data.release.publishedBy
              ? ` par ${data.release.publishedBy.firstname ?? ""} ${data.release.publishedBy.lastname ?? ""}`.trimEnd() +
                ` (${data.release.publishedBy.email})`
              : " — publication initiale posée par le seed, sans administrateur"}
            {data.release.note ? ` · ${data.release.note}` : ""}. {data.releaseCount} version
            {data.releaseCount > 1 ? "s" : ""} au total.
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] text-[#5A5750]">
            Aucune publication. Le site public rend le socle de repli — c’est-à-dire exactement le
            contenu qui était écrit en dur dans les composants.
          </p>
        )}
      </section>
    </>
  );
}
