"use client";

// « Mes services » (2026-11-08) — gestion des Gigs du prestataire, intégrée au profil
// (/profile?tab=services) et à la rubrique Offres du tableau de bord.
//
// Liste COMPACTE plutôt que grille de cartes : la rubrique vit dans la colonne étroite du
// profil, où des cartes à couverture pleine laissaient un service par écran sur mobile et
// faisaient déborder les boutons d'action sur la carte voisine. Chaque ligne dit :
//   - ce que c'est (vignette, titre, prix de départ, nombre de formules et de commandes) ;
//   - où il en est (statut, et pour un brouillon CE QUI MANQUE pour publier) ;
//   - quoi faire (Modifier, Publier / Mettre en pause, menu « ⋯ » : voir, clôturer, supprimer).
//
// Suppression : seulement un service jamais commandé (le serveur refuse sinon, 409) — un
// service commandé se clôture, ses commandes restent consultables. Confirmation en ligne,
// dans la rangée, jamais une boîte de dialogue du navigateur.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GigEditor } from "@/components/gig/GigEditor";
import { publishChecklist } from "@/lib/gig-rules";
import type { GigView } from "@/lib/gig-serialize";

type MyGig = Omit<GigView, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string; ordersCount: number };
type Filter = "tous" | "publie" | "brouillon" | "cloture";

const STATUS: Record<string, { label: string; className: string; dot: string }> = {
  publie: { label: "En ligne", className: "bg-emerald-50 text-[#008751]", dot: "bg-[#008751]" },
  brouillon: { label: "Brouillon", className: "bg-zinc-100 text-zinc-700", dot: "bg-zinc-400" },
  cloture: { label: "Clôturé", className: "bg-zinc-800 text-white", dot: "bg-white" },
};
const ORDER: Record<string, number> = { publie: 0, brouillon: 1, cloture: 2 };
const FILTERS: { key: Filter; label: string }[] = [
  { key: "tous", label: "Tous" },
  { key: "publie", label: "En ligne" },
  { key: "brouillon", label: "Brouillons" },
  { key: "cloture", label: "Clôturés" },
];

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// Libellés courts de la checklist : une ligne lisible dans la liste (la checklist complète est
// dans l'éditeur).
const SHORT: Record<string, string> = {
  titre: "titre « Je vais… »",
  formules: "3 formules",
  description: "description (120 caractères)",
  visuel: "visuel",
  tags: "mots-clés",
};

/** Ce qui manque pour publier — la checklist du guide, en clair. */
function missingForPublish(g: MyGig): string[] {
  return publishChecklist({
    titre: g.titre,
    description: g.description,
    tags: g.tags,
    packagesValid: g.packages.length === 3,
    hasImage: g.images.length > 0,
    hasVideo: !!g.videoEmbedUrl,
  })
    .filter((c) => !c.done)
    .map((c) => SHORT[c.key] ?? c.label.toLowerCase());
}

export function GigManager({
  defaultDomaine,
  onChanged,
  publicProfileHref,
}: {
  defaultDomaine?: string | null;
  onChanged?: () => void;
  /** Lien vers le profil public, pour « Voir comme un client ». */
  publicProfileHref?: string;
}) {
  const [gigs, setGigs] = useState<MyGig[] | null>(null);
  const [filter, setFilter] = useState<Filter>("tous");
  const [editing, setEditing] = useState<MyGig | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/gigs?mine=true").catch(() => null);
    const data = res?.ok ? await res.json() : { items: [] };
    setGigs(data.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Menu « ⋯ » : se ferme au clic ailleurs et à Échap.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-menu="${menuFor}"]`)) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { tous: gigs?.length ?? 0, publie: 0, brouillon: 0, cloture: 0 };
    for (const g of gigs ?? []) c[g.status as Filter] = (c[g.status as Filter] ?? 0) + 1;
    return c;
  }, [gigs]);

  const visible = useMemo(
    () =>
      [...(gigs ?? [])]
        .filter((g) => filter === "tous" || g.status === filter)
        .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updatedAt.localeCompare(a.updatedAt)),
    [gigs, filter],
  );

  function openEditor(target: MyGig | "new") {
    setMsg(null);
    setMenuFor(null);
    setConfirmDelete(null);
    setEditing(target);
    requestAnimationFrame(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function setStatus(g: MyGig, status: "publie" | "brouillon" | "cloture") {
    setBusyId(g.id);
    setMsg(null);
    setMenuFor(null);
    const res = await fetch(`/api/gigs/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setMsg({ text: data?.message ?? "Action impossible. Réessayez.", ok: false });
      // Incomplet (formules ou visuel manquants) : on ouvre directement l'éditeur.
      if (status === "publie" && (data?.error === "packages_required" || data?.error === "visual_required")) openEditor(g);
      return;
    }
    setMsg({
      text:
        status === "publie"
          ? `« ${g.titre} » est en ligne.`
          : status === "cloture"
            ? `« ${g.titre} » est clôturé : il n'apparaît plus dans le catalogue.`
            : `« ${g.titre} » est en pause (brouillon).`,
      ok: true,
    });
    await load();
    onChanged?.();
  }

  async function remove(g: MyGig) {
    setBusyId(g.id);
    setMsg(null);
    const res = await fetch(`/api/gigs/${g.id}`, { method: "DELETE" }).catch(() => null);
    setBusyId(null);
    setConfirmDelete(null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setMsg({ text: data?.message ?? "Suppression impossible. Réessayez.", ok: false });
      return;
    }
    setMsg({ text: `« ${g.titre} » a été supprimé.`, ok: true });
    await load();
    onChanged?.();
  }

  if (editing) {
    return (
      <div ref={rootRef} className="scroll-mt-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-semibold text-[#0A1931]">
            {editing === "new" ? "Nouveau service" : `Modifier : ${editing.titre}`}
          </p>
          <button type="button" onClick={() => setEditing(null)} className="text-[13px] font-medium text-zinc-500 hover:text-[#0A1931]">
            ← Retour à la liste
          </button>
        </div>
        {editing !== "new" && editing.ordersCount > 0 && (
          <p className="rounded-xl bg-sky-50 px-4 py-2.5 text-[12.5px] text-sky-900">
            Les {editing.ordersCount} commande{editing.ordersCount > 1 ? "s" : ""} déjà passée{editing.ordersCount > 1 ? "s" : ""} gardent
            les conditions acceptées à l&apos;achat : vos modifications ne valent que pour les prochaines.
          </p>
        )}
        <GigEditor
          gig={
            editing === "new"
              ? null
              : { ...editing, createdAt: new Date(editing.createdAt), updatedAt: new Date(editing.updatedAt) }
          }
          defaultDomaine={defaultDomaine}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setMsg({ text: "Service enregistré.", ok: true });
            await load();
            onChanged?.();
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="scroll-mt-6 space-y-4">
      {/* Barre d'outils : filtres par statut + création */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrer les services" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              disabled={f.key !== "tous" && counts[f.key] === 0}
              className={`h-8 rounded-full px-3 text-[12.5px] font-medium transition disabled:opacity-40 ${
                filter === f.key ? "bg-[#0A1931] text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => openEditor("new")}
          className="h-10 px-5 rounded-full bg-[#FF6B35] text-white text-[13px] font-semibold hover:bg-[#E85A24] transition"
        >
          + Nouveau service
        </button>
      </div>

      {msg && (
        <p role="status" className={`rounded-xl px-4 py-2.5 text-[13px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </p>
      )}

      {gigs === null ? (
        <ul className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <li key={i} className="h-[92px] animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </ul>
      ) : gigs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center">
          <p className="text-[15px] font-semibold text-[#0A1931]">Proposez votre premier service</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-zinc-500">
            Une offre à prix fixe en trois formules, qu&apos;un client commande en quelques clics — paiement sous séquestre.
          </p>
          <button
            type="button"
            onClick={() => openEditor("new")}
            className="mt-4 h-10 px-5 rounded-full bg-[#FF6B35] text-white text-[13px] font-semibold hover:bg-[#E85A24]"
          >
            + Créer un service
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
          {visible.map((g) => {
            const st = STATUS[g.status] ?? STATUS.brouillon;
            const missing = g.status !== "cloture" ? missingForPublish(g) : [];
            const busy = busyId === g.id;
            const canDelete = g.ordersCount === 0;
            return (
              <li key={g.id} className="p-3 sm:p-4">
                <div className="flex gap-3 sm:gap-4">
                  {/* Vignette */}
                  <button
                    type="button"
                    onClick={() => openEditor(g)}
                    aria-label={`Modifier ${g.titre}`}
                    className="relative h-[48px] w-[72px] sm:h-[72px] sm:w-[116px] shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#0A1931] to-[#1B9C6A]"
                  >
                    {g.coverUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- servie par /api/gigs/[id]/images */}
                        <img src={g.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        {g.images.length > 1 && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">
                            {g.images.length} photos
                          </span>
                        )}
                      </>
                    ) : g.videoEmbedUrl ? (
                      <span className="absolute inset-0 grid place-items-center text-[20px] text-white" aria-hidden>
                        ▶
                      </span>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center px-1 text-center text-[10px] font-semibold text-white/80">
                        Sans visuel
                      </span>
                    )}
                  </button>

                  {/* Infos */}
                  <div className="min-w-0 flex-1">
                    {/* Mobile : statut sous le titre, pour laisser au titre toute la largeur. */}
                    <div className="flex flex-col-reverse items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
                      <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#0A1931]">{g.titre}</p>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.className}`}>
                        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-zinc-500">
                      dès <span className="font-semibold text-[#0A1931]">{g.prixDepart.toLocaleString("fr-FR")} {g.currency}</span>
                      {" · "}
                      {g.packages.length ? `${g.packages.length} formules` : "prix unique"}
                      {" · "}
                      {g.ordersCount} commande{g.ordersCount > 1 ? "s" : ""}
                      <span className="hidden sm:inline"> · modifié {ago(g.updatedAt)}</span>
                    </p>
                    {missing.length > 0 && (
                      <p className="mt-1 text-[12px] text-amber-700">
                        {g.packages.length === 0 ? "Ancien format — à compléter" : g.status === "publie" ? "À compléter" : "Pour publier"} :{" "}
                        {missing.join(", ")}.
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {confirmDelete === g.id ? (
                  <div role="alertdialog" aria-label={`Supprimer ${g.titre}`} className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-[13px] text-red-800">
                      Supprimer définitivement « {g.titre} » ? Ses formules et son visuel seront effacés. Cette action est irréversible.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(g)}
                        className="h-8 px-3 rounded-full bg-red-600 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {busy ? "Suppression…" : "Supprimer définitivement"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="h-8 px-3 rounded-full border border-zinc-200 bg-white text-[12px] text-zinc-600 hover:bg-zinc-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:pl-[132px]">
                    <button
                      type="button"
                      onClick={() => openEditor(g)}
                      className="h-8 px-3 rounded-full border border-zinc-200 bg-white text-[12px] font-semibold text-[#0A1931] hover:bg-zinc-50"
                    >
                      Modifier
                    </button>
                    {g.status === "publie" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setStatus(g, "brouillon")}
                        className="h-8 px-3 rounded-full border border-zinc-200 bg-white text-[12px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        Mettre en pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => (missing.length ? openEditor(g) : void setStatus(g, "publie"))}
                        className="h-8 px-3 rounded-full bg-[#008751] text-[12px] font-semibold text-white hover:bg-[#006e43] disabled:opacity-50"
                      >
                        {missing.length ? "Compléter pour publier" : g.status === "cloture" ? "Remettre en ligne" : "Publier"}
                      </button>
                    )}
                    <div className="relative" data-menu={g.id}>
                      <button
                        type="button"
                        onClick={() => setMenuFor((m) => (m === g.id ? null : g.id))}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === g.id}
                        aria-label={`Plus d'actions — ${g.titre}`}
                        className="h-8 w-8 rounded-full border border-zinc-200 bg-white text-[15px] leading-none text-zinc-600 hover:bg-zinc-50"
                      >
                        ⋯
                      </button>
                      {menuFor === g.id && (
                        <ul
                          role="menu"
                          className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                        >
                          {g.status === "publie" && publicProfileHref && (
                            <li role="none">
                              <Link
                                role="menuitem"
                                href={publicProfileHref}
                                className="block px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50"
                                style={{ textDecoration: "none" }}
                              >
                                Voir comme un client
                              </Link>
                            </li>
                          )}
                          {g.status !== "cloture" && (
                            <li role="none">
                              <button
                                role="menuitem"
                                type="button"
                                onClick={() => void setStatus(g, "cloture")}
                                className="block w-full px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50"
                              >
                                Clôturer
                                <span className="block text-[11px] text-zinc-400">Retiré du catalogue, commandes conservées</span>
                              </button>
                            </li>
                          )}
                          <li role="none">
                            <button
                              role="menuitem"
                              type="button"
                              disabled={!canDelete}
                              onClick={() => {
                                setMenuFor(null);
                                setConfirmDelete(g.id);
                              }}
                              className="block w-full px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
                            >
                              Supprimer
                              {!canDelete && (
                                <span className="block text-[11px] text-zinc-400">Impossible : déjà commandé — clôturez-le</span>
                              )}
                            </button>
                          </li>
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {visible.length === 0 && <li className="p-6 text-center text-[13px] text-zinc-500">Aucun service dans ce filtre.</li>}
        </ul>
      )}
    </div>
  );
}
