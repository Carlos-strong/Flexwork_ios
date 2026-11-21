"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { countryFlag } from "@/lib/country-flag";
import { countryName } from "@/lib/world-countries";

// Section « Avis » du profil public (2026-11-10), alimentée par GET /api/users/[id]/reviews.
// Structure inspirée des places de marché de services : note globale et répartition par
// étoiles (cliquable = filtre), détail des sous-notes, filtres et tri, puis des cartes d'avis
// avec leur contexte (prix, durée, métier, collaboration récurrente) et « Utile ? Oui / Non ».
// Le client n'est jamais nommé : pays, identité vérifiée ou non, et c'est tout.

type Review = {
  id: string;
  note: number;
  sousNotes: { communication: number | null; qualite: number | null; valeur: number | null };
  commentaire: string | null;
  createdAt: string;
  pays: string | null;
  clientVerifie: boolean;
  recurrent: boolean;
  metier: string | null;
  prix: string | null;
  duree: string | null;
  utileCount: number;
  monVote: boolean | null;
  peutVoter: boolean;
};

type Page = {
  total: number;
  counts: { tous: number; avecCommentaire: number; recurrents: number };
  offset: number;
  items: Review[];
};

type Sort = "pertinents" | "recents" | "meilleurs" | "moins_bons";
const SORT_LABELS: Record<Sort, string> = {
  pertinents: "Les plus pertinents",
  recents: "Les plus récents",
  meilleurs: "Meilleures notes",
  moins_bons: "Notes les plus basses",
};

const PAGE_SIZE = 5;
const COMMENT_PREVIEW = 280;

export function ProfileReviews({
  userId,
  averageNote,
  reviewCount,
  breakdown,
  subRatings,
  isLoggedIn,
}: {
  userId: string;
  averageNote: number | null;
  reviewCount: number;
  breakdown: { note: number; count: number }[];
  subRatings?: { communication: number | null; qualite: number | null; valeur: number | null };
  isLoggedIn: boolean;
}) {
  const [sort, setSort] = useState<Sort>("pertinents");
  const [note, setNote] = useState<number | null>(null);
  const [avecCommentaire, setAvecCommentaire] = useState(false);
  const [recurrents, setRecurrents] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(false);
      const sp = new URLSearchParams({ sort, offset: String(offset), take: String(PAGE_SIZE) });
      if (note) sp.set("note", String(note));
      if (avecCommentaire) sp.set("avecCommentaire", "1");
      if (recurrents) sp.set("recurrents", "1");
      try {
        const r = await fetch(`/api/users/${userId}/reviews?${sp}`);
        if (!r.ok) throw new Error(String(r.status));
        const d: Page = await r.json();
        setPage(d);
        setItems((prev) => (offset === 0 ? d.items : [...prev, ...d.items]));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [userId, sort, note, avecCommentaire, recurrents],
  );

  useEffect(() => {
    if (reviewCount > 0) load(0);
  }, [load, reviewCount]);

  function patch(id: string, p: Partial<Review>) {
    setItems((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  const subs = [
    { label: "Communication", value: subRatings?.communication ?? null },
    { label: "Qualité du travail livré", value: subRatings?.qualite ?? null },
    { label: "Rapport qualité-prix", value: subRatings?.valeur ?? null },
  ].filter((s) => s.value != null) as { label: string; value: number }[];

  return (
    <section id="avis" aria-labelledby="avis-titre" className="scroll-mt-6 bg-white rounded-2xl border border-[#E7E2F0] shadow-sm p-5 sm:p-6">
      <h2 id="avis-titre" className="text-[17px] font-bold text-[#191224]">
        Avis
      </h2>

      {reviewCount === 0 ? (
        <p className="mt-2 text-[14px] text-[#6B6478]">
          Pas encore d&apos;avis. Les avis viennent des clients, à la fin d&apos;une mission menée sur Flexwork.
        </p>
      ) : (
        <>
          {/* ── Synthèse : répartition par étoiles + détail des notes ── */}
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <p className="flex items-baseline gap-2 text-[15px] font-semibold text-[#191224]">
                {reviewCount} avis
                {averageNote != null && (
                  <span className="inline-flex items-center gap-1">
                    <Stars value={averageNote} />
                    <span>{averageNote.toFixed(1)}</span>
                  </span>
                )}
              </p>
              <ul className="mt-3 space-y-1" aria-label="Répartition des notes — cliquez pour filtrer">
                {breakdown.map((b) => {
                  const active = note === b.note;
                  return (
                    <li key={b.note}>
                      <button
                        type="button"
                        disabled={b.count === 0}
                        onClick={() => setNote(active ? null : b.note)}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 rounded-md px-1 py-0.5 text-left text-[13px] transition ${
                          active ? "bg-[#EFEAF8]" : "hover:bg-[#F6F5FA]"
                        } disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent`}
                      >
                        <span className={`w-16 shrink-0 ${active ? "font-semibold text-[#191224]" : "text-[#4A4258]"}`}>
                          {b.note} étoile{b.note > 1 ? "s" : ""}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#E7E2F0]" aria-hidden>
                          <span className="block h-full rounded-full bg-[#191224]" style={{ width: `${(b.count / reviewCount) * 100}%` }} />
                        </span>
                        <span className="w-10 shrink-0 text-right text-[#6B6478]">({b.count})</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {subs.length > 0 && (
              <div>
                <p className="text-[15px] font-semibold text-[#191224]">Détail des notes</p>
                <dl className="mt-3 space-y-2">
                  {subs.map((s) => (
                    <div key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
                      <dt className="text-[#4A4258]">{s.label}</dt>
                      <dd className="flex items-center gap-1 font-semibold text-[#191224]">
                        <span className="text-[#F7C948]" aria-hidden>
                          ★
                        </span>
                        {s.value.toFixed(1)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* ── Filtres et tri ── */}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#E7E2F0] pt-4">
            <Toggle checked={avecCommentaire} onChange={setAvecCommentaire} disabled={!page?.counts.avecCommentaire}>
              Avec commentaire{page ? ` (${page.counts.avecCommentaire})` : ""}
            </Toggle>
            <Toggle checked={recurrents} onChange={setRecurrents} disabled={!page?.counts.recurrents}>
              Clients récurrents{page ? ` (${page.counts.recurrents})` : ""}
            </Toggle>
            {note && (
              <button
                type="button"
                onClick={() => setNote(null)}
                className="rounded-full bg-[#191224] px-3 py-1 text-[12px] font-semibold text-white"
                aria-label={`Retirer le filtre ${note} étoile${note > 1 ? "s" : ""}`}
              >
                {note} ★ ✕
              </button>
            )}
            <label className="ml-auto flex items-center gap-2 text-[13px] text-[#6B6478]">
              Trier par
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-9 rounded-lg border border-[#E7E2F0] bg-white px-2 text-[13px] font-semibold text-[#191224]"
              >
                {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {page && (
            <p className="mt-3 text-[12px] text-[#9A93A8]" aria-live="polite">
              {page.total === 0
                ? "Aucun avis ne correspond à ces filtres."
                : `1–${items.length} sur ${page.total} avis`}
            </p>
          )}
          {error && <p className="mt-3 text-[13px] text-[#B42318]">Impossible de charger les avis.</p>}

          {/* ── Liste ── */}
          <ul className="mt-2 divide-y divide-[#E7E2F0]">
            {items.map((a) => (
              <ReviewCard key={a.id} review={a} isLoggedIn={isLoggedIn} onChange={(p) => patch(a.id, p)} />
            ))}
          </ul>

          {page && items.length < page.total && (
            <button
              type="button"
              disabled={loading}
              onClick={() => load(items.length)}
              className="mt-2 h-10 rounded-lg border border-[#191224] px-4 text-[13px] font-semibold text-[#191224] hover:bg-[#F6F5FA] disabled:opacity-50"
            >
              {loading ? "Chargement…" : "Voir plus d'avis"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ReviewCard({ review: a, isLoggedIn, onChange }: { review: Review; isLoggedIn: boolean; onChange: (p: Partial<Review>) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const country = countryName(a.pays) ?? a.pays;
  const comment = a.commentaire?.trim() ?? "";
  const long = comment.length > COMMENT_PREVIEW;

  async function vote(v: boolean) {
    if (busy) return;
    const next = a.monVote === v ? null : v;
    setBusy(true);
    const prev = { monVote: a.monVote, utileCount: a.utileCount };
    // Optimiste : le compteur suit le choix, la réponse du serveur fait foi.
    onChange({ monVote: next, utileCount: a.utileCount + (next === true ? 1 : 0) - (a.monVote === true ? 1 : 0) });
    try {
      const r = await fetch(`/api/reviews/${a.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utile: next }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      onChange({ monVote: d.monVote, utileCount: d.utileCount });
    } catch {
      onChange(prev);
    } finally {
      setBusy(false);
    }
  }

  const context = [
    a.prix && { label: "Prix", value: a.prix },
    a.duree && { label: "Durée", value: a.duree },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <li className="py-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFEAF8] text-[18px]">
          {a.pays ? countryFlag(a.pays) : "👤"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#191224]">
            Client{country ? ` · ${country}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.clientVerifie && (
              <span className="rounded-full border border-[#4C1D95]/25 bg-[#4C1D95]/5 px-2 py-0.5 text-[11px] font-semibold text-[#4C1D95]">
                ✓ Identité vérifiée
              </span>
            )}
            {a.recurrent && (
              <span className="rounded-full border border-[#E7E2F0] bg-[#F6F5FA] px-2 py-0.5 text-[11px] font-semibold text-[#3F3850]">
                ↻ Collaboration récurrente
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 text-[13px]">
        <Stars value={a.note} />
        <span className="font-semibold text-[#191224]">{a.note}</span>
        <span className="text-[#D4CCE3]">·</span>
        <time dateTime={a.createdAt} className="text-[#9A93A8]">
          {relativeDate(a.createdAt)}
        </time>
      </div>

      {comment && (
        <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-[#3F3850]">
          {open || !long ? comment : `${comment.slice(0, COMMENT_PREVIEW).trimEnd()}…`}
          {long && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="font-semibold text-[#191224] underline underline-offset-2"
              >
                {open ? "Réduire" : "Voir plus"}
              </button>
            </>
          )}
        </p>
      )}

      {(context.length > 0 || a.metier) && (
        <div className="mt-3 flex flex-wrap items-stretch gap-x-6 gap-y-2 rounded-xl border border-[#E7E2F0] bg-[#F6F5FA] px-4 py-2.5">
          {context.map((c) => (
            <div key={c.label}>
              <p className="text-[13px] font-semibold text-[#191224]">{c.value}</p>
              <p className="text-[11px] text-[#9A93A8]">{c.label}</p>
            </div>
          ))}
          {a.metier && (
            <div>
              <p className="text-[13px] font-semibold text-[#191224]">{a.metier}</p>
              <p className="text-[11px] text-[#9A93A8]">Métier</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#6B6478]">
        <span>Cet avis vous a été utile ?</span>
        {a.peutVoter ? (
          <>
            <VoteButton active={a.monVote === true} disabled={busy} onClick={() => vote(true)}>
              👍 Oui
            </VoteButton>
            <VoteButton active={a.monVote === false} disabled={busy} onClick={() => vote(false)}>
              👎 Non
            </VoteButton>
          </>
        ) : !isLoggedIn ? (
          <Link href={`/signin?callbackUrl=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`} className="font-semibold text-[#191224] underline underline-offset-2">
            Connectez-vous pour répondre
          </Link>
        ) : null}
        {a.utileCount > 0 && (
          <span className="text-[#9A93A8]">
            · {a.utileCount} personne{a.utileCount > 1 ? "s l'ont" : " l'a"} trouvé utile
          </span>
        )}
      </div>
    </li>
  );
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="text-[14px] leading-none tracking-tight" role="img" aria-label={`${value.toFixed(1).replace(/\.0$/, "")} sur 5`}>
      <span className="text-[#F7C948]">{"★".repeat(full)}</span>
      <span className="text-[#E7E2F0]">{"★".repeat(5 - full)}</span>
    </span>
  );
}

function Toggle({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled && !checked}
      onClick={() => onChange(!checked)}
      className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition disabled:opacity-50 ${
        checked ? "border-[#191224] bg-[#191224] text-white" : "border-[#E7E2F0] bg-white text-[#3F3850] hover:bg-[#F6F5FA]"
      }`}
    >
      {children}
    </button>
  );
}

function VoteButton({ active, disabled, onClick, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 font-semibold transition ${
        active ? "border-[#191224] bg-[#191224] text-white" : "border-[#E7E2F0] bg-white text-[#3F3850] hover:bg-[#F6F5FA]"
      }`}
    >
      {children}
    </button>
  );
}

const RTF = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "aujourd'hui";
  if (days < 7) return RTF.format(-days, "day");
  if (days < 30) return RTF.format(-Math.round(days / 7), "week");
  if (days < 365) return RTF.format(-Math.round(days / 30), "month");
  return RTF.format(-Math.round(days / 365), "year");
}
