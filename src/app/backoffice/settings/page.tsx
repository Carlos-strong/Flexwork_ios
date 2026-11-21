"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";

type Setting = {
  key: string;
  group: string;
  label: string;
  value: string;
  defaultValue: string;
  customized: boolean;
};

const GROUP_LABELS: Record<string, { title: string; note: string }> = {
  seo: {
    title: "Référencement global",
    note: "Repris par les métadonnées du gabarit racine (src/app/layout.tsx) : titre d’onglet et description servie aux moteurs de recherche et aux aperçus de partage.",
  },
  identite: {
    title: "Identité du site",
    note: "Nom affiché dans le logo textuel du pied de page, baseline et mention de bas de page. Le logo graphique, la favicon et les icônes d’application restent des fichiers du déploiement.",
  },
};

export default function SettingsPage() {
  const readOnly = useIsReadOnly("parametres", "parametres-site");
  const [settings, setSettings] = useState<Setting[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/settings");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (res.ok) setSettings((await res.json()).settings);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key: string, value: string) {
    setFeedback(null);
    const res = await fetch("/api/admin/frontend/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (res.ok) return load();
    if (res.status === 403) return setFeedback("Édition réservée au rôle « frontend ».");
    setFeedback("Enregistrement refusé.");
  }

  if (forbidden) return <ForbiddenNotice />;

  const groups = [...new Set(settings.map((s) => s.group))];

  return (
    <>
      <AdminPageHeader icon="⚙️" title="Paramètres — Site & référencement" subtitle="Nom affiché, baseline, titre et description servis aux moteurs de recherche." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#FFF6E3] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      {groups.map((group) => (
        <div key={group} className="bg-white border border-[#E7E2F0] rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-[13px] font-bold">{GROUP_LABELS[group]?.title ?? group}</h2>
            {GROUP_LABELS[group]?.note && (
              <p className="mt-1 text-[11px] text-[#9A93A8] max-w-3xl">{GROUP_LABELS[group].note}</p>
            )}
          </div>

          {settings
            .filter((s) => s.group === group)
            .map((setting) => (
              <SettingField key={setting.key} setting={setting} onSave={save} />
            ))}
        </div>
      ))}
    </>
  );
}

function SettingField({ setting, onSave }: { setting: Setting; onSave: (key: string, value: string) => void }) {
  const [draft, setDraft] = useState(setting.value);
  useEffect(() => setDraft(setting.value), [setting.value]);
  const commit = () => draft !== setting.value && onSave(setting.key, draft);

  return (
    <label className="block">
      <span className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] font-semibold text-[#6B6478]">{setting.label}</span>
        <span className="text-[10px] font-mono text-[#9A93A8]">{setting.key}</span>
        {setting.customized && (
          <button
            type="button"
            onClick={() => onSave(setting.key, setting.defaultValue)}
            className="text-[10px] text-[#4C1D95] font-semibold hover:underline"
            title={`Valeur d’origine : ${setting.defaultValue}`}
          >
            revenir à l’origine
          </button>
        )}
      </span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-lg border border-[#E7E2F0] text-[12px] focus:border-[#4C1D95] outline-none"
      />
    </label>
  );
}
