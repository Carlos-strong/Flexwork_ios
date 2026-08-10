"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import { canAttachLivrable } from "@/lib/attachments";

type MissionDetail = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  budget: number;
  currency: string;
  delaiJours: number;
  riskLevel: string;
  insuranceRequired: boolean;
  status: string;
  clientId: string;
  createdAt: string;
  isOwner: boolean;
  professionalType: string | null;
  requiredLevel: string | null;
  budgetType: string | null;
  tags: string[];
};

const PROFESSIONAL_TYPE_LABEL: Record<string, string> = {
  EXPERT_DIGITAL: "Expert Digital",
  EXPERT_BTP: "Expert BTP / Autres",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

const BUDGET_TYPE_LABEL: Record<string, string> = {
  FIXED: "Prix fixe",
  RATE: "Taux (horaire/journalier)",
  QUOTE: "Demande de devis",
};

type AttachmentItem = { id: string; fileName: string | null; uploaderEmail: string | null; createdAt: string; url: string };

// Détail d'une mission — accessible au client propriétaire et aux prestataires.
// Affiche le statut, les informations clés et les actions disponibles.
export default function MissionDetailPage() {
  const params = useParams();
  const missionId = params.id as string;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isClient = role === "client";

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [attachments, setAttachments] = useState<AttachmentItem[] | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  useEffect(() => {
    fetch(`/api/missions/${missionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setMission)
      .finally(() => setLoading(false));
  }, [missionId]);

  useEffect(() => {
    fetch(`/api/missions/${missionId}/attachments`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAttachments(d.items))
      .catch(() => setAttachments([]));
  }, [missionId]);

  async function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachError(null);
    setUploadingAttachment(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/missions/${missionId}/attachments`, { method: "POST", body: formData });
    setUploadingAttachment(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAttachError(
        data.error === "attachment_blocked_before_proposal_accepted"
          ? "Impossible de joindre un fichier avant qu'une proposition ne soit acceptée (évite le travail-test gratuit)."
          : "Échec de l'envoi du fichier."
      );
      return;
    }
    const listRes = await fetch(`/api/missions/${missionId}/attachments`);
    if (listRes.ok) setAttachments((await listRes.json()).items);
  }

  if (loading) return <div className="container">Chargement...</div>;
  if (!mission) return <div className="container">Mission introuvable.</div>;

  // MISSION_STATUS_STYLE (src/lib/mission-status.ts) — même source que /missions et le
  // dashboard client, plutôt qu'une 3e copie locale qui, comme les deux précédentes,
  // omettait "fonds_sous_sequestre" et "validee" (statuts posés par le webhook PSP).
  const st = MISSION_STATUS_STYLE[mission.status as keyof typeof MISSION_STATUS_STYLE] ?? MISSION_STATUS_STYLE.brouillon;
  const canApply = mission.status === "publiee" && !isClient && !mission.isOwner;
  const canUploadAttachment = canAttachLivrable(mission.status as Parameters<typeof canAttachLivrable>[0]);

  return (
    <div className="container" style={{ maxWidth: 800 }}>
      {/* ── En-tête ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ color: "var(--primary)", marginBottom: 8 }}>{mission.titre}</h1>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              Publiée le {new Date(mission.createdAt).toLocaleDateString("fr-FR")}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${st.dot}`}></span>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{st.label}</span>
          </div>
        </div>
      </div>

      {/* ── Infos clés ── */}
      <div className="grid-3" style={{ marginBottom: 20 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 4 }}>Budget</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--primary)" }}>
            {mission.budget.toLocaleString("fr-FR")} {mission.currency}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 4 }}>Délai</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--secondary)" }}>
            {mission.delaiJours} jours
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: 4 }}>Risque</div>
          <span
            className={`badge ${
              mission.riskLevel === "high"
                ? "badge-unverified"
                : mission.riskLevel === "medium"
                ? "badge-declared"
                : "badge-verified"
            }`}
          >
            {mission.riskLevel?.toUpperCase?.()}
          </span>
          {mission.insuranceRequired && (
            <div style={{ fontSize: "0.75rem", color: "var(--danger)", marginTop: 4 }}>
              Assurance obligatoire
            </div>
          )}
        </div>
      </div>

      {/* ── Description ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Description</span>
        </div>
        <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{mission.description}</p>
        <div style={{ marginTop: 16, fontSize: "0.85rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div><strong>Domaine :</strong> {mission.domaine}</div>
          {mission.professionalType && (
            <div><strong>Recherché :</strong> {PROFESSIONAL_TYPE_LABEL[mission.professionalType] ?? mission.professionalType}{mission.requiredLevel ? ` — Niveau ${mission.requiredLevel}` : ""}</div>
          )}
          {mission.budgetType && (
            <div><strong>Rémunération :</strong> {BUDGET_TYPE_LABEL[mission.budgetType] ?? mission.budgetType}</div>
          )}
        </div>
        {mission.tags && mission.tags.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mission.tags.map((tag) => (
              <span key={tag} style={{ fontSize: "0.75rem", fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: "var(--light, #f4f4f5)", color: "var(--muted)" }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Actions</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canApply && (
            <Link
              href={`/dashboard/${role === "expert_digital" ? "expert-digital" : role === "expert_btp_autres" ? "expert-btp" : role === "artisan" ? "artisan" : role === "manoeuvre" ? "manoeuvre" : "provider"}`}
              className="btn btn-primary"
            >
              Candidater
            </Link>
          )}
          {mission.isOwner && mission.status === "publiee" && (
            <Link href={`/missions/${mission.id}/proposals`} className="btn btn-secondary">
              Voir les propositions
            </Link>
          )}
          {mission.status !== "brouillon" && mission.status !== "publiee" && (
            <Link href={`/missions/${mission.id}/contract`} className="btn btn-primary">
              Voir le contrat
            </Link>
          )}
          {mission.status === "contrat_signe" && !mission.isOwner && (
            <Link href={`/missions/${mission.id}/deliverable`} className="btn btn-accent">
              Soumettre le livrable
            </Link>
          )}
          <Link href={`/missions/${mission.id}/chat`} className="btn btn-outline">
            Messagerie
          </Link>
          {mission.status === "cloturee" && (
            <Link href={`/missions/${mission.id}/reviews`} className="btn btn-outline">
              Donner un avis
            </Link>
          )}
        </div>
      </div>

      {/* ── Pièces jointes ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Pièces jointes</span>
        </div>

        {attachError && (
          <div className="alert alert-warning" style={{ marginBottom: 12 }}>{attachError}</div>
        )}

        {attachments === null ? (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Chargement...</p>
        ) : attachments.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Aucune pièce jointe pour l&apos;instant.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {attachments.map((a) => (
              <li key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border, #eee)" }}>
                <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontSize: "0.9rem", fontWeight: 600 }}>
                  {a.fileName ?? "Fichier"}
                </a>
                <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                  {a.uploaderEmail ?? "?"} · {new Date(a.createdAt).toLocaleDateString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canUploadAttachment ? (
          <div style={{ marginTop: 14 }}>
            <label className="btn btn-outline" style={{ cursor: "pointer", display: "inline-block" }}>
              {uploadingAttachment ? "Envoi..." : "+ Joindre un fichier"}
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleAttachmentUpload} disabled={uploadingAttachment} style={{ display: "none" }} />
            </label>
          </div>
        ) : (
          <p style={{ marginTop: 14, color: "var(--muted)", fontSize: "0.8rem" }}>
            L&apos;ajout de pièces jointes sera possible une fois une proposition acceptée (évite le travail-test gratuit).
          </p>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <Link href="/missions" style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          ← Retour aux missions
        </Link>
      </div>
    </div>
  );
}
