"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";
import { CHANTIER_ROLES } from "@/lib/age-gate";

type KycDoc = { id: string; type: string; status: string };
type QueueItem = { userId: string; email: string; tel: string; role: string; garantRequired: boolean; createdAt: string; documents: KycDoc[] };
// Comptes de filière chantier, tous statuts KYC confondus (GET /api/admin/kyc/garant-accounts) —
// la file KYC ci-dessus ne montre que les dossiers « en attente », or candidater exige un KYC
// vérifié : sans cette seconde liste, l'exigence de garant serait inatteignable pour les comptes
// qui peuvent réellement candidater.
type GarantAccount = {
  userId: string;
  email: string;
  tel: string;
  role: string;
  kycStatus: string;
  garantRequired: boolean;
  garantRequiredSetAt: string | null;
  garantRequiredSetByEmail: string | null;
};

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

const KYC_LABEL: Record<string, string> = {
  non_soumis: "Non soumis",
  en_attente: "En attente",
  verifie: "Vérifié",
  rejete: "Rejeté",
};

const inputClass = "h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

// Validation KYC — aligné sur formulaires-flexwork-tous-profils.html.
// Nouveautés v3 : 5 rôles admin séparés, double validation pour les rejets,
// quota 30 validations/heure, justification obligatoire.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
export default function AdminKycPage() {
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
  const [garantAccounts, setGarantAccounts] = useState<GarantAccount[] | null>(null);
  // Plein écran (visualiseur/lecteur) d'un document dans le modal.
  const [lightbox, setLightbox] = useState<AdminViewDoc | null>(null);
  // Document dont le motif est manquant — mis en surbrillance rouge.
  const [missingDocFieldId, setMissingDocFieldId] = useState<string | null>(null);

  async function load() {
    const [queueRes, garantRes] = await Promise.all([
      fetch("/api/admin/kyc/queue"),
      fetch("/api/admin/kyc/garant-accounts"),
    ]);
    if (queueRes.ok) setQueue((await queueRes.json()).items);
    if (garantRes.ok) setGarantAccounts((await garantRes.json()).items);
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

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[1400px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Admin KYC — Validation d&apos;identité</h1>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
          <strong className="text-[#0f172a]">Seule vérification effective de Flexwork.</strong> Max 30 validations/heure. Motif obligatoire
          uniquement en cas de rejet. La date de naissance saisie ici est la seule donnée d&apos;âge faisant foi (A13), obligatoire pour
          valider une filière chantier.
          Les rejets requièrent une <strong className="text-[#0f172a]">double validation</strong>.
        </div>

        {feedback && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">{feedback}</div>}

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
            <h3 className="text-[13px] font-semibold">Dossiers en attente ({queue?.length ?? "…"})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Utilisateur</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Documents</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Date de naissance (lue sur pièce)</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Motif de rejet</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Garant requis</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Décision</th>
                </tr>
              </thead>
              <tbody>
                {queue?.map((item) => {
                  const allVerified = item.documents.length > 0 && item.documents.every((d) => d.status === "verifie");
                  return (
                    <tr key={item.userId} className="border-b border-[#F1F5F9] last:border-0">
                      <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{item.email}<br /><span className="text-[11px] text-[#94A3B8]">{item.tel}</span></td>
                      <td className="py-2.5 px-3">
                        <div className="text-[#475569]">{item.documents.map((d) => DOC_LABEL[d.type] ?? d.type).join(" · ")}</div>
                        <button onClick={() => openDocs(item)} className="mt-1.5 h-7 px-3 rounded-md bg-[#0f172a] text-white text-[11.5px] font-medium hover:bg-black">
                          Voir les documents
                        </button>
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
                          className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium border transition disabled:opacity-60 ${item.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAF9]"} ${!(CHANTIER_ROLES as readonly string[]).includes(item.role) ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          {garantBusy === item.userId ? "…" : item.garantRequired ? "● Garant requis ON" : "○ Garant OFF"}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 lg:px-5">
                        <div className="flex gap-2">
                          <button
                            disabled={!allVerified}
                            title={allVerified ? undefined : "Validez d'abord chaque document individuellement"}
                            onClick={() => decide(item.userId, "verifie")}
                            className={`h-8 px-3 rounded-md bg-[#0f172a] text-white text-[11.5px] font-medium hover:bg-black ${allVerified ? "" : "opacity-45 cursor-not-allowed"}`}
                          >
                            Valider
                          </button>
                          <button onClick={() => decide(item.userId, "rejete")} className="h-8 px-3 rounded-md border border-[#E2E8F0] bg-white text-[11.5px] font-medium hover:bg-[#F8FAF9]">
                            Rejeter
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {queue?.length === 0 && <tr><td colSpan={6} className="py-6 px-4 lg:px-5 text-center text-[#94A3B8]">Aucun dossier en attente.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Exigence de garant — pilotable sur TOUT compte de filière chantier, pas seulement
            sur les dossiers en attente ci-dessus : candidater exige un KYC vérifié, donc les
            comptes réellement concernés ne figurent jamais dans la file KYC. */}
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
            <h3 className="text-[13px] font-semibold">Exigence de garant — filière chantier ({garantAccounts?.length ?? "…"})</h3>
            <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">
              Désactivée par défaut pour tout le monde. Une fois activée sur un compte, celui-ci doit avoir déclaré un
              garant obligatoire pour candidater à une mission <strong className="text-[#0f172a]">en présentiel ou hybride</strong>.
              Sans effet sur les missions à distance, ni sur l&apos;expert digital.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Compte</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Filière</th>
                  <th className="text-left py-2.5 px-3 font-semibold">KYC</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Garant requis</th>
                </tr>
              </thead>
              <tbody>
                {garantAccounts?.map((acc) => (
                  <tr key={acc.userId} className="border-b border-[#F1F5F9] last:border-0">
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{acc.email}<br /><span className="text-[11px] text-[#94A3B8]">{acc.tel}</span></td>
                    <td className="py-2.5 px-3 text-[#475569]">{ROLE_LABEL[acc.role] ?? acc.role}</td>
                    <td className="py-2.5 px-3 text-[#475569]">{KYC_LABEL[acc.kycStatus] ?? acc.kycStatus}</td>
                    <td className="py-2.5 px-3">
                      <button
                        disabled={garantBusy === acc.userId}
                        title={acc.garantRequired ? "Désactiver l'exigence de garant (présentiel/hybride)" : "Activer l'exigence de garant (présentiel/hybride)"}
                        onClick={() => toggleGarant(acc.userId, acc.garantRequired)}
                        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium border transition disabled:opacity-60 ${acc.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAF9]"}`}
                      >
                        {garantBusy === acc.userId ? "…" : acc.garantRequired ? "● Garant requis ON" : "○ Garant OFF"}
                      </button>
                      {acc.garantRequired && acc.garantRequiredSetAt && (
                        <div className="text-[11px] text-[#94A3B8] mt-1">
                          Activée le {new Date(acc.garantRequiredSetAt).toLocaleDateString("fr-FR")}
                          {acc.garantRequiredSetByEmail ? ` par ${acc.garantRequiredSetByEmail}` : ""}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {garantAccounts?.length === 0 && <tr><td colSpan={4} className="py-6 px-4 lg:px-5 text-center text-[#94A3B8]">Aucun compte de filière chantier.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
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
              <button onClick={() => setViewing(null)} className="w-8 h-8 rounded-lg bg-[#F1F5F9] text-[#374151] text-[16px] hover:bg-[#E2E8F0]">✕</button>
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
              className="h-[38px] px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] mb-4"
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
                    <div key={d.id} className="border border-[#E2E8F0] rounded-xl overflow-hidden flex flex-col bg-white">
                      <div className="px-3 py-2.5 border-b border-[#F1F5F9] flex items-center justify-between gap-2">
                        <strong className="text-[12px]">{label}</strong>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}`}>{isVerified ? "Validé" : isRejected ? "Rejeté" : "En attente"}</span>
                      </div>
                      <div onClick={() => setLightbox(d)} title="Ouvrir en plein écran" className="p-2.5 bg-[#fafafa] min-h-[130px] flex items-center justify-center cursor-pointer">
                        {isImageFile(d.fileName) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- document KYC signé/privé, pas un asset optimisable par next/image
                          <img src={d.url} alt={label} className="max-w-full rounded-lg object-contain" style={{ maxHeight: 170 }} />
                        ) : (
                          <span className="text-[13px] text-[#008751] font-semibold">📄 Ouvrir le PDF</span>
                        )}
                      </div>
                      <div className="p-2.5 flex flex-col gap-2">
                        <input
                          type="text"
                          placeholder="Motif de rejet (obligatoire seulement pour rejeter)"
                          value={input}
                          disabled={isVerified}
                          onChange={(e) => { setMissingDocFieldId(null); setDocInputs((prev) => ({ ...prev, [d.id]: e.target.value })); }}
                          className={`h-[34px] px-2.5 rounded-lg text-[12px] border ${missingDocFieldId === d.id ? "border-2 border-[#DC2626]" : "border-[#E2E8F0]"}`}
                        />
                        {d.rejectionReason && (
                          <span className="text-[11px] text-[#DC2626]">Motif précédent : {d.rejectionReason}</span>
                        )}
                        <div className="flex gap-2">
                          <button type="button" disabled={isVerified || docBusy === d.id} onClick={() => decideDoc(d.id, "verifie")} className="flex-1 h-8 rounded-md bg-[#0f172a] text-white text-[11.5px] font-medium hover:bg-black disabled:opacity-50">
                            {docBusy === d.id ? "…" : "Valider"}
                          </button>
                          <button type="button" disabled={isVerified || docBusy === d.id} onClick={() => decideDoc(d.id, "rejete")} className="flex-1 h-8 rounded-md border border-[#E2E8F0] bg-white text-[11.5px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50">
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
