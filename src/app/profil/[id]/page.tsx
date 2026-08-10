import { notFound } from "next/navigation";
import { headers } from "next/headers";

type PublicProfile = {
  verifie: { identiteVerifiee: boolean };
  declare: {
    mainDomain: string | null;
    declaredLevel: string | null;
    declaredExperienceYears: number | null;
    indicativeRate: number | null;
    tarifUnite: string | null;
    tags: string[];
    description: string | null;
    portfolioUrls: string[];
    zonePays: string | null;
    zoneVille: string | null;
    zoneRayonKm: number | null;
    insurance: { insurerName: string | null; policyNumber: string | null; coverageCeiling: number | null; validUntil: string | null } | null;
    qualification: { label: string | null } | null;
    mention: string;
  };
  activite: { missionsCompleted: number; averageNote: number | null; memberSince: string };
};

// Profil public prestataire — 3 blocs strictement séparés (vérifié / déclaré / activité).
// Aligné sur formulaires-flexwork-tous-profils.html.
export default async function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";

  const res = await fetch(`${protocol}://${host}/api/users/${id}/public-profile`, {
    headers: { cookie: h.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) notFound();
  const data: PublicProfile = await res.json();

  return (
    <div className="container" style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: "50%", background: "var(--primary)", color: "white",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem", fontWeight: 700,
          }}
        >
          {(data.declare.mainDomain ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: "1.5rem", color: "var(--primary)" }}>Profil prestataire</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{data.declare.mainDomain ?? "Domaine non renseigné"}</p>
        </div>
      </div>

      <div className="block-verified">
        <div className="block-title">✓ Vérifié par Flexwork</div>
        <p style={{ fontSize: "0.9rem" }}>
          <span className={`badge ${data.verifie.identiteVerifiee ? "badge-verified" : "badge-unverified"}`}>
            {data.verifie.identiteVerifiee ? "Identité vérifiée" : "Non vérifié"}
          </span>
        </p>
      </div>

      <div className="block-declared">
        <div className="block-title">📋 Déclaré par le prestataire (non vérifié par Flexwork)</div>
        <div style={{ fontSize: "0.9rem", lineHeight: 1.8 }}>
          <p>
            <strong>Assurance :</strong>{" "}
            {data.declare.insurance
              ? `RC Pro — ${data.declare.insurance.insurerName ?? "?"}, police n° ${data.declare.insurance.policyNumber ?? "?"}, plafond ${data.declare.insurance.coverageCeiling ?? "?"} XOF`
              : "Aucune assurance déclarée"}
          </p>
          <p>
            <strong>Qualification :</strong>{" "}
            {data.declare.qualification?.label ?? "Aucune qualification déclarée"} — non vérifié par Flexwork
          </p>
          <p><strong>Expérience :</strong> {data.declare.declaredExperienceYears ?? "?"} ans</p>
          <p><strong>Niveau :</strong> {data.declare.declaredLevel ?? "Non renseigné"} (auto-déclaré)</p>
          <p><strong>Tarif indicatif :</strong> {data.declare.indicativeRate ? `${data.declare.indicativeRate.toLocaleString("fr-FR")} XOF${data.declare.tarifUnite ? ` / ${data.declare.tarifUnite}` : ""}` : "Non renseigné"}</p>
          {data.declare.tags.length > 0 && (
            <p><strong>Compétences :</strong>{" "}
              {data.declare.tags.map((t, i) => (
                <span key={i} className="badge" style={{ marginRight: 4 }}>{t}</span>
              ))}
            </p>
          )}
          {data.declare.description && (
            <div style={{ marginTop: 8 }}>
              <strong>Présentation :</strong>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{data.declare.description}</p>
            </div>
          )}
          {data.declare.portfolioUrls.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Portfolio :</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {data.declare.portfolioUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem", color: "var(--primary)", textDecoration: "underline" }}>
                    Lien {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="block-declared" style={{ marginTop: 16 }}>
        <div className="block-title">📍 Zone d&apos;intervention (déclaré)</div>
        <div style={{ fontSize: "0.9rem", lineHeight: 1.8 }}>
          {data.declare.zonePays ? (
            <>
              <p><strong>Pays :</strong> {data.declare.zonePays.toUpperCase()}</p>
              {data.declare.zoneVille && <p><strong>Ville :</strong> {data.declare.zoneVille}</p>}
              {data.declare.zoneRayonKm && <p><strong>Rayon :</strong> {data.declare.zoneRayonKm} km</p>}
            </>
          ) : (
            <p>🌍 Ouvert à l&apos;international — aucune restriction de zone</p>
          )}
        </div>
      </div>

      <div className="block-activity">
        <div className="block-title">📊 Activité sur la plateforme</div>
        <div style={{ fontSize: "0.9rem", lineHeight: 1.8 }}>
          <p>⭐ <strong>Note moyenne :</strong> {data.activite.averageNote ? `${data.activite.averageNote.toFixed(1)} / 5` : "Pas encore d'avis"}</p>
          <p>✅ <strong>{data.activite.missionsCompleted} missions complétées</strong></p>
          <p>📅 <strong>Membre depuis :</strong> {new Date(data.activite.memberSince).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</p>
        </div>
      </div>

      <div className="alert alert-warning" style={{ marginTop: 20, fontSize: "0.85rem" }}>
        <strong>Flexwork ne garantit pas les déclarations du prestataire.</strong> Vous êtes seul responsable de votre
        choix. Les avis et missions complétées sont des faits constatés sur la plateforme.
      </div>
    </div>
  );
}
