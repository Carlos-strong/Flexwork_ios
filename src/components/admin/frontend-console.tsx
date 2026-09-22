"use client";

import { useCallback, useEffect, useState } from "react";

// Console d'administration du frontend : la barre de publication commune, et les états
// partagés par les écrans d'édition.
//
// Elle n'a plus de navigation à elle. Les sept rubriques de la console (vue d'ensemble,
// taxonomie, sections, menus, pages, réglages, versions) sont déclarées dans
// `src/lib/admin-roles.ts` et rendues par la sidebar du rôle, sous « Contenu du site ».
// Deux navigations empilées pour un seul espace, dont une seule filtrée par rôle, c'était
// deux vérités pour un même découpage.
//
// La barre de publication, elle, reste partagée par tous les écrans parce que la question
// qu'elle répond l'est aussi : « ce que je viens d'écrire est-il en ligne ? ». Elle est visible
// en permanence, et non reléguée à un écran « Versions » que personne n'ouvrirait avant de
// partir.

type PublishState = {
  version: number;
  publishedAt: string | null;
  hasPendingChanges: boolean;
};

export function useFrontendPublishState() {
  const [state, setState] = useState<PublishState | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/preview");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    setState({
      version: data.published.version,
      publishedAt: data.published.publishedAt,
      hasPendingChanges: data.hasPendingChanges,
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { state, forbidden, refresh };
}

/**
 * Barre de publication.
 *
 * `revision` est un compteur que l'écran appelant incrémente après chaque modification
 * enregistrée. Sans lui, la barre ne se réévaluerait qu'au chargement : on publierait un
 * domaine, l'écran afficherait « Publié », et la barre continuerait d'annoncer « en ligne à
 * jour » alors qu'une publication est justement devenue nécessaire. Un indicateur qui ne suit
 * pas ce qu'on vient de faire est pire qu'absent.
 *
 * `onPublished` laisse à l'écran le soin de se recharger : la barre ne connaît pas ce qu'il
 * affiche.
 */
export function PublishBar({ revision, onPublished }: { revision?: number; onPublished?: () => void }) {
  const { state, forbidden, refresh } = useFrontendPublishState();

  useEffect(() => {
    if (revision !== undefined) refresh();
  }, [revision, refresh]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function publish() {
    setBusy(true);
    setFeedback(null);
    const res = await fetch("/api/admin/frontend/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setFeedback(`Version ${data.version} publiée.`);
      setNote("");
      await refresh();
      onPublished?.();
    } else if (res.status === 403) {
      setFeedback("Publication réservée au rôle « frontend ».");
    } else {
      setFeedback("Échec de la publication.");
    }
  }

  if (forbidden) return null;

  return (
    <div className="bg-white border border-[#E2E0D9] rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-bold text-[#1A1916]">
          {state ? `Frontend v${state.version}` : "Frontend —"}
        </span>
        {state?.publishedAt && (
          <span className="text-[#9C9A95]">
            publié le {new Date(state.publishedAt).toLocaleString("fr-FR")}
          </span>
        )}
        {state?.version === 0 && <span className="text-[#9C9A95]">jamais publié — socle de repli en ligne</span>}
      </div>

      <span
        className={`text-[11px] px-2 py-0.5 rounded-full border ${
          state?.hasPendingChanges
            ? "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]"
            : "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]"
        }`}
      >
        {state?.hasPendingChanges ? "Brouillon en attente" : "En ligne à jour"}
      </span>

      {feedback && <span className="text-[12px] text-[#5A5750]">{feedback}</span>}

      {/* Note facultative. Sans elle, l'historique n'aligne que des dates et des numéros, et
          « pourquoi cette version ? » reste sans réponse trois semaines plus tard. Le champ
          n'apparaît que lorsqu'il y a quelque chose à publier. */}
      {state?.hasPendingChanges && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && publish()}
          placeholder="Note de publication (facultative)"
          maxLength={200}
          className="ml-auto h-8 w-64 px-2.5 rounded-lg border border-[#E2E0D9] text-[12px] outline-none focus:border-[#2D5BE3]"
        />
      )}

      <button
        onClick={publish}
        disabled={busy || !state?.hasPendingChanges}
        className={`h-8 px-4 rounded-lg text-[12px] font-bold transition ${
          state?.hasPendingChanges ? "" : "ml-auto "
        }${
          busy || !state?.hasPendingChanges
            ? "bg-[#F4F3EF] text-[#9C9A95] cursor-not-allowed"
            : "bg-[#2D5BE3] text-white hover:brightness-110"
        }`}
      >
        {busy ? "Publication…" : "Publier"}
      </button>
    </div>
  );
}

/** Pastille de statut, commune à tous les écrans du module. */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    publie: "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
    brouillon: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]",
    desactive: "bg-[#F4F3EF] text-[#9C9A95] border-[#E2E0D9]",
    archive: "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  };
  const labels: Record<string, string> = {
    publie: "Publié",
    brouillon: "Brouillon",
    desactive: "Désactivé",
    archive: "Archivé",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${styles[status] ?? styles.brouillon}`}>
      {labels[status] ?? status}
    </span>
  );
}

/** Bandeau d'accès refusé, identique sur tous les écrans de la console. */
export function ForbiddenNotice() {
  return (
    <div className="bg-white border border-[#E2E0D9] rounded-xl p-6 text-center">
      <p className="text-[14px] font-bold text-[#1A1916]">Accès refusé</p>
      <p className="mt-2 text-[13px] text-[#5A5750] max-w-prose mx-auto">
        Cette console est réservée au rôle d’administration <code className="font-mono">frontend</code>.
        Le superviseur peut la consulter ; les autres rôles n’y ont pas accès.
      </p>
    </div>
  );
}
