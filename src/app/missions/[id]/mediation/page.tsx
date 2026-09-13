"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
// Style harmonisé (2026-08-29) sur le système visuel de missions/[id]/page.tsx (Tailwind,
// palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
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
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[720px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Médiation</span>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[13px] font-semibold">Médiation facultative</h1>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">Phase 6</span>
          </div>

          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[12.5px] text-[#92400E] leading-relaxed">
            Flexwork peut proposer une médiation, mais <strong>ne tranche pas</strong>. Sa proposition n&apos;est pas
            opposable.
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

          {mediations.length === 0 && (
            <form onSubmit={openMediation} className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[#475569] mb-1">Motif de contestation</label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                />
              </div>
              <button type="submit" className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">
                Ouvrir une médiation
              </button>
            </form>
          )}

          {mediations.map((m) => {
            const isClient = userId !== undefined;
            const alreadyResponded = isClient ? m.clientAccepted !== null : m.providerAccepted !== null;
            return (
              <div key={m.id} className="space-y-3">
                <div className="rounded-xl bg-[#F8FAF9] border border-[#E2E8F0] p-4 text-[13px]">
                  <p><strong className="text-[#0f172a]">Motif :</strong> <span className="text-[#475569]">{m.reason}</span></p>
                  {m.outcome && <p className="mt-1"><strong className="text-[#0f172a]">Issue :</strong> <span className="text-[#475569]">{m.outcome}</span></p>}
                </div>

                {m.proposedResolution ? (
                  <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4">
                    <h3 className="text-[13px] font-semibold mb-2">Proposition de résolution (Admin Médiation)</h3>
                    <p className="text-[13px] text-[#475569] leading-relaxed mb-3">{m.proposedResolution}</p>
                    <p className="text-[12px] text-[#94A3B8]">
                      Cette proposition est facultative. Chaque partie peut l&apos;accepter ou la refuser librement.
                    </p>
                    {!alreadyResponded && !m.outcome && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                        <button onClick={() => respond(m.id, true)} className="h-10 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">
                          ✓ J&apos;accepte la proposition
                        </button>
                        <button onClick={() => respond(m.id, false)} className="h-10 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9] transition-colors">
                          ✗ Je refuse la proposition
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-[#64748B]">En attente d&apos;une proposition de l&apos;Admin Médiation.</p>
                )}
              </div>
            );
          })}

          {result && <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{result}</div>}
        </div>

        <Link href={`/missions/${missionId}`} className="inline-block text-[#64748B] text-[13px]" style={{ textDecoration: "none" }}>
          ← Retour au détail de la mission
        </Link>
      </div>
    </div>
  );
}
