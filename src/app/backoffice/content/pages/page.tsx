"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar, StatusBadge } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";

type Page = {
  id: string;
  path: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  status: string;
  state: "synchronisee" | "orpheline";
  /** La page compose-t-elle réellement ses métadonnées depuis la configuration publiée ? */
  piloted: boolean;
};

// Pages publiques. Le CORPS de chaque page reste du JSX dans src/app — la console ne prétend
// pas gérer un contenu qu'elle ne stocke pas. Ce qui est éditable ici l'est réellement : le
// titre d'onglet et la description de référencement.
export default function PagesPage() {
  const readOnly = useIsReadOnly("contenu");
  const [pages, setPages] = useState<Page[]>([]);
  const [missing, setMissing] = useState<{ path: string; title: string }[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/pages");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (!res.ok) return;
    const data = await res.json();
    setPages(data.pages);
    setMissing(data.missing);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setFeedback(null);
    const res = await fetch(`/api/admin/frontend/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return load();
    if (res.status === 403) return setFeedback("Édition réservée au rôle « frontend ».");
    setFeedback("Modification refusée — la description ne peut dépasser 160 caractères.");
  }

  if (forbidden) return <ForbiddenNotice />;

  const orphans = pages.filter((p) => p.state === "orpheline");

  return (
    <>
      <AdminPageHeader icon="📄" title="Pages" subtitle="Titre d’onglet et description de référencement des pages publiques." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] rounded-xl px-4 py-2.5 text-[12px]">
          {orphans.length} entrée{orphans.length > 1 ? "s" : ""} orpheline{orphans.length > 1 ? "s" : ""} :
          la route correspondante n’existe plus dans l’application. Son référencement est édité pour une
          page que personne ne peut ouvrir.
        </div>
      )}

      {missing.length > 0 && (
        <div className="bg-white border border-[#E2E0D9] rounded-xl px-4 py-2.5 text-[12px] text-[#5A5750]">
          {missing.length} route{missing.length > 1 ? "s" : ""} publique{missing.length > 1 ? "s" : ""} sans
          entrée éditable : {missing.map((m) => m.path).join(", ")}. Leur titre reste celui écrit dans le
          code.
        </div>
      )}

      {pages.some((p) => !p.piloted) && (
        <div className="bg-white border border-[#E2E0D9] rounded-xl px-4 py-2.5 text-[12px] text-[#5A5750]">
          Les lignes marquées <span className="font-semibold">titre figé</span> gardent le titre écrit
          dans leur code : ce sont des composants client, et un composant client ne peut pas composer
          ses métadonnées. Les y rattacher demanderait un gabarit dédié par route. Leur ligne reste
          affichée pour l’inventaire, mais l’édition n’y aurait aucun effet.
        </div>
      )}

      <div className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[#FBFCFD] border-b border-[#E2E0D9] text-left">
              <tr>
                <th className="px-4 py-2.5 font-semibold text-[#9C9A95]">Route</th>
                <th className="px-3 py-2.5 font-semibold text-[#9C9A95]">Titre</th>
                <th className="px-3 py-2.5 font-semibold text-[#9C9A95]">Description de référencement</th>
                <th className="px-3 py-2.5 font-semibold text-[#9C9A95]">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E0D9]">
              {pages.map((page) => (
                <tr key={page.id} className={page.state === "orpheline" ? "bg-[#FEF2F2]" : ""}>
                  <td className="px-4 py-2 font-mono text-[11px] whitespace-nowrap">{page.path}</td>
                  <td className="px-3 py-2">
                    {page.piloted ? (
                      <Cell value={page.title} onSave={(v) => v && patch(page.id, { title: v })} />
                    ) : (
                      <span className="text-[#9C9A95]">{page.title}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {page.piloted ? (
                      <Cell
                        value={page.seoDescription ?? ""}
                        placeholder="160 caractères maximum"
                        onSave={(v) => patch(page.id, { seoDescription: v || null })}
                      />
                    ) : (
                      <span className="text-[#9C9A95]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusBadge status={page.status} />
                    {page.state === "orpheline" && (
                      <span className="ml-1.5 text-[10px] text-[#B91C1C] font-semibold">orpheline</span>
                    )}
                    {!page.piloted && (
                      <span className="ml-1.5 text-[10px] text-[#9C9A95]">titre figé</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Cell({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onSave(draft);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="w-full h-7 px-2 rounded border border-transparent hover:border-[#E2E0D9] focus:border-[#2D5BE3] bg-transparent outline-none"
    />
  );
}
