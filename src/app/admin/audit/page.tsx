"use client";

import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin-nav";

type LogEntry = { id: string; createdAt: string; admin: { email: string }; action: string; targetType: string; targetId: string; justification: string };

// Journal d'audit immuable — aligné sur formulaires-flexwork-tous-profils.html.
// Deux journaux : badge_history (transitions de badge) + admin_audit_log (actions admin).
// Append-only, hash chaîné SHA-256, échantillon aléatoire 5% du mois.
export default function AdminAuditPage() {
  const [data, setData] = useState<{ total: number; sample: LogEntry[] } | null>(null);

  useEffect(() => {
    fetch("/api/admin/audit")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  return (
    <div>
      <AdminNav />
      <div className="container">
        <h1 style={{ color: "var(--primary)", marginBottom: 20 }}>Traçabilité &amp; Audit</h1>

        <div className="card">
          <div className="card-header">
            <span className="card-title">admin_audit_log</span>
            <span className="badge badge-info">{data ? `${data.total} actions ce mois` : "…"}</span>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 10 }}>
            Échantillon aléatoire de 5% des actions du mois, tiré à chaque chargement. Append-only, lecture seule.
          </p>
          <table>
            <thead>
              <tr><th>Heure</th><th>Admin</th><th>Action</th><th>Cible</th><th>Justification</th></tr>
            </thead>
            <tbody>
              {data?.sample.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                  <td>{entry.admin.email}</td>
                  <td>{entry.action}</td>
                  <td>{entry.targetType} #{entry.targetId.slice(0, 8)}</td>
                  <td>{entry.justification}</td>
                </tr>
              ))}
              {data?.sample.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Aucune action ce mois-ci.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
