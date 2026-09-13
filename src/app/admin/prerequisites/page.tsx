import { AdminNav } from "@/components/admin-nav";

const ROWS = [
  { n: "1", label: "Validation du statut d'intermédiaire par un avocat béninois", status: "En cours", pending: true, source: "Avocat mandaté — consultation ouverte", blocks: "Modèle entier" },
  { n: "2", label: "Opposabilité des clauses de responsabilité (CGU + contrat)", status: "En cours", pending: true, source: "Lié au prérequis #1", blocks: "Phase 4+" },
  { n: "3", label: "Montage PSP : plateforme jamais bénéficiaire des fonds", status: "Non traité", pending: false, source: "—", blocks: "Phase 5" },
  { n: "4", label: "Statut distribution assurance à la mission", status: "Non traité", pending: false, source: "—", blocks: "Phase 7" },
  { n: "5", label: "Risque de requalification en relation de travail", status: "En cours", pending: true, source: "Lié au prérequis #1", blocks: "CGU Prestataire" },
  { n: "6", label: "Validité signature électronique (contrats entre tiers)", status: "Non traité", pending: false, source: "—", blocks: "US-403" },
  { n: "7", label: "Protection données pointage (déclaration APDP)", status: "Non traité", pending: false, source: "—", blocks: "US-406" },
];

// 5 rôles admin séparés + 7 prérequis juridiques — aligné sur
// formulaires-flexwork-tous-profils.html, onglet Administration.
// Nouveautés v3 : Admin KYC, Admin Qualification, Admin Expérience,
// Admin Superviseur, Admin Technique — aucun cumul de pouvoirs.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — contenu strictement inchangé.
export default function AdminPrerequisitesPage() {
  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[1000px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Séparation des pouvoirs — 5 rôles admin</h1>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
          Aucun administrateur ne cumule tous les pouvoirs de validation.
          Cette segmentation limite le risque de corruption interne et rend chaque décision attribuable.
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
            <h3 className="text-[13px] font-semibold">Rôles et pouvoirs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Rôle</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Pouvoirs</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Contraintes</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-[#F1F5F9] [&>tr:last-child]:border-0">
                <tr><td className="py-2.5 px-4 lg:px-5"><strong>Admin KYC</strong></td><td className="py-2.5 px-3 text-[#475569]">Valide / rejette le KYC uniquement</td><td className="py-2.5 px-4 lg:px-5 text-[#475569]">Max 30 validations/heure · flag si dépassement</td></tr>
                <tr><td className="py-2.5 px-4 lg:px-5"><strong>Admin Qualification</strong></td><td className="py-2.5 px-3 text-[#475569]">Valide / rejette les diplômes uniquement</td><td className="py-2.5 px-4 lg:px-5 text-[#475569]">Double validation obligatoire pour les rejets</td></tr>
                <tr><td className="py-2.5 px-4 lg:px-5"><strong>Admin Expérience</strong></td><td className="py-2.5 px-3 text-[#475569]">Valide / rejette les expériences + référents</td><td className="py-2.5 px-4 lg:px-5 text-[#475569]">Écoute d&apos;un échantillon de 10 % des appels (V2)</td></tr>
                <tr><td className="py-2.5 px-4 lg:px-5"><strong>Admin Superviseur</strong></td><td className="py-2.5 px-3 text-[#475569]">Lit tout, ne modifie rien (auditeur)</td><td className="py-2.5 px-4 lg:px-5 text-[#475569]">Revue mensuelle aléatoire de 5 % des actions</td></tr>
                <tr><td className="py-2.5 px-4 lg:px-5"><strong>Admin Technique</strong></td><td className="py-2.5 px-3 text-[#475569]">Gère les formations partenaires</td><td className="py-2.5 px-4 lg:px-5 text-[#475569]">Aucun accès aux données utilisateurs ni aux validations</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <h1 className="text-[18px] font-bold pt-4">Suivi des prérequis juridiques bloquants</h1>

        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Ne pas activer en production</strong> tant que les prérequis bloquants ne sont pas au statut « Validé ».
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="p-4 lg:p-5 border-b border-[#E2E8F0]">
            <h3 className="text-[13px] font-semibold">Sept prérequis + RC Pro plateforme</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">#</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Prérequis</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Statut</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Source / Preuve</th>
                  <th className="text-left py-2.5 px-4 lg:px-5 font-semibold">Bloque</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-[#F1F5F9] [&>tr:last-child]:border-0">
                {ROWS.map((r) => (
                  <tr key={r.n}>
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{r.n}</td>
                    <td className="py-2.5 px-3">{r.label}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${r.pending ? "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]" : "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]"}`}>{r.status}</span>
                    </td>
                    <td className="py-2.5 px-3 text-[#475569]">{r.source}</td>
                    <td className="py-2.5 px-4 lg:px-5 text-[#475569]">{r.blocks}</td>
                  </tr>
                ))}
                <tr className="bg-[#f0fdf4]">
                  <td className="py-2.5 px-4 lg:px-5 text-[#475569]">—</td>
                  <td className="py-2.5 px-3"><strong>RC Pro propre à la plateforme Flexwork</strong></td>
                  <td className="py-2.5 px-3"><span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]">À souscrire</span></td>
                  <td className="py-2.5 px-3 text-[#475569]">—</td>
                  <td className="py-2.5 px-4 lg:px-5 text-[#475569]">Couverture business (distincte des 7 prérequis)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Décisions de go/no-go</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#A7F3D0] bg-[#E6F4EE] p-3.5 text-[13px] text-[#008751]">
              <strong>✓ GO Phases 1-4, 6, 8</strong><br />
              <span className="text-[11.5px] text-[#166534]">Comptes, KYC, déclarations, missions/contrats (hors signature élec. en prod), médiation, modération.</span>
            </div>
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-[13px] text-[#B91C1C]">
              <strong>✗ NO-GO Phases 5, 7, US-406</strong><br />
              <span className="text-[11.5px]">Séquestre PSP, risque élevé/assurance à la mission et outil de pointage en attente de leurs prérequis respectifs.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
