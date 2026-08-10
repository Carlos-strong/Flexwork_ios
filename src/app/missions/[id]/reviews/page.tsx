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
  reviewerId: string;
  createdAt: string;
};

// Notation après mission — client et prestataire peuvent noter (1 à 5).
// Suspendu si une médiation a été ouverte sur cette mission.
export default function ReviewsPage() {
  const params = useParams();
  const missionId = params.id as string;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [note, setNote] = useState(5);
  const [commentaire, setCommentaire] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/reviews`);
    if (res.ok) setReviews((await res.json()).items);
  }

  useEffect(() => {
    load();
  }, [missionId]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const res = await fetch(`/api/missions/${missionId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: missionId, note, commentaire: commentaire || undefined }),
    });

    setSubmitting(false);
    if (res.ok) {
      setSuccess("Avis enregistré — merci !");
      setCommentaire("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "mediation_blocked"
          ? "Impossible de donner un avis : une médiation a été ouverte sur cette mission."
          : "Échec de l'enregistrement de l'avis."
      );
    }
  }

  const myReview = reviews?.find((r) => r.reviewerId === userId);

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Avis sur la mission</h1>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* ── Avis existants ── */}
      {reviews && reviews.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              {reviews.length} avis
            </span>
          </div>
          {reviews.map((r) => (
            <div
              key={r.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--primary)" }}>
                  {r.note}/5
                </div>
                <div>
                  {"⭐".repeat(r.note)}
                  {"☆".repeat(5 - r.note)}
                </div>
                <small style={{ color: "var(--muted)" }}>
                  {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                </small>
              </div>
              {r.commentaire && (
                <p style={{ marginTop: 6, fontSize: "0.9rem" }}>{r.commentaire}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Donner un avis ── */}
      {!myReview && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Donner mon avis</span>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Note (1 à 5) <span className="required">*</span></label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNote(n)}
                    style={{
                      fontSize: "1.5rem",
                      background: "none",
                      border: note >= n ? "2px solid var(--accent)" : "2px solid var(--border)",
                      borderRadius: 8,
                      padding: "4px 12px",
                      cursor: "pointer",
                      opacity: note >= n ? 1 : 0.4,
                    }}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Commentaire</label>
              <textarea
                rows={3}
                placeholder="Partagez votre expérience..."
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Envoi..." : "Publier l'avis"}
            </button>
          </form>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <Link href={`/missions/${missionId}`} style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
