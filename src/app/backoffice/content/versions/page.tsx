"use client";

import { useCallback, useEffect, useState } from "react";
import { ForbiddenNotice, PublishBar } from "@/components/admin/frontend-console";
import { AdminPageHeader } from "@/components/admin/admin-ui";
import { useIsReadOnly } from "@/components/admin/admin-role-context";

type Release = {
  id: string;
  version: number;
  publishedAt: string;
  note: string | null;
  rolledBackFromVersion: number | null;
  publishedBy: { id: string; firstname: string | null; lastname: string | null; email: string } | null;
};

// Historique des publications.
//
// Un retour arrière ne réécrit rien : il republie l'instantané choisi sous un NOUVEAU numéro.
// Revenir de la v24 à la v23 produit une v25 identique à la v23 — la v24 reste consultable, et
// le geste lui-même reste lisible au lieu de disparaître avec ce qu'il corrige.
export default function VersionsPage() {
  const readOnly = useIsReadOnly("contenu");
  const [releases, setReleases] = useState<Release[]>([]);
  const [forbidden, setForbidden] = useState(false);
  // Incrémenté à chaque rechargement réussi — sert de signal à la barre de publication.
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/frontend/releases");
    if (res.status === 403 || res.status === 401) return setForbidden(true);
    if (res.ok) setReleases((await res.json()).releases);
    setRevision((n) => n + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function rollback(version: number) {
    setBusy(version);
    setFeedback(null);
    const res = await fetch(`/api/admin/frontend/releases/${version}`, { method: "POST" });
    setBusy(null);
    setConfirming(null);
    if (res.ok) {
      const data = await res.json();
      setFeedback(`Contenu de la v${version} republié en v${data.version}.`);
      return load();
    }
    if (res.status === 403) return setFeedback("Publication réservée au rôle « frontend ».");
    setFeedback("Retour arrière refusé.");
  }

  if (forbidden) return <ForbiddenNotice />;

  const current = releases[0]?.version;

  return (
    <>
      <AdminPageHeader icon="↺" title="Versions" subtitle="Chaque publication fige l’état complet du contenu public." readOnly={readOnly} />
      <PublishBar revision={revision} onPublished={load} />

      {feedback && (
        <div className="bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534] rounded-xl px-4 py-2.5 text-[12px]">
          {feedback}
        </div>
      )}

      <p className="text-[12px] text-[#5A5750] max-w-3xl">
        Chaque publication fige l’état complet du contenu. C’est cet instantané que sert{" "}
        <code className="font-mono text-[11px]">/api/frontend/config</code>, jamais les tables
        d’édition — une section en cours d’écriture ne peut donc pas atteindre le site public.
      </p>
      <p className="text-[12px] text-[#5A5750] max-w-3xl">
        Un retour arrière republie l’instantané choisi sous un nouveau numéro : il change ce qui
        est <em>servi</em>, pas ce qui est <em>en cours d’édition</em>. Vos brouillons restent
        donc intacts, et la barre ci-dessus signalera de nouveau « brouillon en attente » —
        c’est normal, et c’est ce qui évite qu’un retour arrière efface au passage un travail
        sans rapport avec le problème qu’il corrige.
      </p>

      <div className="bg-white border border-[#E2E0D9] rounded-xl divide-y divide-[#E2E0D9]">
        {releases.map((release) => {
          const isCurrent = release.version === current;
          return (
            <div key={release.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-[13px] font-bold w-14">v{release.version}</span>

              {isCurrent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0]">
                  en ligne
                </span>
              )}
              {release.rolledBackFromVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE]">
                  reprise de la v{release.rolledBackFromVersion}
                </span>
              )}

              <div className="min-w-0">
                <p className="text-[12px] text-[#1A1916] truncate">
                  {release.note ?? <span className="text-[#9C9A95]">Publiée sans note</span>}
                </p>
                <p className="text-[11px] text-[#9C9A95]">
                  {new Date(release.publishedAt).toLocaleString("fr-FR")} ·{" "}
                  {release.publishedBy
                    ? release.publishedBy.email
                    : "publication initiale posée par le seed"}
                </p>
              </div>

              {!isCurrent && (
                <div className="ml-auto flex items-center gap-2">
                  {confirming === release.version ? (
                    <>
                      <span className="text-[11px] text-[#5A5750]">
                        Republier ce contenu en v{(current ?? 0) + 1} ?
                      </span>
                      <button
                        onClick={() => rollback(release.version)}
                        disabled={busy !== null}
                        className="h-7 px-2.5 rounded-lg bg-[#1A1916] text-white text-[11px] font-bold"
                      >
                        {busy === release.version ? "…" : "Confirmer"}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="h-7 px-2.5 rounded-lg border border-[#E2E0D9] text-[11px]"
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirming(release.version)}
                      className="h-7 px-2.5 rounded-lg border border-[#E2E0D9] text-[11px] font-medium hover:bg-[#FAFAF8]"
                    >
                      Revenir à cette version
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {releases.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-[#9C9A95] text-center">
            Aucune publication. Le site public rend le socle de repli.
          </p>
        )}
      </div>
    </>
  );
}
