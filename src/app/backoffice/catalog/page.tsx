"use client";

import { useState, useEffect } from "react";
import { useIsReadOnly } from "@/components/admin/admin-role-context";
import { RISK_LEVELS, riskLevelLabel } from "@/lib/metier-risk";
import { SECTEURS, secteurLabel } from "@/lib/secteur";
import SecteurBoard, { type SecteurBoardCategorie } from "@/components/admin/SecteurBoard";

// Taxonomie Catégorie → Métier → Service — écran repris tel quel de `flexwork_job`
// (app/backoffice/catalog/page.tsx). Trois écarts, tous signalés sur place :
//   · le superviseur y entre en lecture seule (§13 : lire n'est pas agir) ;
//   · la catégorie et le métier sélectionnés sont resynchronisés après chaque rechargement —
//     l'original gardait les objets d'avant : un métier ajouté n'apparaissait qu'après un
//     changement de catégorie, et un métier renommé gardait son ancien nom en tête des services ;
//   · le champ d'édition n'est plus rendu À L'INTÉRIEUR du bouton de sélection (bouton dans
//     un bouton : HTML invalide, et chaque clic sur ✓ resélectionnait la ligne) ;
//   · les outils sont visibles en permanence (l'original ne montrait ✏️/🗑️ qu'au survol), les
//     champs icône/description déjà présents dans l'état ont leur saisie, et chaque échec de
//     l'API s'affiche au lieu d'être avalé — un chargement en erreur laissait un écran vide
//     sans rien pour agir.

interface Categorie {
  id: string;
  libelle: string;
  description?: string;
  icon?: string;
  // Barrière d'âge (A13, 2026-09-24) : cochée, la catégorie impose une date de naissance
  // établie à quiconque en choisit un métier. Portée par la catégorie et non par la filière,
  // parce que la filière dit comment on exerce, pas quel travail on fait.
  requiresAgeCheck?: boolean;
  // Vérification tierce (2026-10-01) : autorise le mode « OPR / responsable chantier » à la
  // publication des missions de cette catégorie.
  allowsOprVerification?: boolean;
  // Secteur de la marketplace (2026-09-28) : DIGITAL / BTP / SERVICES. `null` = non classée —
  // le classement revient à l'administrateur, il n'est jamais deviné du libellé.
  secteur?: string | null;
  _count?: { metiers?: number };
  metiers?: Metier[];
}

interface Metier {
  id: string;
  categorieId: string;
  libelle: string;
  riskLevel?: string;
  _count?: { services?: number };
}

// Le palier de risque se lit d'un coup d'œil sur la liste (2026-09-24) : c'est la conséquence
// « assurance obligatoire » qui est codée par la couleur, parce que c'est elle qui engage.
const RISK_BADGE: Record<string, string> = {
  low: "bg-[#F4F3EF] text-[#5A5750]",
  medium: "bg-[#FEF3C7] text-[#D97706]",
  high: "bg-[#FEE2E2] text-[#B91C1C]",
};

// Le libellé du marqueur d'âge, écrit UNE fois : il sert au badge, à l'infobulle et au message
// de confirmation. Le seuil n'est pas ici — il se règle par pays et par filière dans
// Localisation ; la catégorie, elle, ne décide que du DÉCLENCHEMENT.
const AGE_CHECK_HINT =
  "Barrière d'âge : une date de naissance établie (relevée au KYC) est exigée pour tout métier de cette catégorie.";

// Vérification tierce (2026-10-01) : la catégorie AUTORISE le mode « OPR / responsable chantier »
// à la publication ; chaque mission choisit ensuite si elle l'utilise.
const OPR_HINT =
  "Coché : à la publication d'une mission de cette catégorie, le client peut confier le pointage et la vérification des jalons à un responsable chantier (OPR), et garde la validation définitive.";

// Badge du secteur : une catégorie non classée ressort en orange, parce que c'est une action
// en attente — elle n'apparaîtra sous aucun pôle de la marketplace tant qu'elle le reste.
const SECTEUR_BADGE: Record<string, string> = {
  digital: "bg-[#E0F2FE] text-[#0369A1]",
  btp: "bg-[#FEF3C7] text-[#B45309]",
  services: "bg-[#DCFCE7] text-[#15803D]",
};
const SECTEUR_UNSET_BADGE = "bg-[#FFEDD5] text-[#C2410C]";

interface ServiceItem {
  id: string;
  metierId: string;
  libelle: string;
  description?: string;
  dureeEstimee?: number;
}

export default function BackOfficeCatalogPage() {
  const readOnly = useIsReadOnly("taxonomie");
  const [categories, setCategories] = useState<Categorie[]>([]);
  const [selected, setSelected] = useState<Categorie | null>(null);
  const [selectedMetier, setSelectedMetier] = useState<Metier | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingServices, setLoadingServices] = useState(false);

  // Formulaires d'ajout
  const [newCat, setNewCat] = useState({ libelle: "", description: "", icon: "", requiresAgeCheck: false, allowsOprVerification: false, secteur: "" });
  const [newMetier, setNewMetier] = useState({ libelle: "", riskLevel: "low" });
  const [newService, setNewService] = useState({ libelle: "", description: "", dureeEstimee: "" });
  const [adding, setAdding] = useState(false);
  const [addingMetier, setAddingMetier] = useState(false);
  const [addingService, setAddingService] = useState(false);

  // Édition inline
  const [editCat, setEditCat] = useState<{ id: string; libelle: string; requiresAgeCheck: boolean; allowsOprVerification: boolean; secteur: string } | null>(null);
  const [editMetier, setEditMetier] = useState<{ id: string; libelle: string; riskLevel: string } | null>(null);
  const [editService, setEditService] = useState<{ id: string; libelle: string; dureeEstimee: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; type: string; label: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Toute écriture passe par ici : l'échec est montré, jamais ignoré.
  const call = async (url: string, method: string, body: unknown, success: string): Promise<boolean> => {
    setNotice(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setNotice({ tone: "ok", text: success });
        return true;
      }
      const data = await res.json().catch(() => ({}));
      const reason =
        res.status === 401 ? "session expirée — reconnectez-vous" :
        res.status === 403 ? "votre rôle ne permet pas de modifier la taxonomie" :
        data.error ?? `erreur HTTP ${res.status}`;
      setNotice({ tone: "error", text: `Échec : ${reason}.` });
    } catch {
      setNotice({ tone: "error", text: "Échec : serveur injoignable." });
    }
    return false;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) {
        setLoadError(`Impossible de charger la taxonomie (HTTP ${res.status}). Si la base vient d'être migrée, redémarrez le serveur de développement.`);
        setCategories([]);
        return;
      }
      setLoadError(null);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.data ?? []);
      setCategories(list);
      // Écart n°2 : resynchroniser la sélection sur l'objet rechargé (voir en tête de fichier).
      setSelected((prev) => (prev ? list.find((c: Categorie) => c.id === prev.id) ?? list[0] ?? null : list[0] ?? null));
      setSelectedMetier((prev) => (prev ? list.flatMap((c: Categorie) => c.metiers ?? []).find((m: Metier) => m.id === prev.id) ?? null : null));
    } catch {
      setLoadError("Impossible de charger la taxonomie : serveur injoignable.");
      setCategories([]);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const loadServicesForMetier = async (metierId: string) => {
    setLoadingServices(true);
    try {
      const res = await fetch(`/api/services?metierId=${metierId}`);
      const data = await res.json();
      setServices(data.data ?? []);
    } catch { setServices([]); }
    finally { setLoadingServices(false); }
  };

  const handleSelectCategory = (cat: Categorie) => {
    setSelected(cat);
    setSelectedMetier(null);
    setServices([]);
  };

  const handleSelectMetier = (m: Metier) => {
    setSelectedMetier(m);
    loadServicesForMetier(m.id);
  };

  const addCategory = async () => {
    if (!newCat.libelle.trim()) return;
    setAdding(true);
    try {
      const ok = await call("/api/categories", "POST", {
        libelle: newCat.libelle,
        description: newCat.description || undefined,
        icon: newCat.icon || undefined,
        requiresAgeCheck: newCat.requiresAgeCheck,
        allowsOprVerification: newCat.allowsOprVerification,
        secteur: newCat.secteur || null,
      }, `Catégorie « ${newCat.libelle} » ajoutée — secteur ${secteurLabel(newCat.secteur)}.`);
      if (ok) setNewCat({ libelle: "", description: "", icon: "", requiresAgeCheck: false, allowsOprVerification: false, secteur: "" });
      await load();
    } finally { setAdding(false); }
  };

  const addMetier = async () => {
    if (!newMetier.libelle.trim() || !selected) return;
    setAddingMetier(true);
    try {
      // Le palier part AVEC la création : c'est au moment où l'on décrit le métier qu'on sait si
      // le travail est dangereux, et c'est la seule occasion où la question se pose sans effort.
      const ok = await call(
        "/api/categories",
        "POST",
        { categorieId: selected.id, metierLibelle: newMetier.libelle, riskLevel: newMetier.riskLevel },
        `Métier « ${newMetier.libelle} » ajouté — risque ${riskLevelLabel(newMetier.riskLevel)}.`,
      );
      if (ok) setNewMetier({ libelle: "", riskLevel: "low" });
      await load();
    } finally { setAddingMetier(false); }
  };

  const addService = async () => {
    if (!newService.libelle.trim() || !selectedMetier) return;
    setAddingService(true);
    try {
      const ok = await call("/api/services", "POST", {
        metierId: selectedMetier.id,
        libelle: newService.libelle,
        description: newService.description || undefined,
        dureeEstimee: newService.dureeEstimee ? Number(newService.dureeEstimee) : undefined,
      }, `Service « ${newService.libelle} » ajouté.`);
      if (ok) setNewService({ libelle: "", description: "", dureeEstimee: "" });
      await loadServicesForMetier(selectedMetier.id);
      await load(); // refresh counts
    } finally { setAddingService(false); }
  };

  // ── Édition ──

  const saveCategory = async () => {
    if (!editCat || !editCat.libelle.trim()) return;
    setSaving(true);
    // Le marqueur est envoyé même inchangé : c'est sa VALEUR qui fait la règle, jamais
    // l'absence de la clé — un écran qui l'ignorerait ne pourrait pas la retirer.
    await call(
      "/api/categories",
      "PUT",
      {
        id: editCat.id,
        libelle: editCat.libelle,
        requiresAgeCheck: editCat.requiresAgeCheck,
        allowsOprVerification: editCat.allowsOprVerification,
        secteur: editCat.secteur || null,
        type: "category",
      },
      `Catégorie modifiée — secteur ${secteurLabel(editCat.secteur)}, barrière d'âge ${editCat.requiresAgeCheck ? "activée" : "désactivée"}, vérification OPR ${editCat.allowsOprVerification ? "autorisée" : "non proposée"}.`,
    );
    setEditCat(null);
    setSaving(false);
    await load();
  };

  // Rattacher / retirer une catégorie d'un secteur. Seul `secteur` part : la route laisse
  // intacts le libellé et la barrière d'âge quand leurs clés sont absentes.
  const assignSecteur = async (cat: SecteurBoardCategorie, secteur: string | null) => {
    const from = secteurLabel(cat.secteur);
    await call(
      "/api/categories",
      "PUT",
      { id: cat.id, type: "category", secteur },
      secteur
        ? `« ${cat.libelle} » rangée dans ${secteurLabel(secteur)}${cat.secteur ? ` (auparavant ${from})` : ""}.`
        : `« ${cat.libelle} » retirée de ${from} — elle est désormais non classée.`,
    );
    await load();
  };

  const saveMetier = async () => {
    if (!editMetier || !editMetier.libelle.trim()) return;
    setSaving(true);
    // Le palier est envoyé même inchangé : sans lui, la route le laisserait intact — un écran qui
    // ne le connaîtrait pas ne pourrait pas le remettre à « faible » par omission.
    await call(
      "/api/categories",
      "PUT",
      { id: editMetier.id, libelle: editMetier.libelle, riskLevel: editMetier.riskLevel, type: "metier" },
      "Métier modifié.",
    );
    setEditMetier(null);
    setSaving(false);
    await load();
  };

  const saveService = async () => {
    if (!editService || !editService.libelle.trim()) return;
    setSaving(true);
    await call("/api/services", "PUT", { id: editService.id, libelle: editService.libelle, dureeEstimee: editService.dureeEstimee }, "Service modifié.");
    setEditService(null);
    setSaving(false);
    await loadServicesForMetier(selectedMetier!.id);
    await load();
  };

  // ── Suppression ──

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    const { id, type } = confirmDelete;
    const url = type === "service" ? "/api/services" : "/api/categories";
    await call(url, "DELETE", { id, type: type === "category" ? "category" : type === "metier" ? "metier" : "service" }, `« ${confirmDelete.label} » supprimé.`);
    setConfirmDelete(null);
    setSaving(false);
    if (type === "category") { setSelectedMetier(null); setServices([]); }
    if (type === "metier") { setSelectedMetier(null); setServices([]); }
    if (type === "service" && selectedMetier) await loadServicesForMetier(selectedMetier.id);
    await load();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1A1916]">Taxonomie</h2>
        <p className="text-[14px] text-[#5A5750]">
          Hiérarchie : Secteur → Catégorie → Métier → Service
        </p>
      </div>

      {readOnly && (
        <div className="rounded-[12px] border border-[#E2E0D9] bg-[#FAFAF8] px-4 py-3 text-[13px] text-[#5A5750]">
          👁️ Lecture seule : votre rôle consulte la taxonomie sans la modifier. L’ajout, la modification et la
          suppression sont réservés au rôle « Éditeur du site ».
        </div>
      )}
      {loadError && (
        <div className="rounded-[12px] border border-[#F5C6C0] bg-[#FDF0EE] px-4 py-3 text-[13px] text-[#C0392B]">{loadError}</div>
      )}
      {notice && (
        <div
          className={`rounded-[12px] border px-4 py-3 text-[13px] flex items-center justify-between gap-3 ${notice.tone === "ok" ? "border-[#BBE3CB] bg-[#EDF8F1] text-[#1A7A4A]" : "border-[#F5C6C0] bg-[#FDF0EE] text-[#C0392B]"}`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-[12px] opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Classement par secteur (2026-09-28) — la vue de l'entrée de la marketplace. */}
      {!loadError && categories.length > 0 && (
        <SecteurBoard categories={categories} readOnly={readOnly} onAssign={assignSecteur} />
      )}

      {/* Arborescence visuelle */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Colonne 1 — Catégories */}
        <div className="rounded-[16px] border border-[#E2E0D9] overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-[#E2E0D9] bg-[#FAFAF8] flex items-center justify-between">
            <h3 className="font-semibold text-[14px] text-[#1A1916]">Catégories</h3>
            <span className="text-[12px] text-[#5A5750]">{categories.length}</span>
          </div>
          <div className="overflow-y-auto max-h-80">
            {loading && categories.length === 0 ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="animate-pulse h-10 rounded-[10px] bg-[#F5F5F0]" />)}
              </div>
            ) : categories.map((cat) => (
              <div key={cat.id} className="flex items-center border-b border-[#E2E0D9] last:border-b-0 group">
                {editCat?.id === cat.id ? (
                  <span className={`flex-1 inline-flex items-center gap-1 px-4 py-3 text-[14px] ${selected?.id === cat.id ? "bg-[#EEF2FD]" : ""}`}>
                    <input value={editCat.libelle} onChange={(e) => setEditCat((p) => p ? { ...p, libelle: e.target.value } : null)} className="flex-1 min-w-0 rounded border px-1 text-xs" autoFocus onKeyDown={(e) => e.key === "Enter" && saveCategory()} />
                    <select
                      value={editCat.secteur}
                      onChange={(e) => setEditCat((p) => p ? { ...p, secteur: e.target.value } : null)}
                      className="rounded border px-1 text-[11px]"
                      title="Secteur de la marketplace"
                    >
                      <option value="">Non classée</option>
                      {SECTEURS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <label className="inline-flex items-center gap-1 text-[11px] text-[#5A5750] whitespace-nowrap" title={AGE_CHECK_HINT}>
                      <input
                        type="checkbox"
                        checked={editCat.requiresAgeCheck}
                        onChange={(e) => setEditCat((p) => p ? { ...p, requiresAgeCheck: e.target.checked } : null)}
                      />
                      Âge requis
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-[#5A5750] whitespace-nowrap" title={OPR_HINT}>
                      <input
                        type="checkbox"
                        checked={editCat.allowsOprVerification}
                        onChange={(e) => setEditCat((p) => p ? { ...p, allowsOprVerification: e.target.checked } : null)}
                      />
                      OPR
                    </label>
                    <button onClick={saveCategory} disabled={saving} className="text-xs text-[#1A7A4A] hover:underline">✓</button>
                    <button onClick={() => setEditCat(null)} className="text-xs text-[#5A5750] hover:underline">✕</button>
                  </span>
                ) : (
                  <button
                    onClick={() => handleSelectCategory(cat)}
                    className={`flex-1 text-left px-4 py-3 text-[14px] transition-colors hover:bg-[#EEF2FD] ${selected?.id === cat.id ? "bg-[#EEF2FD] font-medium text-[#1A1916]" : "text-[#1A1916]"}`}
                  >
                    {cat.icon && <span className="mr-1.5">{cat.icon}</span>}
                    {cat.libelle}
                    <span className="ml-2 text-[12px] text-[#5A5750]">({cat._count?.metiers ?? cat.metiers?.length ?? 0})</span>
                    <span
                      className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold align-middle uppercase ${cat.secteur ? SECTEUR_BADGE[cat.secteur] ?? SECTEUR_UNSET_BADGE : SECTEUR_UNSET_BADGE}`}
                      title={SECTEURS.find((s) => s.value === cat.secteur)?.hint ?? "Aucun secteur : à classer."}
                    >
                      {secteurLabel(cat.secteur)}
                    </span>
                    {cat.requiresAgeCheck && (
                      <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold align-middle bg-[#E0E7FF] text-[#3730A3]" title={AGE_CHECK_HINT}>
                        ÂGE REQUIS
                      </span>
                    )}
                    {cat.allowsOprVerification && (
                      <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold align-middle bg-[#FEF3C7] text-[#92400E]" title={OPR_HINT}>
                        OPR
                      </span>
                    )}
                  </button>
                )}
                {!readOnly && !editCat && (
                  <span className="flex pr-2 gap-0.5">
                    <button onClick={() => setEditCat({ id: cat.id, libelle: cat.libelle, requiresAgeCheck: cat.requiresAgeCheck === true, allowsOprVerification: cat.allowsOprVerification === true, secteur: cat.secteur ?? "" })} className="p-1 text-xs text-[#5A5750] hover:text-[#1A1916]" title="Modifier">✏️</button>
                    <button onClick={() => setConfirmDelete({ id: cat.id, type: "category", label: cat.libelle })} className="p-1 text-xs text-[#5A5750] hover:text-[#C0392B]" title="Supprimer">🗑️</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* Ajout catégorie */}
          {!readOnly && (
          <div className="p-3 border-t border-[#E2E0D9] space-y-2">
            <input
              value={newCat.libelle}
              onChange={(e) => setNewCat((p) => ({ ...p, libelle: e.target.value }))}
              placeholder="Nom de la catégorie…"
              className="w-full rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
            />
            <div className="flex gap-2">
              <input
                value={newCat.icon}
                onChange={(e) => setNewCat((p) => ({ ...p, icon: e.target.value }))}
                placeholder="Icône"
                className="w-16 rounded-[10px] border border-[#E2E0D9] bg-white px-2 py-2 text-[12px] text-center text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
              />
              <input
                value={newCat.description}
                onChange={(e) => setNewCat((p) => ({ ...p, description: e.target.value }))}
                placeholder="Description (facultatif)"
                className="flex-1 rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
              />
            </div>
            <select
              value={newCat.secteur}
              onChange={(e) => setNewCat((p) => ({ ...p, secteur: e.target.value }))}
              className="w-full rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none"
            >
              <option value="">Secteur : non classée</option>
              {SECTEURS.map((s) => <option key={s.value} value={s.value}>Secteur : {s.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button
                onClick={addCategory}
                disabled={adding || !newCat.libelle.trim()}
                className="flex-1 rounded-[10px] bg-[#2D5BE3] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1F4DD4] disabled:opacity-50 transition-colors"
              >
                {adding ? "…" : "+ Ajouter"}
              </button>
            </div>
            {/* Le marqueur se pose DÈS la création : c'est en nommant la catégorie qu'on sait à
                quel travail elle expose, et une case oubliée reste invisible pendant des mois. */}
            <label className="flex items-start gap-2 text-[11px] text-[#5A5750]" title={AGE_CHECK_HINT}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={newCat.requiresAgeCheck}
                onChange={(e) => setNewCat((p) => ({ ...p, requiresAgeCheck: e.target.checked }))}
              />
              <span>
                <span className="font-semibold text-[#1A1916]">Barrière d&apos;âge</span> — la catégorie exige une
                date de naissance établie.
              </span>
            </label>
            <label className="flex items-start gap-2 text-[11px] text-[#5A5750]" title={OPR_HINT}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={newCat.allowsOprVerification}
                onChange={(e) => setNewCat((p) => ({ ...p, allowsOprVerification: e.target.checked }))}
              />
              <span>
                <span className="font-semibold text-[#1A1916]">Vérification OPR</span> — le client peut confier la
                vérification à un responsable chantier.
              </span>
            </label>
          </div>
          )}
        </div>

        {/* Colonne 2 — Métiers */}
        <div className="rounded-[16px] border border-[#E2E0D9] overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-[#E2E0D9] bg-[#FAFAF8]">
            <h3 className="font-semibold text-[14px] text-[#1A1916]">
              Métiers
              {selected && <span className="ml-1 text-[#5A5750] font-normal">— {selected.libelle}</span>}
            </h3>
          </div>
          <div className="overflow-y-auto max-h-80">
            {!selected ? (
              <p className="p-4 text-[14px] text-[#5A5750]">Sélectionnez une catégorie{readOnly ? "" : " pour voir et ajouter ses métiers"}</p>
            ) : (selected.metiers ?? []).length === 0 ? (
              <p className="p-4 text-[14px] text-[#5A5750]">Aucun métier</p>
            ) : (selected.metiers ?? []).map((m) => (
              <div key={m.id} className="flex items-center border-b border-[#E2E0D9] last:border-b-0 group">
                {editMetier?.id === m.id ? (
                  <span className={`flex-1 inline-flex items-center gap-1 px-4 py-3 text-[14px] ${selectedMetier?.id === m.id ? "bg-[#EEF2FD]" : ""}`}>
                    <input value={editMetier.libelle} onChange={(e) => setEditMetier((p) => p ? { ...p, libelle: e.target.value } : null)} className="flex-1 rounded border px-1 text-xs" autoFocus onKeyDown={(e) => e.key === "Enter" && saveMetier()} />
                    <select
                      value={editMetier.riskLevel}
                      onChange={(e) => setEditMetier((p) => p ? { ...p, riskLevel: e.target.value } : null)}
                      aria-label="Palier de risque du métier"
                      className="rounded border px-1 text-xs"
                    >
                      {RISK_LEVELS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button onClick={saveMetier} disabled={saving} className="text-xs text-[#1A7A4A] hover:underline">✓</button>
                    <button onClick={() => setEditMetier(null)} className="text-xs text-[#5A5750] hover:underline">✕</button>
                  </span>
                ) : (
                  <button
                    onClick={() => handleSelectMetier(m)}
                    className={`flex-1 text-left px-4 py-3 text-[14px] transition-colors hover:bg-[#EEF2FD] ${selectedMetier?.id === m.id ? "bg-[#EEF2FD] font-medium text-[#1A1916]" : "text-[#1A1916]"}`}
                  >
                    {m.libelle}
                    <span
                      className={`ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold align-middle ${RISK_BADGE[m.riskLevel ?? "low"]}`}
                      title={RISK_LEVELS.find((r) => r.value === (m.riskLevel ?? "low"))?.hint}
                    >
                      {riskLevelLabel(m.riskLevel).toUpperCase()}
                    </span>
                  </button>
                )}
                {!readOnly && !editMetier && (
                  <span className="flex pr-2 gap-0.5">
                    <button onClick={() => setEditMetier({ id: m.id, libelle: m.libelle, riskLevel: m.riskLevel ?? "low" })} className="p-1 text-xs text-[#5A5750] hover:text-[#1A1916]" title="Modifier">✏️</button>
                    <button onClick={() => setConfirmDelete({ id: m.id, type: "metier", label: m.libelle })} className="p-1 text-xs text-[#5A5750] hover:text-[#C0392B]" title="Supprimer">🗑️</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {!readOnly && selected && (
            <div className="p-3 border-t border-[#E2E0D9]">
              <div className="flex gap-2">
                <input
                  value={newMetier.libelle}
                  onChange={(e) => setNewMetier({ ...newMetier, libelle: e.target.value })}
                  placeholder="Nom du métier…"
                  className="flex-1 rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
                  onKeyDown={(e) => e.key === "Enter" && addMetier()}
                />
                <select
                  value={newMetier.riskLevel}
                  onChange={(e) => setNewMetier({ ...newMetier, riskLevel: e.target.value })}
                  aria-label="Palier de risque du nouveau métier"
                  className="rounded-[10px] border border-[#E2E0D9] bg-white px-2 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] outline-none"
                >
                  {RISK_LEVELS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <button
                  onClick={addMetier}
                  disabled={addingMetier || !newMetier.libelle.trim()}
                  className="rounded-[10px] bg-[#2D5BE3] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1F4DD4] disabled:opacity-50 transition-colors"
                >
                  {addingMetier ? "…" : "+"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[#5A5750]">
                Risque « {riskLevelLabel(newMetier.riskLevel)} » :{" "}
                {RISK_LEVELS.find((r) => r.value === newMetier.riskLevel)?.hint}
              </p>
            </div>
          )}
        </div>

        {/* Colonne 3 — Services */}
        <div className="rounded-[16px] border border-[#E2E0D9] overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-[#E2E0D9] bg-[#FAFAF8] flex items-center justify-between">
            <h3 className="font-semibold text-[14px] text-[#1A1916]">
              Services
              {selectedMetier && <span className="ml-1 text-[#5A5750] font-normal">— {selectedMetier.libelle}</span>}
            </h3>
            <span className="text-[12px] text-[#5A5750]">{services.length}</span>
          </div>
          <div className="overflow-y-auto max-h-60">
            {!selectedMetier ? (
              <p className="p-4 text-[14px] text-[#5A5750]">Sélectionnez un métier pour voir ses services{readOnly ? "" : " et en ajouter"}.</p>
            ) : loadingServices ? (
              <div className="p-3 space-y-2">
                {[1, 2].map((i) => <div key={i} className="animate-pulse h-8 rounded-[10px] bg-[#F5F5F0]" />)}
              </div>
            ) : services.length === 0 ? (
              <p className="p-4 text-[14px] text-[#5A5750]">Aucun service</p>
            ) : services.map((s) => (
              <div key={s.id} className="px-4 py-2.5 text-[14px] border-b border-[#E2E0D9] last:border-b-0 flex items-center justify-between group">
                {editService?.id === s.id ? (
                  <span className="flex-1 flex gap-1 items-center">
                    <input value={editService.libelle} onChange={(e) => setEditService((p) => p ? { ...p, libelle: e.target.value } : null)} className="flex-1 rounded border px-1 text-xs" autoFocus onKeyDown={(e) => e.key === "Enter" && saveService()} />
                    <input value={editService.dureeEstimee} onChange={(e) => setEditService((p) => p ? { ...p, dureeEstimee: e.target.value } : null)} type="number" className="w-14 rounded border px-1 text-xs text-center" placeholder="min" />
                    <button onClick={saveService} disabled={saving} className="text-xs text-[#1A7A4A] hover:underline">✓</button>
                    <button onClick={() => setEditService(null)} className="text-xs text-[#5A5750] hover:underline">✕</button>
                  </span>
                ) : (
                  <>
                    <span className="text-[#1A1916]">• {s.libelle}</span>
                    <span className="flex items-center gap-2">
                      {s.dureeEstimee && <span className="text-[12px] text-[#5A5750]">{s.dureeEstimee} min</span>}
                      {!readOnly && <span className="flex gap-0.5">
                        <button onClick={() => setEditService({ id: s.id, libelle: s.libelle, dureeEstimee: s.dureeEstimee?.toString() || "" })} className="p-0.5 text-xs text-[#5A5750] hover:text-[#1A1916]" title="Modifier">✏️</button>
                        <button onClick={() => setConfirmDelete({ id: s.id, type: "service", label: s.libelle })} className="p-0.5 text-xs text-[#5A5750] hover:text-[#C0392B]" title="Supprimer">🗑️</button>
                      </span>}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
          {!readOnly && selectedMetier && (
            <div className="p-3 border-t border-[#E2E0D9] space-y-2">
              <input
                value={newService.libelle}
                onChange={(e) => setNewService((p) => ({ ...p, libelle: e.target.value }))}
                placeholder="Nom du service…"
                className="w-full rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
                onKeyDown={(e) => e.key === "Enter" && addService()}
              />
              <input
                value={newService.description}
                onChange={(e) => setNewService((p) => ({ ...p, description: e.target.value }))}
                placeholder="Description (facultatif)"
                className="w-full rounded-[10px] border border-[#E2E0D9] bg-white px-3 py-2 text-[12px] text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none placeholder:text-[#9C9A95]"
              />
              <div className="flex gap-2">
                <input
                  value={newService.dureeEstimee}
                  onChange={(e) => setNewService((p) => ({ ...p, dureeEstimee: e.target.value }))}
                  placeholder="Durée (min)"
                  type="number"
                  className="w-20 rounded-[10px] border border-[#E2E0D9] bg-white px-2 py-2 text-[12px] text-center text-[#1A1916] focus:border-[#2D5BE3] focus:ring-1 focus:ring-[#2D5BE3] outline-none"
                />
                <button
                  onClick={addService}
                  disabled={addingService || !newService.libelle.trim()}
                  className="flex-1 rounded-[10px] bg-[#2D5BE3] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1F4DD4] disabled:opacity-50 transition-colors"
                >
                  {addingService ? "…" : "+ Ajouter"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation de suppression */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1916]/40 backdrop-blur-sm">
          <div className="rounded-[16px] border border-[#E2E0D9] bg-white p-6 max-w-sm w-full shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
            <h3 className="font-semibold text-[#1A1916] mb-2">Confirmer la suppression</h3>
            <p className="text-[14px] text-[#5A5750] mb-4">
              Supprimer <strong>{confirmDelete.label}</strong> {confirmDelete.type === "category" ? "et tous ses métiers/services" : confirmDelete.type === "metier" ? "et ses services" : ""} ?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} disabled={saving} className="rounded-[10px] border border-[#E2E0D9] bg-white px-4 py-2 text-[14px] text-[#1A1916] hover:bg-[#FAFAF8] transition-colors">Annuler</button>
              <button onClick={executeDelete} disabled={saving} className="rounded-[10px] bg-[#C0392B] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#A93226] disabled:opacity-50 transition-colors">
                {saving ? "…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exemple d'arborescence */}
      <div className="rounded-[16px] border border-[#E2E0D9] bg-white p-5 shadow-sm">
        <h3 className="font-semibold mb-3 text-[14px] text-[#1A1916]">Exemple de hiérarchie</h3>
        <div className="font-mono text-[12px] text-[#5A5750] space-y-0.5">
          <p>🏗️ BTP</p>
          <p className="ml-4">└─ 🔧 Plombier</p>
          <p className="ml-8">├─ Débouchage</p>
          <p className="ml-8">├─ Réparation fuite</p>
          <p className="ml-8">└─ Installation sanitaire</p>
          <p className="ml-4">└─ 🔌 Électricien</p>
          <p className="ml-8">├─ Mise aux normes</p>
          <p className="ml-8">└─ Installation tableau</p>
        </div>
      </div>
    </div>
  );
}
