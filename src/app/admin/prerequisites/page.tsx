import { AdminNav } from "@/components/admin-nav";

const ROWS = [
  { n: "1", label: "Validation du statut d'intermédiaire par un avocat béninois", status: "En cours", statusClass: "badge-declared", source: "Avocat mandaté — consultation ouverte", blocks: "Modèle entier" },
  { n: "2", label: "Opposabilité des clauses de responsabilité (CGU + contrat)", status: "En cours", statusClass: "badge-declared", source: "Lié au prérequis #1", blocks: "Phase 4+" },
  { n: "3", label: "Montage PSP : plateforme jamais bénéficiaire des fonds", status: "Non traité", statusClass: "badge-unverified", source: "—", blocks: "Phase 5" },
  { n: "4", label: "Statut distribution assurance à la mission", status: "Non traité", statusClass: "badge-unverified", source: "—", blocks: "Phase 7" },
  { n: "5", label: "Risque de requalification en relation de travail", status: "En cours", statusClass: "badge-declared", source: "Lié au prérequis #1", blocks: "CGU Prestataire" },
  { n: "6", label: "Validité signature électronique (contrats entre tiers)", status: "Non traité", statusClass: "badge-unverified", source: "—", blocks: "US-403" },
  { n: "7", label: "Protection données pointage (déclaration APDP)", status: "Non traité", statusClass: "badge-unverified", source: "—", blocks: "US-406" },
];

// 5 rôles admin séparés + 7 prérequis juridiques — aligné sur
// formulaires-flexwork-tous-profils.html, onglet Administration.
// Nouveautés v3 : Admin KYC, Admin Qualification, Admin Expérience,
// Admin Superviseur, Admin Technique — aucun cumul de pouvoirs.
export default function AdminPrerequisitesPage() {
  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Séparation des pouvoirs — 5 rôles admin</h1>

        <div className="info-box">
          Aucun administrateur ne cumule tous les pouvoirs de validation.
          Cette segmentation limite le risque de corruption interne et rend chaque décision attribuable.
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Rôles et pouvoirs</span></div>
          <table>
            <thead><tr><th>Rôle</th><th>Pouvoirs</th><th>Contraintes</th></tr></thead>
            <tbody>
              <tr><td><strong>Admin KYC</strong></td><td>Valide / rejette le KYC uniquement</td><td>Max 30 validations/heure · flag si dépassement</td></tr>
              <tr><td><strong>Admin Qualification</strong></td><td>Valide / rejette les diplômes uniquement</td><td>Double validation obligatoire pour les rejets</td></tr>
              <tr><td><strong>Admin Expérience</strong></td><td>Valide / rejette les expériences + référents</td><td>Écoute d&apos;un échantillon de 10 % des appels (V2)</td></tr>
              <tr><td><strong>Admin Superviseur</strong></td><td>Lit tout, ne modifie rien (auditeur)</td><td>Revue mensuelle aléatoire de 5 % des actions</td></tr>
              <tr><td><strong>Admin Technique</strong></td><td>Gère les formations partenaires</td><td>Aucun accès aux données utilisateurs ni aux validations</td></tr>
            </tbody>
          </table>
        </div>

        <h1 style={{ color: "var(--primary)", marginBottom: 20, marginTop: 30 }}>Suivi des prérequis juridiques bloquants</h1>

        <div className="warn-box">
          <strong>Ne pas activer en production</strong> tant que les prérequis bloquants ne sont pas au statut « Validé ».
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Sept prérequis + RC Pro plateforme</span></div>
          <table>
            <thead>
              <tr><th>#</th><th>Prérequis</th><th>Statut</th><th>Source / Preuve</th><th>Bloque</th></tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.n}>
                  <td>{r.n}</td>
                  <td>{r.label}</td>
                  <td><span className={`badge ${r.statusClass}`}>{r.status}</span></td>
                  <td>{r.source}</td>
                  <td>{r.blocks}</td>
                </tr>
              ))}
              <tr style={{ background: "#f0fdf4" }}>
                <td>—</td>
                <td><strong>RC Pro propre à la plateforme Flexwork</strong></td>
                <td><span className="badge badge-unverified">À souscrire</span></td>
                <td>—</td>
                <td>Couverture business (distincte des 7 prérequis)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Décisions de go/no-go</span></div>
          <div className="grid-2">
            <div className="alert alert-success">
              <strong>✓ GO Phases 1-4, 6, 8</strong><br />
              <small>Comptes, KYC, déclarations, missions/contrats (hors signature élec. en prod), médiation, modération.</small>
            </div>
            <div className="alert alert-danger">
              <strong>✗ NO-GO Phases 5, 7, US-406</strong><br />
              <small>Séquestre PSP, risque élevé/assurance à la mission et outil de pointage en attente de leurs prérequis respectifs.</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
