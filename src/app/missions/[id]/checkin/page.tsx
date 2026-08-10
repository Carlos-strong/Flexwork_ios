"use client";

import { useEffect, useState } from "react";

type CheckInEvent = { id: string; type: "arrivee" | "depart"; occurredAt: string; gpsLat: number | null; gpsLng: number | null };

// Pointage de présence — aligné sur formulaires-flexwork-tous-profils.html.
// Opt-in indépendant, GPS, purge automatique. La plateforme ne lit jamais ces données.
export default function CheckinPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const [optedIn, setOptedIn] = useState(false);
  const [active, setActive] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CheckInEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    const contractRes = await fetch(`/api/missions/${missionId}/contract`);
    if (!contractRes.ok) return;
    const contract = await contractRes.json();
    const isActive = Boolean(contract.clientOptedInCheckIn && contract.providerOptedInCheckIn);
    setActive(isActive);
    setOptedIn(Boolean(contract.clientOptedInCheckIn || contract.providerOptedInCheckIn));

    if (isActive) {
      const res = await fetch(`/api/missions/${missionId}/contract/checkin/events`);
      if (res.ok) setEvents((await res.json()).items);
    }
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function handleOptIn() {
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/contract/checkin/opt-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optIn: true }),
    });
    if (res.ok) {
      setOptedIn(true);
      loadEvents();
    } else {
      setError("Échec de l'activation.");
    }
  }

  async function checkIn(type: "arrivee" | "depart") {
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/contract/checkin/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (res.ok) {
      loadEvents();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "checkin_tool_not_active" ? "Les deux parties doivent activer le pointage avant tout horodatage." : "Échec de l'enregistrement.");
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Pointage de présence</span>
          <span className="badge badge-info">Opt-in</span>
        </div>

        <div className="alert alert-info">
          <strong>Outil optionnel.</strong> Ce pointage sert de preuve de présence entre vous et le client. Flexwork
          ne consulte, n&apos;agrège et n&apos;utilise jamais ces données pour une décision.
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {active === false && !optedIn && (
          <div>
            <p style={{ marginBottom: 12, color: "var(--muted)" }}>
              Le pointage n&apos;est pas encore actif — activez votre consentement. Il ne s&apos;activera réellement
              qu&apos;une fois l&apos;autre partie également consentante, sans aucune conséquence si elle refuse.
            </p>
            <button className="btn btn-primary" onClick={handleOptIn}>Activer le pointage de mon côté</button>
          </div>
        )}

        {active === false && optedIn && (
          <div className="alert alert-warning">En attente du consentement de l&apos;autre partie.</div>
        )}

        {active === true && (
          <>
            <div style={{ background: "#f0fdf4", padding: 14, borderRadius: 8, marginBottom: 16 }}>
              <strong style={{ color: "#166534" }}>✓ Outil activé</strong>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: 4 }}>
                Vous et le client avez tous deux consenti à l&apos;activation.
              </p>
            </div>

            <div className="grid-2">
              <button className="btn btn-primary" onClick={() => checkIn("arrivee")}>📍 Arrivée</button>
              <button className="btn btn-secondary" onClick={() => checkIn("depart")}>🏁 Départ</button>
            </div>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ fontSize: "0.9rem", color: "var(--primary)", marginBottom: 8 }}>
                Historique (visible uniquement par les deux parties)
              </h4>
              {events.map((ev) => (
                <div key={ev.id} style={{ fontSize: "0.85rem", color: "var(--muted)", padding: 8, background: "var(--light)", borderRadius: 6, marginBottom: 6 }}>
                  <strong>{ev.type === "arrivee" ? "Arrivée" : "Départ"}</strong> — {new Date(ev.occurredAt).toLocaleString("fr-FR")}
                  {ev.gpsLat && ev.gpsLng ? ` — GPS: ${ev.gpsLat}, ${ev.gpsLng}` : ""}
                </div>
              ))}
              {events.length === 0 && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Aucun pointage enregistré.</p>}
            </div>
          </>
        )}
      </div>

      <div className="alert alert-warning" style={{ fontSize: "0.8rem" }}>
        <strong>Protection des données :</strong> Ces horodatages sont conservés pendant la durée de la mission + 7
        jours, puis purgés automatiquement. Aucun admin Flexwork n&apos;y a accès. Ils ne sont utilisés dans aucun
        score, classement ou décision de litige.
      </div>
    </div>
  );
}
