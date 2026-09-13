"use client";

// ⚠️ US en attente — cette page n'est couverte par aucune user story dans
// Prompts_Sprints_UserStories.md. L'API route existe (POST /api/missions/[id]/reviews)
// mais le document US ne définit pas de story dédiée pour la notation/avis.
// US-304 mentionne la "note moyenne" comme fait constaté dans le bloc Activité,
// pas comme action utilisateur. À valider avec le PO avant activation.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Review = {
  id: string;
  note: number;
  commentaire: string | null;
  // `authorId`, le nom réel de la colonne (model Review, prisma/schema.prisma). Le type
  // déclarait `reviewerId`, qui n'existe nulle part : `myReview` valait donc toujours
  // `undefined`, le formulaire « Donner mon avis » restait affiché après publication, et une
  // seconde soumission violait la contrainte @@unique([missionId, authorId]).
  authorId: string;
  createdAt: string;
};

// Notation après mission — client et prestataire peuvent noter (1 à 5).
// Suspendu si une médiation a été ouverte sur cette mission.
// Style harmonisé (2026-08-29) sur le système visuel de missions/[id]/page.tsx et
// missions/[id]/devis/page.tsx (Tailwind, palette #0f172a/#E2E8F0/#008751) — remplace les
// classes CSS globales historiques (.card, .btn, style={{}}), inchangées jusqu'ici sur toute
// la chaîne post-acceptation (contrat/escrow/livrable/pointage/médiation/avis). Logique et
// appels API strictement inchangés, seule la présentation change.
export default function ReviewsPage() {
  const params = useParams();
  const missionId = params.id as string;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [reviews, setReviews] = useState<Review[] | null>(null);
  // Contrepartie notable, servie par GET .../reviews. La page ne la déduit pas elle-même :
  // l'arbitrage appartient au serveur (legitimateReviewTarget), et c'est faute de cette donnée
  // que le formulaire envoyait l'id de la mission comme `targetId` — refusé en 403 à tous les
  // coups. `null` = cet utilisateur n'a personne à noter sur cette mission.
  const [target, setTarget] = useState<{ id: string; nom: string } | null>(null);
  const [note, setNote] = useState(5);
  const [commentaire, setCommentaire] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/reviews`);
    if (res.ok) {
      const data = await res.json();
      setReviews(data.items);
      setTarget(data.target ?? null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    if (!target) {
      setSubmitting(false);
      setError("Vous n'êtes pas partie au contrat de cette mission : aucun avis n'est possible.");
      return;
    }

    const res = await fetch(`/api/missions/${missionId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.id, note, commentaire: commentaire || undefined }),
    });

    setSubmitting(false);
    if (res.ok) {
      setSuccess("Avis enregistré — merci !");
      setCommentaire("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "mission_not_completed"
          ? "Les avis s'ouvrent une fois la mission validée et clôturée."
          : data.error === "already_reviewed"
            ? "Vous avez déjà publié un avis sur cette mission."
          : data.error === "invalid_target"
            ? "Vous n'êtes pas partie au contrat de cette mission : aucun avis n'est possible."
            : data.error === "mediation_blocked"
          ? "Impossible de donner un avis : une médiation a été ouverte sur cette mission."
          : "Échec de l'enregistrement de l'avis."
      );
    }
  }

  const myReview = reviews?.find((r) => r.authorId === userId);

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[640px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Avis</span>
        </div>

        <h1 className="text-[18px] font-bold">Avis sur la mission</h1>

        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}
        {success && <div className="rounded-xl border border-[#A7F3D0] bg-[#E6F4EE] p-3 text-[13px] text-[#008751]">{success}</div>}

        {/* ── Avis existants ── */}
        {reviews && reviews.length > 0 && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
              <h3 className="text-[13px] font-semibold">{reviews.length} avis</h3>
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {reviews.map((r) => (
                <div key={r.id} className="px-4 lg:px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="text-[16px] font-bold text-[#008751]">{r.note}/5</div>
                    <div className="text-[#F7C948] text-[14px] leading-none">
                      {"⭐".repeat(r.note)}
                      <span className="text-[#E2E8F0]">{"☆".repeat(5 - r.note)}</span>
                    </div>
                    <span className="text-[11px] text-[#94A3B8]">{new Date(r.createdAt).toLocaleDateString("fr-FR")}</span>
                  </div>
                  {r.commentaire && <p className="mt-1.5 text-[13px] text-[#475569] leading-relaxed">{r.commentaire}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Donner un avis ── */}
        {!myReview && target && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <h3 className="text-[13px] font-semibold mb-3">Noter {target.nom}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Note (1 à 5) <span className="text-[#E8112D]">*</span></label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNote(n)}
                      className={`text-[22px] leading-none px-3 py-1.5 rounded-lg border-2 transition-opacity ${note >= n ? "border-[#F7C948] opacity-100" : "border-[#E2E8F0] opacity-40"}`}
                    >
                      ⭐
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Commentaire</label>
                <textarea
                  rows={3}
                  placeholder="Partagez votre expérience..."
                  value={commentaire}
                  onChange={(e) => setCommentaire(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50"
              >
                {submitting ? "Envoi..." : "Publier l'avis"}
              </button>
            </form>
          </div>
        )}

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
