"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { CHANTIER_ROLES } from "@/lib/age-gate";
import { useCanActIn } from "@/components/admin/admin-role-context";
import { AdminPageHeader, KpiStrip, btnSecondary } from "@/components/admin/admin-ui";

type KycDoc = { id: string; type: string; status: string };
type QueueItem = { userId: string; email: string; tel: string; role: string; garantRequired: boolean; createdAt: string; documents: KycDoc[] };

// Document avec URL signée pour visualisation dans le modal (GET /api/admin/kyc/[userId]/documents).
type AdminViewDoc = {
  id: string;
  type: string;
  fileName: string;
  size: number | null;
  status: string;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  url: string;
};

function isImageFile(name: string): boolean {
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
}

const DOC_LABEL: Record<string, string> = {
  piece_identite_recto: "Recto",
  piece_identite_verso: "Verso",
  selfie: "Selfie",
  selfie_avec_piece: "Selfie+pièce",
};

const ROLE_LABEL: Record<string, string> = {
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
  expert_btp_autres: "Expert BTP",
};


const inputClass = "h-10 px-3 rounded-lg border border-[#E2E0D9] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2D5BE3]/20 focus:border-[#2D5BE3]";


// Validation KYC — aligné sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : 5 rôles admin séparés, double validation pour les rejets,
// quota 30 validations/heure, justification obligatoire.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #1A1916/#E2E0D9/#2D5BE3) — logique et appels API strictement inchangés.
export type KycPopulation = "tous" | "clients" | "prestataires";

// Découpage repris de flexwork_job (« Entreprises » / « Freelances »). Ce projet n'a pas
// d'entité entreprise : la ligne de partage réelle passe entre le côté client (le client et le
// responsable de chantier qu'il délègue) et les quatre filières prestataires.
const CLIENT_SIDE_ROLES = ["client", "responsable_chantier"];

const POPULATION_META: Record<KycPopulation, { title: string; subtitle: string }> = {
  tous: {
    title: "KYC et Vérifications",
    subtitle: "Seule vérification effective de la plateforme. Motif obligatoire en cas de rejet, double validation exigée.",
  },
  clients: {
    title: "KYC — Clients",
    subtitle: "Dossiers d’identité des comptes client et des responsables de chantier qu’ils délèguent.",
  },
  prestataires: {
    title: "KYC — Prestataires",
    subtitle: "Dossiers d’identité des quatre filières prestataires. L’âge fait foi pour les filières chantier (A13).",
  },
};

export function KycWorkspace({ population }: { population: KycPopulation }) {
  // Le superviseur ouvre cet écran en consultation (§13) : ses boutons de décision ne
  // pourraient que récolter un 403 — la route exige `requireAdminRole("kyc")`. On les
  // remplace donc par l'état du dossier plutôt que de laisser cliquer dans le vide.
  const canAct = useCanActIn("kyc");

  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  // Modal de visualisation des documents + validation par document.
  const [viewing, setViewing] = useState<{ userId: string; email: string; role: string } | null>(null);
  const [viewDocs, setViewDocs] = useState<AdminViewDoc[] | null>(null);
  // Un seul champ par document (aligné sur KycDocsViewer.tsx et sur le champ unique
  // `justifications` de la table ci-dessus) : ce texte sert à la fois de `justification`
  // (exigée par le serveur pour toute décision) et de `rejectionReason` (visible par
  // l'utilisateur) en cas de rejet — plus besoin de retaper deux fois la même idée.
  const [docInputs, setDocInputs] = useState<Record<string, string>>({});
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [viewDateNaissance, setViewDateNaissance] = useState("");
  // Compte dont le toggle « Garant requis » est en cours (POST .../garant-requirement).
  const [garantBusy, setGarantBusy] = useState<string | null>(null);
  // Comptes de filière chantier pilotables pour l'exigence de garant (indépendant de la file KYC).
  // Plein écran (visualiseur/lecteur) d'un document dans le modal.
  const [lightbox, setLightbox] = useState<AdminViewDoc | null>(null);
  // Document dont le motif est manquant — mis en surbrillance rouge.
  const [missingDocFieldId, setMissingDocFieldId] = useState<string | null>(null);
  // Suppression de compte — le seul geste destructif de cet espace, gardé par `requireAdmin()`
  // générique (il n'appartient à aucun pouvoir métier en particulier). Il vit ICI parce que
  // c'est ici qu'on voit les comptes : dupliqué aussi sur le dashboard du superviseur, il
  // obligeait à maintenir deux fois la même confirmation pour un seul geste.
  const [deleteModal, setDeleteModal] = useState<{ userId: string; email: string } | null>(null);
  const [deleteValues, setDeleteValues] = useState({ confirmEmail: "", justification: "" });

  async function load() {
    const queueRes = await fetch("/api/admin/kyc/queue");
    if (queueRes.ok) setQueue((await queueRes.json()).items);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(userId: string, status: "verifie" | "rejete") {
    const justification = justifications[userId];
    // Motif exigé uniquement pour un rejet — valider un dossier conforme n'a pas besoin
    // d'être justifié.
    if (status === "rejete" && !justification) {
      setFeedback("Motif de rejet obligatoire avant de rejeter un dossier.");
      return;
    }
    const item = queue?.find((q) => q.userId === userId);
    // A13 — la date de naissance (lue sur la pièce) est obligatoire pour valider une filière
    // chantier ; le serveur la refuse sinon (date_naissance_required). On prévient ici pour
    // ne pas laisser croire que la validation a abouti.
    if (
      status === "verifie" &&
      item &&
      (CHANTIER_ROLES as readonly string[]).includes(item.role) &&
      !(dates[userId] ?? "").trim()
    ) {
      setFeedback("Date de naissance obligatoire : dossier de filière chantier (A13). Saisissez la date lue sur la pièce d'identité avant de valider.");
      return;
    }
    setFeedback(null);
    const res = await fetch(`/api/admin/kyc/${userId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        rejectionReason: status === "rejete" ? justification : undefined,
        justification,
        dateNaissance: dates[userId] || undefined,
      }),
    });
    if (res.ok) {
      setFeedback(`Décision ${status.toUpperCase()} enregistrée et journalisée.`);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(
        data.error === "date_naissance_required"
          ? "Date de naissance obligatoire pour cette filière chantier (A13) — saisissez la date lue sur la pièce d'identité."
          : data.error === "kyc_rate_limit_exceeded"
            ? "Quota de 30 validations/heure atteint."
            : "Échec de la décision."
      );
    }
  }

  // Ouvre le modal : liste les documents du compte avec URL signée (5 min) pour visualisation.
  async function openDocs(item: QueueItem) {
    setViewing({ userId: item.userId, email: item.email, role: item.role });
    setViewDocs(null);
    setDocInputs({});
    setViewDateNaissance("");
    const res = await fetch(`/api/admin/kyc/${item.userId}/documents`);
    if (res.ok) setViewDocs((await res.json()).documents);
    else setViewDocs([]);
  }

  // Décision par document : l'état global du compte (kycStatus) est resynchronisé côté serveur.
  async function decideDoc(docId: string, status: "verifie" | "rejete") {
    if (!viewing) return;
    const reason = (docInputs[docId] ?? "").trim();
    // Le motif n'est obligatoire que pour un rejet — valider un document conforme n'a pas
    // besoin d'être justifié.
    if (status === "rejete" && !reason) {
      setMissingDocFieldId(docId);
      setFeedback("⚠️ Motif de rejet obligatoire : saisissez-le dans le champ, puis cliquez à nouveau.");
      return;
    }
    setMissingDocFieldId(null);
    setFeedback(null);
    setDocBusy(docId);
    try {
      const res = await fetch(`/api/admin/kyc/${viewing.userId}/documents/${docId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          rejectionReason: status === "rejete" ? reason : undefined,
          justification: reason,
          dateNaissance: viewDateNaissance || undefined,
        }),
      });
      setDocBusy(null);
      if (res.ok) {
        setFeedback(`✅ Document ${status === "verifie" ? "validé" : "rejeté"} et journalisé.`);
        setDocInputs((prev) => ({ ...prev, [docId]: "" }));
        const r2 = await fetch(`/api/admin/kyc/${viewing.userId}/documents`);
        if (r2.ok) setViewDocs((await r2.json()).documents);
        load(); // l'état global du compte a pu changer → resynchronise la file
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback(
          data.error === "date_naissance_required"
            ? "Date de naissance obligatoire pour cette filière chantier (A13) — saisissez la date lue sur la pièce d'identité."
            : data.error === "kyc_rate_limit_exceeded"
              ? "Quota de 30 validations/heure atteint."
              : `Échec de la décision du document (${res.status}).`
        );
      }
    } catch {
      setDocBusy(null);
      setFeedback("Erreur réseau lors de la décision.");
    }
  }

  // Active/désactive « Garant requis » pour un compte (défaut OFF). Réservé aux filières
  // chantier (artisan/manœuvre/expert_btp_autres) ; le serveur refuse sinon.
  async function toggleGarant(userId: string, current: boolean) {
    setGarantBusy(userId);
    setFeedback(null);
    const res = await fetch(`/api/admin/kyc/${userId}/garant-requirement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ garantRequired: !current }),
    });
    setGarantBusy(null);
    if (res.ok) {
      setFeedback(`Exigence de garant ${!current ? "activée" : "désactivée"} pour ce compte.`);
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback(data.error === "not_chantier_role" ? "Exigence de garant réservée aux filières chantier." : "Échec de la mise à jour de l'exigence de garant.");
    }
  }

  // DELETE /api/admin/users/[id] — justification obligatoire côté serveur, e-mail à retaper
  // pour confirmer côté écran : une suppression de compte ne se déclenche pas d'un clic mal placé.
  async function submitDeleteUser() {
    if (!deleteModal) return;
    if (deleteValues.confirmEmail.trim() !== deleteModal.email) {
      setFeedback("Email de confirmation incorrect — suppression annulée.");
      return;
    }
    const res = await fetch(`/api/admin/users/${deleteModal.userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification: deleteValues.justification }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback(`Échec de la suppression : ${data.error ?? res.status}`);
      return;
    }
    setFeedback(`Compte ${deleteModal.email} supprimé.`);
    setDeleteModal(null);
    setDeleteValues({ confirmEmail: "", justification: "" });
    load();
  }

  // Indicateurs du rôle, calculés sur les deux sources déjà chargées : la file d'attente et les
  // comptes de filière chantier. Aucun appel supplémentaire — un tableau de bord qui ralentit
  // l'écran de travail n'en est pas un.
  const visible = (queue ?? []).filter((item) =>
    population === "tous"
      ? true
      : population === "clients"
        ? CLIENT_SIDE_ROLES.includes(item.role)
        : !CLIENT_SIDE_ROLES.includes(item.role),
  );
  const docsPending = visible.reduce((n, item) => n + item.documents.filter((d) => d.status !== "verifie").length, 0);
  const chantierPending = visible.filter((item) => (CHANTIER_ROLES as readonly string[]).includes(item.role)).length;
  const withGarant = visible.filter((item) => item.garantRequired).length;

  return (
    <div className="text-[#1A1916]">
      <div className="space-y-5">
        <AdminPageHeader
          icon="🪪"
          title={POPULATION_META[population].title}
          subtitle={POPULATION_META[population].subtitle}
          readOnly={!canAct}
          actions={
            <button onClick={() => load()} className={btnSecondary}>
              <RefreshCw size={14} />
              Actualiser
            </button>
          }
        />

        <KpiStrip
          items={[
            { icon: "🗂️", label: "Dossiers en attente", value: queue ? visible.length : "…", hint: "dans cette file" },
            { icon: "📄", label: "Pièces à examiner", value: docsPending, hint: "documents non validés", tone: docsPending > 0 ? "amber" : "neutral" },
            { icon: "🦺", label: "Filières chantier", value: chantierPending, hint: "âge vérifié requis (A13)" },
            { icon: "🤝", label: "Garant exigé", value: withGarant, hint: "parmi ces dossiers", href: "/admin/validation-utilisateurs" },
          ]}
        />

        {!canAct && (
          <div className="rounded-xl border border-[#E2E0D9] bg-white p-3.5 text-[12.5px] text-[#5A5750]">
            <strong className="text-[#1A1916]">Consultation seule.</strong> L&apos;instruction des dossiers appartient au rôle{" "}
            <code className="px-1 py-0.5 rounded bg-[#F4F3EF] text-[12px]">kyc</code>.
          </div>
        )}

        <div className="rounded-xl border border-[#E2E0D9] bg-white p-3.5 text-[12.5px] text-[#5A5750] leading-relaxed">
          <strong className="text-[#1A1916]">Seule vérification effective de Flexwork.</strong> Max 30 validations/heure. Motif obligatoire
          uniquement en cas de rejet. La date de naissance saisie ici est la seule donnée d&apos;âge faisant foi (A13), obligatoire pour
          valider une filière chantier.
          Les rejets requièrent une <strong className="text-[#1A1916]">double validation</strong>.
        </div>

        {feedback && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">{feedback}</div>}

        <div className="bg-white border border-[#E2E0D9] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E0D9]">
            <h3 className="text-[13px] font-semibold">Dossiers en attente ({queue ? visible.length : "…"})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#5A5750] uppercase bg-[#FAFAF8] border-b border-[#E2E0D9]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Utilisateur</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Documents</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Date de naissance (lue sur pièce)</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Motif de rejet</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Garant requis</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Décision</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const allVerified = item.documents.length > 0 && item.documents.every((d) => d.status === "verifie");
                  return (
                    <tr key={item.userId} className="border-b border-[#F4F3EF] last:border-0">
                      <td className="py-2.5 px-4 lg:px-5 text-[#5A5750]">{item.email}<br /><span className="text-[11px] text-[#9C9A95]">{item.tel}</span></td>
                      <td className="py-2.5 px-3">
                        <div className="text-[#5A5750]">{item.documents.map((d) => DOC_LABEL[d.type] ?? d.type).join(" · ")}</div>
                        {canAct && (
                          <button onClick={() => openDocs(item)} className="mt-1.5 h-7 px-3 rounded-md bg-[#2D5BE3] text-white text-[11.5px] font-medium whitespace-nowrap hover:brightness-110">
                            Voir les documents
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="date"
                          value={dates[item.userId] ?? ""}
                          onChange={(e) => setDates((prev) => ({ ...prev, [item.userId]: e.target.value }))}
                          className={`${inputClass} h-9`}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          placeholder="Motif de rejet (si rejet)"
                          value={justifications[item.userId] ?? ""}
                          onChange={(e) => setJustifications((prev) => ({ ...prev, [item.userId]: e.target.value }))}
                          className={`${inputClass} h-9 min-w-[160px]`}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        {canAct ? (
                          <button
                            disabled={garantBusy === item.userId || !(CHANTIER_ROLES as readonly string[]).includes(item.role)}
                            title={
                              (CHANTIER_ROLES as readonly string[]).includes(item.role)
                                ? item.garantRequired
                                  ? "Désactiver l'exigence de garant (présentiel/hybride)"
                                  : "Activer l'exigence de garant (présentiel/hybride)"
                                : "Réservé aux filières chantier (artisan, manœuvre, expert BTP)"
                            }
                            onClick={() => toggleGarant(item.userId, item.garantRequired)}
                            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium border transition disabled:opacity-60 ${item.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-[#5A5750] border-[#E2E0D9] hover:bg-[#FAFAF8]"} ${!(CHANTIER_ROLES as readonly string[]).includes(item.role) ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            {garantBusy === item.userId ? "…" : item.garantRequired ? "● Garant requis ON" : "○ Garant OFF"}
                          </button>
                        ) : (
                          <span
                            className={`inline-flex items-center h-8 px-3 rounded-md text-[11.5px] font-medium border ${item.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-[#5A5750] border-[#E2E0D9]"}`}
                          >
                            {item.garantRequired ? "● Garant requis" : "○ Garant non requis"}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 lg:px-5">
                        {canAct ? (
                          <div className="flex gap-2">
                            <button
                              disabled={!allVerified}
                              title={allVerified ? undefined : "Validez d'abord chaque document individuellement"}
                              onClick={() => decide(item.userId, "verifie")}
                              className={`h-8 px-3 rounded-md bg-[#1A1916] text-white text-[11.5px] font-medium hover:bg-black ${allVerified ? "" : "opacity-45 cursor-not-allowed"}`}
                            >
                              Valider
                            </button>
                            <button onClick={() => decide(item.userId, "rejete")} className="h-8 px-3 rounded-md border border-[#E2E0D9] bg-white text-[11.5px] font-medium hover:bg-[#FAFAF8]">
                              Rejeter
                            </button>
                            <button
                              onClick={() => { setDeleteModal({ userId: item.userId, email: item.email }); setDeleteValues({ confirmEmail: "", justification: "" }); }}
                              title="Supprimer le compte"
                              className="h-8 w-8 rounded-md border border-[#FECACA] bg-white text-[#DC2626] flex items-center justify-center hover:bg-[#FEF2F2] transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#9C9A95]">Consultation</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {queue && visible.length === 0 && <tr><td colSpan={6} className="py-6 px-4 lg:px-5 text-center text-[#9C9A95]">Aucun dossier en attente.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* L'exigence de garant sur les comptes déjà vérifiés vit dans « Validation utilisateurs »,
            avec la confirmation des garants : tout ce qui touche aux personnes ressources au
            même endroit, plutôt qu'éparpillé entre deux écrans. */}
      </div>

      {viewing && (
        <div
          onClick={() => setViewing(null)}
          className="fixed inset-0 bg-[#0A1931]/55 flex items-center justify-center p-4 z-[1000]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-[880px] w-full max-h-[92vh] overflow-auto p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <div>
                <h2 className="text-[18px] font-bold text-[#0A1931] m-0">Documents KYC — {viewing.email}</h2>
                <p className="mt-1 text-[12px] text-[#6b7280]">
                  Visualisez chaque document et validez-le individuellement. L&apos;état du compte est resynchronisé automatiquement.
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="w-8 h-8 rounded-lg bg-[#F4F3EF] text-[#374151] text-[16px] hover:bg-[#E2E0D9]">✕</button>
            </div>

            {feedback && (
              <div className={`px-3 py-2 rounded-[10px] mb-3 text-[12px] font-semibold border ${feedback.startsWith("✅") ? "bg-[#f0fdf4] text-[#166534] border-[#bbf7d0]" : "bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]"}`}>{feedback}</div>
            )}

            <label className="block mt-3 mb-1 text-[12px] text-[#6b7280]">
              Date de naissance (lue sur la pièce — A13, envoyée avec la validation)
            </label>
            <input
              type="date"
              value={viewDateNaissance}
              onChange={(e) => setViewDateNaissance(e.target.value)}
              className="h-[38px] px-2.5 rounded-lg border border-[#E2E0D9] text-[13px] mb-4"
            />

            {viewDocs === null ? (
              <p className="text-[13px] text-[#6b7280]">Chargement des documents…</p>
            ) : viewDocs.length === 0 ? (
              <p className="text-[13px] text-[#6b7280]">Aucun document déposé pour ce compte.</p>
            ) : (
              <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
                {viewDocs.map((d) => {
                  const label = DOC_LABEL[d.type] ?? d.type;
                  const input = docInputs[d.id] ?? "";
                  const isVerified = d.status === "verifie";
                  const isRejected = d.status === "rejete";
                  const badgeClass = isVerified
                    ? "bg-[#DCFCE7] text-[#166534]"
                    : isRejected
                      ? "bg-[#FEE2E2] text-[#B91C1C]"
                      : "bg-[#FEF9C3] text-[#854D0E]";
                  return (
                    <div key={d.id} className="border border-[#E2E0D9] rounded-xl overflow-hidden flex flex-col bg-white">
                      <div className="px-3 py-2.5 border-b border-[#F4F3EF] flex items-center justify-between gap-2">
                        <strong className="text-[12px]">{label}</strong>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}`}>{isVerified ? "Validé" : isRejected ? "Rejeté" : "En attente"}</span>
                      </div>
                      <div onClick={() => setLightbox(d)} title="Ouvrir en plein écran" className="p-2.5 bg-[#fafafa] min-h-[130px] flex items-center justify-center cursor-pointer">
                        {isImageFile(d.fileName) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- document KYC signé/privé, pas un asset optimisable par next/image
                          <img src={d.url} alt={label} className="max-w-full rounded-lg object-contain" style={{ maxHeight: 170 }} />
                        ) : (
                          <span className="text-[13px] text-[#2D5BE3] font-semibold">📄 Ouvrir le PDF</span>
                        )}
                      </div>
                      <div className="p-2.5 flex flex-col gap-2">
                        <input
                          type="text"
                          placeholder="Motif de rejet (obligatoire seulement pour rejeter)"
                          value={input}
                          disabled={isVerified}
                          onChange={(e) => { setMissingDocFieldId(null); setDocInputs((prev) => ({ ...prev, [d.id]: e.target.value })); }}
                          className={`h-[34px] px-2.5 rounded-lg text-[12px] border ${missingDocFieldId === d.id ? "border-2 border-[#DC2626]" : "border-[#E2E0D9]"}`}
                        />
                        {d.rejectionReason && (
                          <span className="text-[11px] text-[#DC2626]">Motif précédent : {d.rejectionReason}</span>
                        )}
                        <div className="flex gap-2">
                          <button type="button" disabled={isVerified || docBusy === d.id} onClick={() => decideDoc(d.id, "verifie")} className="flex-1 h-8 rounded-md bg-[#1A1916] text-white text-[11.5px] font-medium hover:bg-black disabled:opacity-50">
                            {docBusy === d.id ? "…" : "Valider"}
                          </button>
                          <button type="button" disabled={isVerified || docBusy === d.id} onClick={() => decideDoc(d.id, "rejete")} className="flex-1 h-8 rounded-md border border-[#E2E0D9] bg-white text-[11.5px] font-medium hover:bg-[#FAFAF8] disabled:opacity-50">
                            {docBusy === d.id ? "…" : "Rejeter"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4" onClick={() => setDeleteModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold">Supprimer le compte {deleteModal.email} ?</h3>
            <p className="text-[12.5px] text-[#5A5750]">
              L&apos;opération est journalisée dans <code className="px-1 py-0.5 rounded bg-[#F4F3EF] text-[12px]">admin_audit_log</code> et
              détache le compte de ses missions. Elle est irréversible.
            </p>
            <div>
              <label htmlFor="del-confirm" className="block text-[12px] font-semibold text-[#5A5750] mb-1">
                Tapez « {deleteModal.email} » pour confirmer
              </label>
              <input
                id="del-confirm"
                type="text"
                value={deleteValues.confirmEmail}
                onChange={(e) => setDeleteValues((v) => ({ ...v, confirmEmail: e.target.value }))}
                placeholder={deleteModal.email}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="del-justification" className="block text-[12px] font-semibold text-[#5A5750] mb-1">
                Justification (obligatoire)
              </label>
              <textarea
                id="del-justification"
                rows={3}
                value={deleteValues.justification}
                onChange={(e) => setDeleteValues((v) => ({ ...v, justification: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E0D9] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#2D5BE3]/20 focus:border-[#2D5BE3]"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteModal(null)} className="h-9 px-4 rounded-lg border border-[#E2E0D9] text-[13px] font-medium hover:bg-[#FAFAF8]">
                Annuler
              </button>
              <button
                onClick={submitDeleteUser}
                disabled={deleteValues.confirmEmail.trim() !== deleteModal.email || !deleteValues.justification.trim()}
                className="h-9 px-4 rounded-lg bg-[#DC2626] text-white text-[13px] font-semibold hover:bg-[#B91C1C] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Supprimer le compte
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 bg-black/[.92] flex flex-col items-center justify-center p-6 z-[1100]">
          <div className="absolute top-4 right-5 flex gap-2.5 items-center">
            <a href={lightbox.url} target="_blank" rel="noopener noreferrer" className="text-white text-[13px] border border-white/40 px-3.5 py-1.5 rounded-full" style={{ textDecoration: "none" }}>Télécharger</a>
            <button onClick={() => setLightbox(null)} className="bg-white/15 text-white rounded-lg w-9 h-9 text-[18px]">✕</button>
          </div>
          <div className="mb-3 text-white text-[13px] text-center">{DOC_LABEL[lightbox.type] ?? lightbox.type} — {lightbox.fileName}</div>
          {isImageFile(lightbox.fileName) ? (
            // eslint-disable-next-line @next/next/no-img-element -- document KYC signé/privé, pas un asset optimisable par next/image
            <img src={lightbox.url} alt={lightbox.fileName} className="max-w-full object-contain rounded-lg" style={{ maxHeight: "82vh" }} />
          ) : (
            <iframe src={lightbox.url} title={lightbox.fileName} className="w-full border-0 rounded-lg bg-white" style={{ maxWidth: 900, height: "80vh" }} />
          )}
        </div>
      )}
    </div>
  );
}
