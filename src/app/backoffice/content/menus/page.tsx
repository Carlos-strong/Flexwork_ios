"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar, StatusBadge } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";
import { LINKABLE_ROUTES } from "@/lib/frontend-defaults";

type MenuItem = {
  id: string;
  menu: string;
  label: string;
  href: string;
  description: string | null;
  status: string;
};
type Menu = { key: string; label: string; items: MenuItem[] };

const ROUTE_FONT = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" } as const;

// Menus de l'en-tête et du pied de page.
//
// Les deux sélecteurs de destination portent leur police en style INLINE plutôt que par une
// classe. `globals.css` impose `font-family: inherit` à `input, select, textarea`, ce qui fait
// résoudre la police d'un `<select>` vers la police web du site ; or un contrôle NATIF est
// peint par le système, qui n'y a pas toujours accès — constaté le 2026-09-21, les chemins de
// route s'affichaient comme une suite de points. Une pile système explicite ne dépend d'aucun
// chargement de police, et une adresse se lit de toute façon mieux en chasse fixe.
//
// La destination se choisit dans une liste, jamais en texte libre : le pied de page a déjà
// porté quatre liens morts, retirés à la main le 2026-09-09. La même liste sert de garde-fou
// côté API — l'interface n'est que la forme agréable d'une règle qui tient de toute façon.
export default function MenusPage() {
  const readOnly = useIsReadOnly("contenu");
  const [menus, setMenus] = useState<Menu[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/menus");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (res.ok) setMenus((await res.json()).menus);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setFeedback(null);
    const res = await fetch(`/api/admin/frontend/menus/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return load();
    if (res.status === 422) return setFeedback("Cette destination ne correspond à aucune page du site.");
    if (res.status === 403) return setFeedback("Édition réservée au rôle « frontend ».");
    setFeedback("Modification refusée.");
  }

  async function add(menu: string, label: string, href: string) {
    const res = await fetch("/api/admin/frontend/menus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menu, label, href }),
    });
    if (res.ok) return load();
    if (res.status === 422) return setFeedback("Cette destination ne correspond à aucune page du site.");
    setFeedback("Ajout refusé.");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/frontend/menus/${id}`, { method: "DELETE" });
    if (res.ok) load();
    else setFeedback("Suppression refusée.");
  }

  if (forbidden) return <ForbiddenNotice />;

  return (
    <>
      <AdminPageHeader icon="☰" title="Menus & pied de page" subtitle="Le menu « Explorer » de l’en-tête et les quatre colonnes du pied de page." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      <p className="text-[12px] text-[#5A5750] max-w-3xl">
        Les destinations proposées sont les {LINKABLE_ROUTES.length} pages publiques réellement servies
        par l’application. Une adresse absente de cette liste est refusée à l’enregistrement : c’est ce
        qui empêche un menu de se remplir de liens morts.
      </p>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        {menus.map((menu) => (
          <div key={menu.key} className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E2E0D9] flex items-center gap-2">
              <p className="text-[13px] font-bold">{menu.label}</p>
              <span className="text-[11px] font-mono text-[#9C9A95]">{menu.key}</span>
              <span className="ml-auto text-[11px] text-[#9C9A95]">{menu.items.length} entrées</span>
            </div>

            <div className="p-3 space-y-1.5">
              {menu.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#E2E0D9] px-2.5 py-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => patch(item.id, { status: item.status === "publie" ? "desactive" : "publie" })}
                      className={`text-[13px] leading-none ${item.status === "publie" ? "text-[#166534]" : "text-[#C9C6BE]"}`}
                      title={item.status === "publie" ? "Masquer" : "Afficher"}
                    >
                      ●
                    </button>
                    <EditableText value={item.label} onSave={(v) => patch(item.id, { label: v })} />
                    <StatusBadge status={item.status} />
                    <button
                      onClick={() => remove(item.id)}
                      className="ml-auto text-[#C9C6BE] hover:text-[#B91C1C] text-[14px] leading-none px-1"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Largeur fixe : sans `shrink-0`, le sélecteur s'étire sur toute la
                        ligne et écrase le champ de description à côté de lui. */}
                    <select
                      value={item.href}
                      onChange={(e) => patch(item.id, { href: e.target.value })}
                      style={ROUTE_FONT}
                      className="h-7 w-44 shrink-0 px-1.5 rounded border border-[#E2E0D9] text-[11px] bg-white"
                    >
                      {!LINKABLE_ROUTES.includes(item.href) && <option value={item.href}>{item.href}</option>}
                      {LINKABLE_ROUTES.map((route) => (
                        <option key={route} value={route}>
                          {route}
                        </option>
                      ))}
                    </select>
                    <EditableText
                      value={item.description ?? ""}
                      placeholder="description (en-tête seulement)"
                      onSave={(v) => patch(item.id, { description: v || null })}
                    />
                  </div>
                </div>
              ))}

              <AddMenuItem onAdd={(label, href) => add(menu.key, label, href)} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EditableText({
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
      className="flex-1 min-w-0 h-7 px-2 rounded border border-transparent hover:border-[#E2E0D9] focus:border-[#2D5BE3] text-[12px] bg-transparent outline-none"
    />
  );
}

function AddMenuItem({ onAdd }: { onAdd: (label: string, href: string) => void }) {
  const [label, setLabel] = useState("");
  const [href, setHref] = useState(LINKABLE_ROUTES[0]);
  return (
    <div className="flex gap-1.5 pt-1">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Libellé"
        className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-dashed border-[#D6D3CB] text-[12px] outline-none focus:border-[#2D5BE3]"
      />
      <select
        value={href}
        onChange={(e) => setHref(e.target.value)}
        style={ROUTE_FONT}
        className="h-8 w-40 shrink-0 px-1.5 rounded-lg border border-[#E2E0D9] text-[11px] bg-white"
      >
        {LINKABLE_ROUTES.map((route) => (
          <option key={route} value={route}>
            {route}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          if (!label.trim()) return;
          onAdd(label.trim(), href);
          setLabel("");
        }}
        className="h-8 px-3 rounded-lg bg-[#1A1916] text-white text-[11px] font-bold shrink-0"
      >
        Ajouter
      </button>
    </div>
  );
}
