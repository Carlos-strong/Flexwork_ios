"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar, StatusBadge } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";

type Item = {
  id: string;
  label: string;
  sublabel: string | null;
  href: string | null;
  icon: string | null;
  color: string | null;
  imageUrl: string | null;
  status: string;
  sortOrder: number;
};
type Section = {
  id: string;
  key: string;
  label: string;
  title: string | null;
  subtitle: string | null;
  ctaText: string | null;
  ctaLink: string | null;
  status: string;
  items: Item[];
};

// Ce que chaque section commande dans le code, et ce que ses champs veulent dire là-bas. La
// même donnée ne se lit pas pareil d'une section à l'autre — `sublabel` est le domaine visé
// par une vignette de service, le détail d'une garantie ailleurs. Le dire ici évite à
// l'éditeur de le déduire d'un aperçu.
const SECTION_HELP: Record<string, { file: string; note: string }> = {
  hero: {
    file: "Hero.tsx",
    note: "Le titre accepte des sauts de ligne ; le segment entre ** reçoit le dégradé orange. Les compteurs affichés autour ne sont pas éditables : ils sont mesurés en base.",
  },
  categories_bar: {
    file: "CategoriesBar.tsx",
    note: "« Couleur » est la classe de la pastille. Sans lien explicite, l’entrée ouvre la recherche sur son libellé.",
  },
  guarantees: {
    file: "TrustedBy.tsx",
    note: "« Détail » est le complément affiché sur grand écran. Ces garanties doivent rester celles que la plateforme met réellement en œuvre.",
  },
  popular_services: {
    file: "PopularServices.tsx",
    note: "« Détail » porte ici le DOMAINE visé par la recherche, distinct du libellé affiché.",
  },
  latest_missions: {
    file: "LatestMissions.tsx",
    note: "Libellés seuls. Les missions affichées sont les six dernières publiées, lues en base ; aucune ne s’épingle à la main.",
  },
  latest_gigs: {
    file: "LatestGigs.tsx",
    note: "Libellés seuls. Les six derniers services publiés, ceux des prestataires au badge « Vérifié » en tête ; aucun ne s’épingle à la main.",
  },
  featured_talents: {
    file: "TalentsAfrique.tsx",
    note: "Libellés seuls. Les profils affichés sont sélectionnés en base sur des critères publiés, et ne s’épinglent pas à la main.",
  },
};

export default function SectionsPage() {
  const readOnly = useIsReadOnly("contenu");
  const [sections, setSections] = useState<Section[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/sections");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (res.ok) setSections((await res.json()).sections);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(kind: "section" | "item", id: string, body: Record<string, unknown>) {
    setFeedback(null);
    const res = await fetch(`/api/admin/frontend/sections/${kind}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return load();
    if (res.status === 422) {
      const data = await res.json();
      setFeedback(`« ${data.href} » ne correspond à aucune page réelle du site — lien refusé.`);
      return;
    }
    if (res.status === 403) return setFeedback("Édition réservée au rôle « frontend ».");
    setFeedback("Modification refusée.");
  }

  async function addItem(sectionId: string, label: string) {
    const res = await fetch("/api/admin/frontend/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId, label }),
    });
    if (res.ok) load();
    else setFeedback("Ajout refusé.");
  }

  async function removeItem(id: string) {
    const res = await fetch(`/api/admin/frontend/sections/item/${id}`, { method: "DELETE" });
    if (res.ok) load();
    else setFeedback("Suppression refusée.");
  }

  if (forbidden) return <ForbiddenNotice />;

  return (
    <>
      <AdminPageHeader icon="🖼️" title="Sections d’accueil" subtitle="Les blocs de la page d’accueil. Toute modification reste en brouillon jusqu’à la publication." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      <p className="text-[12px] text-[#5A5750] max-w-3xl">
        Les sections ne se créent ni ne se suppriment : chacune est rendue par un composant précis du
        code, et une section sans composant serait éditable sans jamais s’afficher. Pour retirer un bloc
        de la page, passez-le en « désactivé ».
      </p>

      {sections.map((section) => {
        const help = SECTION_HELP[section.key];
        return (
          <div key={section.id} className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E0D9] flex items-center gap-2.5 flex-wrap">
              <p className="text-[13px] font-bold">{section.label}</p>
              <StatusBadge status={section.status} />
              <span className="text-[11px] font-mono text-[#9C9A95]">
                {section.key}
                {help ? ` → ${help.file}` : ""}
              </span>
              <button
                onClick={() =>
                  patch("section", section.id, {
                    status: section.status === "publie" ? "desactive" : "publie",
                  })
                }
                className="ml-auto h-7 px-2.5 rounded-lg border border-[#E2E0D9] text-[11px] font-medium hover:bg-[#FAFAF8]"
              >
                {section.status === "publie" ? "Retirer de la page" : "Afficher sur la page"}
              </button>
            </div>

            <div className="p-4 space-y-3">
              {help && <p className="text-[11px] text-[#9C9A95]">{help.note}</p>}

              <div className="grid md:grid-cols-2 gap-2.5">
                <Field
                  label="Titre"
                  value={section.title ?? ""}
                  multiline={section.key === "hero"}
                  onSave={(value) => patch("section", section.id, { title: value || null })}
                />
                <Field
                  label={section.key === "featured_talents" ? "Sur-titre" : "Sous-titre"}
                  value={section.subtitle ?? ""}
                  multiline
                  onSave={(value) => patch("section", section.id, { subtitle: value || null })}
                />
                <Field
                  label="Texte du lien"
                  value={section.ctaText ?? ""}
                  onSave={(value) => patch("section", section.id, { ctaText: value || null })}
                />
                <Field
                  label="Destination du lien"
                  value={section.ctaLink ?? ""}
                  onSave={(value) => patch("section", section.id, { ctaLink: value || null })}
                />
              </div>

              {(section.items.length > 0 || section.key !== "hero") && (
                <div className="border-t border-[#E2E0D9] pt-3">
                  <p className="text-[11px] uppercase tracking-wide text-[#9C9A95] font-semibold mb-2">
                    Entrées — {section.items.length}
                  </p>
                  <div className="space-y-1.5">
                    {section.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-[#E2E0D9] px-2.5 py-2">
                        <button
                          onClick={() =>
                            patch("item", item.id, { status: item.status === "publie" ? "desactive" : "publie" })
                          }
                          title={item.status === "publie" ? "Masquer" : "Afficher"}
                          className={`text-[13px] leading-none ${item.status === "publie" ? "text-[#166534]" : "text-[#C9C6BE]"}`}
                        >
                          ●
                        </button>
                        {item.icon !== null && (
                          <InlineField
                            value={item.icon ?? ""}
                            width="w-12"
                            placeholder="icône"
                            onSave={(value) => patch("item", item.id, { icon: value || null })}
                          />
                        )}
                        <InlineField
                          value={item.label}
                          width="flex-1 min-w-[140px]"
                          onSave={(value) => patch("item", item.id, { label: value })}
                        />
                        <InlineField
                          value={item.sublabel ?? ""}
                          width="flex-1 min-w-[140px]"
                          placeholder="détail"
                          onSave={(value) => patch("item", item.id, { sublabel: value || null })}
                        />
                        <InlineField
                          value={item.color ?? ""}
                          width="w-40"
                          placeholder="couleur"
                          onSave={(value) => patch("item", item.id, { color: value || null })}
                        />
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-[#C9C6BE] hover:text-[#B91C1C] text-[14px] leading-none px-1"
                          title="Supprimer l’entrée"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <AddItem onAdd={(label) => addItem(section.id, label)} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// Champ qui n'enregistre qu'à la perte de focus ou sur Entrée. Un enregistrement à chaque
// frappe produirait une écriture par caractère et une entrée de journal d'audit par caractère.
function Field({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onSave(draft);

  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-[#9C9A95] mb-1">{label}</span>
      {multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={2}
          className="w-full px-2.5 py-1.5 rounded-lg border border-[#E2E0D9] text-[12px] focus:border-[#2D5BE3] outline-none"
        />
      ) : (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full h-9 px-2.5 rounded-lg border border-[#E2E0D9] text-[12px] focus:border-[#2D5BE3] outline-none"
        />
      )}
    </label>
  );
}

function InlineField({
  value,
  width,
  placeholder,
  onSave,
}: {
  value: string;
  width: string;
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
      className={`${width} h-7 px-2 rounded border border-transparent hover:border-[#E2E0D9] focus:border-[#2D5BE3] text-[12px] bg-transparent outline-none`}
    />
  );
}

function AddItem({ onAdd }: { onAdd: (label: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          onAdd(value.trim());
          setValue("");
        }
      }}
      placeholder="+ ajouter une entrée"
      className="mt-2 h-8 px-2.5 rounded-lg border border-dashed border-[#D6D3CB] text-[12px] bg-transparent focus:bg-white focus:border-[#2D5BE3] outline-none"
    />
  );
}
