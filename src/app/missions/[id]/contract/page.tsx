"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { SignContractModal } from "@/components/sign-contract-modal";

type TermsSnapshot = {
  objet: string;
  description: string;
  prix: number;
  devise: string;
  declarationAssurance: string | { insurerName: string; policyNumber: string; coverageCeiling: number; validUntil: string };
  declarationQualification: string | null;
  clausePlateformeNonPartie: string;
  clauseMediationFacultative: boolean;
  jalons?: { titre: string; montant: number }[] | null;
};

type Contract = {
  id: string;
  clientId: string;
  providerId: string;
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  termsSnapshot: TermsSnapshot;
};

type JalonRow = { titre: string; montant: string };

// Contrat de prestation — aligné sur formulaires-flexwork-tous-profils.html.
// Génération, signature électronique, consentement éclairé, avertissement no-insurance.
// Paiement fractionné optionnel (2026-08-06) : au moment de générer le contrat, le client
// peut décomposer le prix en jalons dont les montants doivent sommer exactement au prix de
// la proposition acceptée — sinon comportement historique inchangé (un seul paiement).
export default function ContractPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [contract, setContract] = useState<Contract | "none" | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedMontant, setAcceptedMontant] = useState<number | null>(null);
  const [useJalons, setUseJalons] = useState(false);
  const [jalonRows, setJalonRows] = useState<JalonRow[]>([{ titre: "", montant: "" }, { titre: "", montant: "" }]);
  const [signingRole, setSigningRole] = useState<"client" | "freelancer" | null>(null);

  async function load() {
    const res = await fetch(`/api/missions/${missionId}/contract`);
    if (res.status === 404) {
      setContract("none");
      const propRes = await fetch(`/api/missions/${missionId}/proposals`);
      if (propRes.ok) {
        const data = await propRes.json();
        const accepted = data.items?.find((p: { status: string; montant: number }) => p.status === "acceptee");
        setAcceptedMontant(accepted?.montant ?? null);
      }
      return;
    }
    if (res.ok) setContract(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const jalonsTotal = jalonRows.reduce((sum, r) => sum + (Number(r.montant) || 0), 0);
  const jalonsValid = useJalons && jalonRows.every((r) => r.titre.trim() && Number(r.montant) > 0) && acceptedMontant !== null && Math.abs(jalonsTotal - acceptedMontant) < 0.01;

  async function generateContract() {
    setError(null);
    const body = useJalons
      ? { jalons: jalonRows.map((r) => ({ titre: r.titre, montant: Number(r.montant) })) }
      : {};
    const res = await fetch(`/api/missions/${missionId}/contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === "jalons_sum_mismatch"
          ? `La somme des jalons doit être exactement égale au prix convenu (${acceptedMontant?.toLocaleString("fr-FR")}).`
          : data.error === "no_accepted_proposal"
            ? "Impossible de générer le contrat — vérifiez qu'une proposition a été acceptée."
            : "Impossible de générer le contrat."
      );
      return;
    }
    load();
  }

  // Signature électronique réelle (2026-08-06) — remplace l'ancien POST
  // /api/missions/[id]/contract/sign qui ne faisait que poser un horodatage sans aucune
  // preuve cryptographique (pas de certificat, pas de hash, pas de ContractSignature).
  // SignContractModal appelle POST /api/signature/sign (certificat RSA-2048 + passphrase,
  // src/lib/signature.ts) ; le verrouillage automatique à la 2e signature (hash final,
  // ContractAuditEntry) est géré côté serveur.
  function openSigning(role: "client" | "freelancer") {
    if (role === "client" && !consent) {
      setError("Vous devez cocher la case de consentement éclairé avant de signer.");
      return;
    }
    setError(null);
    setSigningRole(role);
  }

  async function acknowledgeNoInsurance() {
    await fetch(`/api/missions/${missionId}/acknowledgement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgementType: "no_insurance" }),
    });
  }

  if (contract === null) return <div className="container">Chargement...</div>;

  if (contract === "none") {
    return (
      <div className="container" style={{ maxWidth: 800 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Contrat de prestation</span></div>
          <p style={{ marginBottom: 16 }}>Aucun contrat généré pour cette mission — une proposition doit d&apos;abord être acceptée.</p>
          {error && <div className="alert alert-danger">{error}</div>}

          {acceptedMontant !== null && (
            <div style={{ borderTop: "1px solid var(--border, #eee)", marginTop: 12, paddingTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={useJalons} onChange={(e) => setUseJalons(e.target.checked)} />
                Fractionner le paiement en jalons (prix total : {acceptedMontant.toLocaleString("fr-FR")})
              </label>

              {useJalons && (
                <div style={{ marginTop: 12 }}>
                  {jalonRows.map((row, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        type="text"
                        placeholder={`Jalon ${i + 1} — titre`}
                        value={row.titre}
                        onChange={(e) => setJalonRows((rows) => rows.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                        style={{ flex: 2 }}
                      />
                      <input
                        type="number"
                        placeholder="Montant"
                        value={row.montant}
                        onChange={(e) => setJalonRows((rows) => rows.map((r, j) => (j === i ? { ...r, montant: e.target.value } : r)))}
                        style={{ flex: 1 }}
                      />
                      {jalonRows.length > 2 && (
                        <button type="button" className="btn btn-outline" onClick={() => setJalonRows((rows) => rows.filter((_, j) => j !== i))}>×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setJalonRows((rows) => [...rows, { titre: "", montant: "" }])}>
                    + Ajouter un jalon
                  </button>
                  <p style={{ fontSize: "0.85rem", color: Math.abs(jalonsTotal - acceptedMontant) < 0.01 ? "var(--secondary)" : "var(--danger)", marginTop: 8 }}>
                    Total des jalons : {jalonsTotal.toLocaleString("fr-FR")} / {acceptedMontant.toLocaleString("fr-FR")}
                  </p>
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={generateContract} disabled={useJalons && !jalonsValid}>
            Générer le contrat
          </button>
        </div>
      </div>
    );
  }

  const t = contract.termsSnapshot;
  const noInsurance = typeof t.declarationAssurance === "string";
  const isClient = userId === contract.clientId;
  const isProvider = userId === contract.providerId;
  const bothSigned = !!contract.clientSignedAt && !!contract.providerSignedAt;

  return (
    <div className="container" style={{ maxWidth: 800 }}>
      {noInsurance && (
        <div className="alert alert-danger">
          <strong>⚠️ Avertissement :</strong> Ce prestataire n&apos;a déclaré <strong>aucune assurance</strong> de
          responsabilité civile professionnelle. En cas de dommage pendant les travaux, aucune indemnisation par une
          assurance ne sera possible.
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Contrat de prestation</span>
          <span className="badge badge-declared">Outil généré par Flexwork</span>
        </div>

        <div style={{ fontSize: "0.9rem", lineHeight: 1.7, marginBottom: 20 }}>
          <h3 style={{ color: "var(--primary)", marginBottom: 8 }}>Article 1 — Objet</h3>
          <p>{t.objet} — {t.description}</p>

          <h3 style={{ color: "var(--primary)", margin: "16px 0 8px" }}>Article 2 — Prix et modalités</h3>
          <p>Prix total : <strong>{t.prix.toLocaleString("fr-FR")} {t.devise}</strong></p>
          {t.jalons && t.jalons.length > 0 ? (
            <>
              <p>Paiement fractionné en {t.jalons.length} jalons, chacun séquestré et libéré indépendamment via le PSP agréé :</p>
              <ul style={{ marginLeft: 20 }}>
                {t.jalons.map((j, i) => (
                  <li key={i}>{j.titre} — <strong>{j.montant.toLocaleString("fr-FR")} {t.devise}</strong></li>
                ))}
              </ul>
            </>
          ) : (
            <p>Séquestre via PSP agréé. Libération sur validation explicite du client ou acceptation tacite après 7 jours.</p>
          )}

          <h3 style={{ color: "var(--primary)", margin: "16px 0 8px" }}>Article 3 — Déclarations du prestataire</h3>
          <p>Assurance : {noInsurance ? <em>{t.declarationAssurance as string}</em> : "Assurance déclarée, voir profil du prestataire."}</p>
          <p>Qualification : {t.declarationQualification ?? "Aucune qualification déclarée"} — non vérifié par Flexwork.</p>

          <h3 style={{ color: "var(--primary)", margin: "16px 0 8px" }}>Article 4 — Responsabilités</h3>
          <p><strong>{t.clausePlateformeNonPartie}</strong></p>

          <h3 style={{ color: "var(--primary)", margin: "16px 0 8px" }}>Article 5 — Médiation facultative</h3>
          <p>En cas de contestation, une médiation peut être proposée. Sa proposition n&apos;est pas opposable.</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {isClient && !contract.clientSignedAt && (
          <div style={{ borderTop: "2px solid var(--border)", paddingTop: 16 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontWeight: 400, cursor: "pointer" }}>
              <input
                type="checkbox"
                style={{ width: "auto", marginTop: 4 }}
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  if (e.target.checked && noInsurance) acknowledgeNoInsurance();
                }}
              />
              <span><strong>J&apos;ai compris et je choisis ce prestataire</strong> en pleine connaissance de cause.</span>
            </label>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><span className="card-title">Signature Client</span></div>
          {contract.clientSignedAt ? (
            <p style={{ color: "var(--secondary)" }}>✓ Signé le {new Date(contract.clientSignedAt).toLocaleString("fr-FR")}</p>
          ) : isClient ? (
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => openSigning("client")}>Signer électroniquement</button>
          ) : (
            <p style={{ color: "var(--muted)" }}>En attente</p>
          )}
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Signature Prestataire</span></div>
          {contract.providerSignedAt ? (
            <p style={{ color: "var(--secondary)" }}>✓ Signé le {new Date(contract.providerSignedAt).toLocaleString("fr-FR")}</p>
          ) : isProvider ? (
            <button className="btn btn-secondary" style={{ width: "100%" }} onClick={() => openSigning("freelancer")}>Signer électroniquement</button>
          ) : (
            <p style={{ color: "var(--muted)" }}>En attente</p>
          )}
        </div>
      </div>

      {bothSigned && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <Link href={`/missions/${missionId}/escrow`} className="btn btn-primary">Procéder au paiement sous séquestre</Link>
        </div>
      )}

      {signingRole && (
        <SignContractModal
          contractId={contract.id}
          role={signingRole}
          signerName={session?.user?.name ?? (signingRole === "client" ? "Client" : "Prestataire")}
          signerEmail={session?.user?.email ?? ""}
          onClose={() => setSigningRole(null)}
          // Ne ferme pas la modale : elle affiche elle-même l'écran "done" (QR code de
          // signature, étape 7) après une signature réussie — se fermer ici l'aurait
          // masqué immédiatement, avant que l'utilisateur n'ait pu le voir. La modale se
          // ferme via son propre bouton "Fermer" (onClose). On se contente de rafraîchir
          // les données du contrat en arrière-plan.
          onSigned={() => load()}
        />
      )}
    </div>
  );
}
