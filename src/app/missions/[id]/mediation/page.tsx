"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type Mediation = {
  id: string;
  reason: string;
  proposedResolution: string | null;
  clientAccepted: boolean | null;
  providerAccepted: boolean | null;
  outcome: string | null;
};

// Médiation facultative — aligné sur formulaires-flexwork-tous-profils.html.
// Ouverture, proposition admin, acceptation/refus. La plateforme ne tranche jamais.
export default function MediationPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [mediations, setMediations] = useState<Mediation[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/mediation`);
    if (res.ok) setMediations((await res.json()).items);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  async function openMediation(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/mediation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      setReason("");
      load();
    } else {
      setError("Échec de l'ouverture de la médiation.");
    }
  }

  async function respond(mediationId: string, accept: boolean) {
    const res = await fetch(`/api/admin/mediations/${mediationId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accept }),
    });
    if (res.ok) {
      setResult(
        accept
          ? "Vous avez accepté la proposition. En attente de l'accord de l'autre partie..."
          : "Vous avez refusé la proposition. Les fonds restent gelés selon les conditions du PSP. Vous pouvez saisir la juridiction compétente."
      );
      load();
    }
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">Médiation facultative</span>
          <span className="badge badge-declared">Phase 6</span>
        </div>

        <div className="alert alert-warning">
          Flexwork peut proposer une médiation, mais <strong>ne tranche pas</strong>. Sa proposition n&apos;est pas
          opposable.
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {mediations.length === 0 && (
          <form onSubmit={openMediation}>
            <div className="form-group">
              <label>Motif de contestation</label>
              <textarea rows={3} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary">Ouvrir une médiation</button>
          </form>
        )}

        {mediations.map((m) => {
          const isClient = userId !== undefined;
          const alreadyResponded = isClient ? m.clientAccepted !== null : m.providerAccepted !== null;
          return (
            <div key={m.id} style={{ marginTop: 16 }}>
              <div style={{ background: "var(--light)", padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <p><strong>Motif :</strong> {m.reason}</p>
                {m.outcome && <p><strong>Issue :</strong> {m.outcome}</p>}
              </div>

              {m.proposedResolution ? (
                <div className="card" style={{ background: "#fffbeb" }}>
                  <div className="card-header"><span className="card-title">Proposition de résolution (Admin Médiation)</span></div>
                  <p style={{ fontSize: "0.9rem", marginBottom: 12 }}>{m.proposedResolution}</p>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    Cette proposition est facultative. Chaque partie peut l&apos;accepter ou la refuser librement.
                  </p>
                  {!alreadyResponded && !m.outcome && (
                    <div className="grid-2" style={{ marginTop: 20 }}>
                      <button className="btn btn-primary" onClick={() => respond(m.id, true)}>✓ J&apos;accepte la proposition</button>
                      <button className="btn btn-outline" onClick={() => respond(m.id, false)}>✗ Je refuse la proposition</button>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>En attente d&apos;une proposition de l&apos;Admin Médiation.</p>
              )}
            </div>
          );
        })}

        {result && <div className="alert alert-info" style={{ marginTop: 20 }}>{result}</div>}
      </div>
    </div>
  );
}
