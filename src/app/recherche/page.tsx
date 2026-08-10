"use client";

import { useState } from "react";
import Link from "next/link";

type Provider = { id: string; email: string; role: string; mainDomain: string | null; declaredLevel: string | null };

const ROLE_LABEL: Record<string, string> = {
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP / Autres",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
};

// Recherche de prestataires — aligné sur formulaires-flexwork-tous-profils.html.
// Filtre par domaine + rôle, résultats : identité vérifiée uniquement.
export default function SearchProvidersPage() {
  const [domaine, setDomaine] = useState("");
  const [role, setRole] = useState("");
  const [results, setResults] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!domaine.trim()) {
      setError("Renseignez un domaine pour lancer la recherche.");
      return;
    }
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ domaine });
    if (role) params.set("role", role);
    const res = await fetch(`/api/search/prestataires?${params.toString()}`);
    setLoading(false);
    if (!res.ok) {
      setError("Échec de la recherche.");
      return;
    }
    const data = await res.json();
    setResults(data.items);
  }

  return (
    <div className="container">
      <div className="card">
        <div className="card-header">
          <span className="card-title">Rechercher un prestataire</span>
        </div>
        {error && <div className="alert alert-danger">{error}</div>}
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Domaine (ex: plomberie, dev_web...)"
            style={{ flex: 1, minWidth: 200 }}
            value={domaine}
            onChange={(e) => setDomaine(e.target.value)}
          />
          <select style={{ width: 200 }} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Tous les profils</option>
            <option value="expert_digital">Expert Digital</option>
            <option value="expert_btp_autres">Expert BTP / Autres</option>
            <option value="artisan">Artisan</option>
            <option value="manoeuvre">Manœuvre</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Recherche..." : "Rechercher"}
          </button>
        </form>
      </div>

      {results && (
        <div className="grid-2">
          {results.length === 0 && <p style={{ color: "var(--muted)" }}>Aucun prestataire trouvé pour ce domaine.</p>}
          {results.map((p) => (
            <div className="card" key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ color: "var(--primary)" }}>{p.email}</h3>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    {ROLE_LABEL[p.role] ?? p.role} — {p.mainDomain ?? "Domaine non renseigné"}
                  </p>
                </div>
                <span className="badge badge-verified">Identité vérifiée</span>
              </div>
              <div style={{ margin: "12px 0", fontSize: "0.9rem" }}>
                <p>Niveau déclaré : {p.declaredLevel ?? "Non renseigné"}</p>
              </div>
              <Link href={`/profil/${p.id}`} className="btn btn-outline" style={{ width: "100%", justifyContent: "center" }}>
                Voir le profil
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="alert alert-info" style={{ fontSize: "0.85rem" }}>
        <strong>Algorithme de classement :</strong> les résultats affichés proviennent uniquement de prestataires à
        l&apos;identité vérifiée. Aucun critère commercial caché n&apos;est appliqué.
      </div>
    </div>
  );
}
