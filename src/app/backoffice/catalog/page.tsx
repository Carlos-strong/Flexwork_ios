"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar, StatusBadge } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";

type Usage = { missions: number; gigs: number; profiles: number; riskRules: number; total: number };
type Competency = { id: string; name: string; slug: string; status: string; verificationExpected: boolean };
type Specialty = { id: string; name: string; slug: string; description: string | null; status: string; competencies: Competency[] };
type Domain = { id: string; name: string; slug: string; icon: string | null; status: string; specialties: Specialty[]; usage: Usage };

const NEXT_STATUS: Record<string, string> = { brouillon: "publie", publie: "desactive", desactive: "publie", archive: "brouillon" };

// Référentiel métier — domaine → spécialité → compétence.
//
// Deux colonnes, et la seconde compte autant que la première : à droite, les libellés que les
// utilisateurs ont réellement saisis et qu'aucune entrée ne décrit. Un référentiel se construit
// à partir de ce que le terrain écrit, pas d'une page blanche ; les afficher côte à côte est ce
// qui empêche la console de dériver vers un catalogue hors-sol.
export default function TaxonomyPage() {
  const readOnly = useIsReadOnly("taxonomie");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [unreferenced, setUnreferenced] = useState<{ value: string; count: number }[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newIcon, setNewIcon] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/taxonomy");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (!res.ok) return;
    const data = await res.json();
    setDomains(data.domains);
    setUnreferenced(data.unreferenced);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createDomain(name: string, icon?: string) {
    setFeedback(null);
    const res = await fetch("/api/admin/frontend/taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "domain", name, icon: icon || undefined }),
    });
    if (res.ok) {
      setNewDomain("");
      setNewIcon("");
      load();
    } else if (res.status === 409) setFeedback(`Un domaine porte déjà ce slug.`);
    else if (res.status === 403) setFeedback("Édition réservée au rôle « frontend ».");
    else setFeedback("Création refusée.");
  }

  async function createChild(kind: "specialty" | "competency", parentId: string, name: string) {
    const res = await fetch("/api/admin/frontend/taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, parentId, name }),
    });
    if (res.ok) load();
    else if (res.status === 409) setFeedback("Ce slug existe déjà sous ce parent.");
    else setFeedback("Création refusée.");
  }

  async function patch(kind: string, id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/frontend/taxonomy/${kind}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) load();
    else setFeedback("Modification refusée.");
  }

  async function remove(kind: string, id: string, label: string) {
    setFeedback(null);
    const res = await fetch(`/api/admin/frontend/taxonomy/${kind}/${id}`, { method: "DELETE" });
    if (res.ok) return load();
    if (res.status === 409) {
      const data = await res.json();
      const u: Usage = data.usage;
      setFeedback(
        `« ${label} » ne peut pas être supprimé : ${u.missions} mission(s), ${u.gigs} prestation(s), ` +
          `${u.profiles} profil(s) et ${u.riskRules} règle(s) de risque s’y rattachent. Archivez-le plutôt.`
      );
      return;
    }
    setFeedback("Suppression refusée.");
  }

  if (forbidden) return <ForbiddenNotice />;

  return (
    <>
      <AdminPageHeader icon="🗂️" title="Taxonomie" subtitle="Domaines, spécialités et compétences. À droite, les libellés que les utilisateurs ont réellement saisis et qu’aucune entrée ne décrit." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      <div className="grid lg:grid-cols-[1.6fr_0.9fr] gap-4 items-start">
        <div className="space-y-3">
          <div className="bg-white border border-[#E2E0D9] rounded-xl p-4">
            <p className="text-[13px] font-bold">Nouveau domaine</p>
            <div className="mt-2 flex gap-2 flex-wrap">
              <input
                value={newIcon}
                onChange={(e) => setNewIcon(e.target.value)}
                placeholder="🧱"
                maxLength={4}
                className="w-14 h-9 px-2 text-center rounded-lg border border-[#E2E0D9] text-[13px]"
              />
              <input
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="Libellé du domaine"
                className="flex-1 min-w-[180px] h-9 px-3 rounded-lg border border-[#E2E0D9] text-[13px]"
              />
              <button
                onClick={() => newDomain.trim().length > 1 && createDomain(newDomain.trim(), newIcon)}
                className="h-9 px-4 rounded-lg bg-[#1A1916] text-white text-[12px] font-bold"
              >
                Créer
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[#9C9A95]">
              Créé en brouillon. Le slug d’URL est dérivé du libellé et ne change plus ensuite, pour
              qu’un renommage ne casse pas une adresse déjà publiée.
            </p>
          </div>

          {domains.map((domain) => (
            <div key={domain.id} className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2.5 flex-wrap">
                <button onClick={() => toggle(domain.id)} className="text-[13px] text-[#9C9A95] w-4">
                  {open.has(domain.id) ? "▾" : "▸"}
                </button>
                <span className="text-[16px] leading-none">{domain.icon ?? "◌"}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold truncate">{domain.name}</p>
                    <StatusBadge status={domain.status} />
                  </div>
                  <p className="text-[11px] text-[#9C9A95] font-mono">
                    /{domain.slug} · {domain.specialties.length} spécialité
                    {domain.specialties.length > 1 ? "s" : ""}
                  </p>
                </div>

                <span
                  title="Missions, prestations, profils et règles de risque rattachés à ce libellé"
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${
                    domain.usage.total > 0
                      ? "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]"
                      : "bg-[#F4F3EF] text-[#9C9A95] border-[#E2E0D9]"
                  }`}
                >
                  {domain.usage.total} rattachement{domain.usage.total > 1 ? "s" : ""}
                </span>

                <div className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => patch("domain", domain.id, { status: NEXT_STATUS[domain.status] })}
                    className="h-7 px-2.5 rounded-lg border border-[#E2E0D9] text-[11px] font-medium hover:bg-[#FAFAF8]"
                  >
                    {domain.status === "publie" ? "Dépublier" : "Publier"}
                  </button>
                  <button
                    onClick={() => patch("domain", domain.id, { status: "archive" })}
                    className="h-7 px-2.5 rounded-lg border border-[#E2E0D9] text-[11px] font-medium hover:bg-[#FAFAF8]"
                  >
                    Archiver
                  </button>
                  <button
                    onClick={() => remove("domain", domain.id, domain.name)}
                    disabled={domain.usage.total > 0}
                    title={
                      domain.usage.total > 0
                        ? "Des données réelles s’y rattachent — archivez au lieu de supprimer"
                        : "Supprimer définitivement"
                    }
                    className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium ${
                      domain.usage.total > 0
                        ? "border-[#E2E0D9] text-[#C9C6BE] cursor-not-allowed"
                        : "border-[#FECACA] text-[#B91C1C] hover:bg-[#FEE2E2]"
                    }`}
                  >
                    Supprimer
                  </button>
                </div>
              </div>

              {open.has(domain.id) && (
                <div className="border-t border-[#E2E0D9] bg-[#FBFCFD] px-4 py-3 space-y-2.5">
                  {domain.specialties.map((specialty) => (
                    <div key={specialty.id} className="rounded-lg border border-[#E2E0D9] bg-white">
                      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[#C9C6BE] font-mono text-[11px]">├──</span>
                        <p className="text-[12px] font-semibold">{specialty.name}</p>
                        <span className="text-[11px] text-[#9C9A95] font-mono">/{specialty.slug}</span>
                        <StatusBadge status={specialty.status} />
                        <span className="text-[11px] text-[#9C9A95]">
                          {specialty.competencies.length} compétence{specialty.competencies.length > 1 ? "s" : ""}
                        </span>
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => patch("specialty", specialty.id, { status: NEXT_STATUS[specialty.status] })}
                            className="h-6 px-2 rounded border border-[#E2E0D9] text-[11px] hover:bg-[#FAFAF8]"
                          >
                            {specialty.status === "publie" ? "Dépublier" : "Publier"}
                          </button>
                          <button
                            onClick={() => remove("specialty", specialty.id, specialty.name)}
                            className="h-6 px-2 rounded border border-[#FECACA] text-[#B91C1C] text-[11px] hover:bg-[#FEE2E2]"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>

                      <div className="px-3 pb-2.5 flex flex-wrap gap-1.5">
                        {specialty.competencies.map((competency) => (
                          <span
                            key={competency.id}
                            className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border border-[#E2E0D9] bg-[#FBFCFD]"
                          >
                            <button
                              onClick={() =>
                                patch("competency", competency.id, {
                                  status: NEXT_STATUS[competency.status],
                                })
                              }
                              title={competency.status === "publie" ? "Dépublier" : "Publier"}
                              className={competency.status === "publie" ? "text-[#166534]" : "text-[#9C9A95]"}
                            >
                              ●
                            </button>
                            {competency.name}
                            <button
                              onClick={() =>
                                patch("competency", competency.id, {
                                  verificationExpected: !competency.verificationExpected,
                                })
                              }
                              title="Pièce justificative attendue du prestataire — la plateforme ne vérifie pas la compétence pour autant"
                              className={`px-1 rounded text-[9px] font-bold border ${
                                competency.verificationExpected
                                  ? "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]"
                                  : "text-[#C9C6BE] border-[#E2E0D9]"
                              }`}
                            >
                              PIÈCE
                            </button>
                            <button
                              onClick={() => remove("competency", competency.id, competency.name)}
                              className="text-[#C9C6BE] hover:text-[#B91C1C]"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <InlineAdd
                          placeholder="+ compétence"
                          onAdd={(value) => createChild("competency", specialty.id, value)}
                        />
                      </div>
                    </div>
                  ))}

                  <InlineAdd
                    placeholder="+ spécialité"
                    onAdd={(value) => createChild("specialty", domain.id, value)}
                  />
                </div>
              )}
            </div>
          ))}

          {domains.length === 0 && (
            <p className="text-[13px] text-[#9C9A95]">Aucun domaine. Créez-en un ci-dessus.</p>
          )}
        </div>

        <aside className="bg-white border border-[#E2E0D9] rounded-xl p-4">
          <p className="text-[13px] font-bold">Saisies hors référentiel</p>
          <p className="mt-1 text-[12px] text-[#5A5750]">
            Libellés écrits par des utilisateurs sur leurs missions, prestations ou profils, qu’aucune
            entrée ne décrit. Un clic les ajoute au référentiel, à l’identique.
          </p>
          <div className="mt-3 space-y-1.5">
            {unreferenced.length === 0 && (
              <p className="text-[12px] text-[#9C9A95]">
                Aucune : toutes les saisies existantes correspondent à un domaine du référentiel.
              </p>
            )}
            {unreferenced.map((item) => (
              <button
                key={item.value}
                onClick={() => createDomain(item.value)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-[#E2E0D9] text-[12px] hover:bg-[#FAFAF8] text-left"
              >
                <span className="truncate">{item.value}</span>
                <span className="text-[11px] text-[#9C9A95] shrink-0">{item.count} ·&nbsp;ajouter</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

function InlineAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim().length > 1) {
          onAdd(value.trim());
          setValue("");
        }
      }}
      placeholder={placeholder}
      className="h-7 px-2 rounded-lg border border-dashed border-[#D6D3CB] text-[11px] bg-transparent focus:bg-white focus:border-[#2D5BE3] outline-none"
    />
  );
}
