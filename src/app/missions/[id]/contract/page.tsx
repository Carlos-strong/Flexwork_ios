"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignContractModal } from "@/components/sign-contract-modal";
import { SignatureQRCode } from "@/components/signature-qrcode";
import { Avatar } from "@/components/avatar";
import { CONTRACT_STEPS, stepIndexFor } from "@/lib/contract-stepper";
import { buildContractSections, buildContractParties, contractReference } from "@/lib/contract-clauses";
import { fetchDedupe } from "@/lib/fetch-dedupe";

type TermsSnapshot = {
  // name/city/country/role : ajoutés avec le bloc Parties du modèle de référence
  // (2026-08-31) — optionnels, les contrats générés avant ne les portent pas et retombent
  // sur l'identité jointe par l'API.
  client: { id: string; email: string; tel: string; name?: string | null; city?: string | null; country?: string | null };
  provider: { id: string; email: string; tel: string; name?: string | null; city?: string | null; country?: string | null; role?: string | null };
  regimeRemuneration?: string | null;
  objet: string;
  description: string;
  prix: number;
  devise: string;
  declarationAssurance: string | { insurerName: string; policyNumber: string; coverageCeiling: number; validUntil: string };
  declarationQualification: string | null;
  clausePlateformeNonPartie: string;
  clauseMediationFacultative: boolean;
  declarationAge?: string | null;
  clauseDuree?: string;
  clauseStatutIndependant?: string;
  clauseProprieteIntellectuelle?: string;
  clauseConfidentialite?: string;
  clauseResiliation?: string;
  clauseResponsabilite?: string;
  clauseDroitApplicable?: string;
  jalons?: { titre: string; montant: number }[] | null;
};

type ContractParty = { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null };

type Contract = {
  id: string;
  clientId: string;
  providerId: string;
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  termsSnapshot: TermsSnapshot;
  client: ContractParty;
  provider: ContractParty;
};

type JalonRow = { titre: string; montant: string };

// Réponse de GET /api/missions/[id]/financing-mode — `preview` est le découpage EXACT que la
// génération de contrat produira (même fonction de dérivation côté serveur), pas un aperçu
// approché. `previewError === "devis_required"` = mode à jalons sans devis à dériver.
type FinancingState = {
  financingModeKey: string | null;
  locked: boolean;
  mode: {
    key: string;
    label: string;
    definition: string;
    usesJalons: boolean;
    progressive: boolean;
    sequential: boolean;
    // Fraction retenue sur chaque jalon (0 hors mode J4) — le quatrième levier du catalogue,
    // aussi structurant que `progressive` pour ce que le client doit lire avant de figer.
    retentionRate: number;
  } | null;
  preview: { titre: string; montant: number }[] | null;
  previewError: string | null;
};

// Détail cryptographique réel d'une signature (POST /api/signature/verify — src/lib/signature.ts,
// SignatureService.verifySignature) : jamais fabriqué ici, seulement relu pour réafficher le
// même QR (SignatureQRCode) qu'à l'instant de la signature lors d'une visite ultérieure de
// cette page.
type SignatureRecord = {
  signatureId: string;
  signerName: string;
  signerEmail: string;
  keyFingerprint: string;
  signedAt: string;
  signedDataHash: string;
};

function Stepper({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="flex gap-2 mb-6 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      {CONTRACT_STEPS.map((label, i) => (
        <div
          key={label}
          className={`shrink-0 px-3 py-1.5 rounded-full border text-[12px] font-semibold whitespace-nowrap ${
            i < stepIndex
              ? "bg-[#008751] text-white border-[#008751]"
              : i === stepIndex
                ? "bg-[#0f172a] text-white border-[#0f172a]"
                : "bg-[#F8FAF9] text-[#94A3B8] border-[#E2E8F0]"
          }`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function fullNameOf(p: ContractParty | undefined): string | null {
  const n = [p?.firstname, p?.lastname].filter(Boolean).join(" ").trim();
  return n || null;
}

function initialsOf(p: ContractParty | undefined): string {
  const a = p?.firstname?.trim()?.charAt(0) ?? "";
  const b = p?.lastname?.trim()?.charAt(0) ?? "";
  return (`${a}${b}`.toUpperCase()) || "?";
}

// Carte de signature — même carte pour Client et Prestataire, seuls le rôle, le signataire
// attendu et la règle de séquence changent. Réutilise SignContractModal/SignatureQRCode tels
// quels : aucun changement de la logique de signature elle-même.
function SignatureCard({
  role,
  roleLabel,
  party,
  signedAt,
  signatureRecord,
  isSelf,
  canSignNow,
  blockedReason,
  contractId,
  onOpenSigning,
  buttonClass,
}: {
  role: "client" | "freelancer";
  roleLabel: string;
  party: ContractParty;
  signedAt: string | null;
  signatureRecord: SignatureRecord | null;
  isSelf: boolean;
  canSignNow: boolean;
  blockedReason: string | null;
  contractId: string;
  onOpenSigning: () => void;
  buttonClass: string;
}) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13px] font-semibold">Signature {roleLabel}</h3>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${signedAt ? "bg-[#E6F4EE] text-[#008751] border border-[#A7F3D0]" : "bg-[#F1F5F9] text-[#64748B]"}`}>
          {signedAt ? "Signature vérifiable" : "En attente"}
        </span>
      </div>

      <div className="flex items-center gap-2.5 mb-4">
        <Avatar src={party.avatarPath ? `/api/users/${party.id}/avatar` : null} initials={initialsOf(party)} size={40} />
        <div>
          <div className="text-[13px] font-semibold">{fullNameOf(party) ?? roleLabel}</div>
          <div className="text-[11.5px] text-[#64748B]">{roleLabel}</div>
        </div>
      </div>

      {signedAt && signatureRecord ? (
        <div className="text-center">
          <SignatureQRCode
            contractId={contractId}
            signatureId={signatureRecord.signatureId}
            role={role}
            signerName={signatureRecord.signerName}
            signedAt={signatureRecord.signedAt}
            keyFingerprint={signatureRecord.keyFingerprint}
            signedDataHash={signatureRecord.signedDataHash}
            size={110}
          />
          <p className="mt-2.5 text-[11.5px] text-[#64748B]">
            QR généré le {new Date(signedAt).toLocaleDateString("fr-FR")} à{" "}
            {new Date(signedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ) : signedAt ? (
        // Signé, mais le détail cryptographique (POST /api/signature/verify) n'est pas
        // encore revenu — évite un QR vide plutôt que d'en fabriquer un.
        <p className="text-[13px] text-[#008751]">✓ Signé le {new Date(signedAt).toLocaleString("fr-FR")}</p>
      ) : isSelf ? (
        <>
          <button
            disabled={!canSignNow}
            onClick={onOpenSigning}
            className={`w-full h-10 rounded-lg text-white text-[13px] font-semibold transition-colors disabled:opacity-50 ${buttonClass === "btn-primary" ? "bg-[#008751] hover:bg-[#007a49]" : "bg-[#0f172a] hover:bg-black"}`}
          >
            Signer le contrat
          </button>
          {blockedReason && (
            <p className="mt-2 text-[11.5px] text-[#94A3B8] text-center">{blockedReason}</p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-[#64748B]">En attente</p>
      )}
    </div>
  );
}

// Contrat de prestation — aligné sur formulaires-flexwork-tous-profils.html et sur la
// maquette Flexwork-Vues-Vjr-International (stepper 5 étapes, cartes de signature
// double avec QR). Génération, signature électronique, consentement éclairé, avertissement
// no-insurance. Paiement fractionné optionnel (2026-08-06) : au moment de générer le
// contrat, le client peut décomposer le prix en jalons dont les montants doivent sommer
// exactement au prix de la proposition acceptée — sinon comportement historique inchangé
// (un seul paiement).
// Style harmonisé (2026-08-29) sur le système visuel de missions/[id]/page.tsx (Tailwind,
// palette #0f172a/#E2E8F0/#008751) — logique et appels API strictement inchangés.
export default function ContractPage({ params }: { params: { id: string } }) {
  const { id: missionId } = params;
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // session.user.name n'est PAS un nom d'affichage : NextAuth le fixe au numéro de
  // téléphone (voir src/auth.ts, authorize()). Sans cette requête, le nom par défaut
  // proposé pour signer un contrat aurait été le téléphone du signataire.
  const [fullName, setFullName] = useState<string | null>(null);
  useEffect(() => {
    if (!session?.user) return;
    fetchDedupe("/api/users/me").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFullName(d.fullName)).catch(() => {});
  }, [session?.user]);

  const [contract, setContract] = useState<Contract | "none" | null>(null);
  const [missionStatus, setMissionStatus] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedMontant, setAcceptedMontant] = useState<number | null>(null);
  const [useJalons, setUseJalons] = useState(false);
  const [jalonRows, setJalonRows] = useState<JalonRow[]>([{ titre: "", montant: "" }, { titre: "", montant: "" }]);
  // Options de gestion des jalons (règles 18.4/18.8-18.9) — choisies ici, au même moment que
  // la décomposition en jalons elle-même, puis figées pour la vie du contrat (voir le
  // commentaire sur PrestationContract.financingMode, prisma/schema.prisma). Sans effet si
  // `useJalons` est décoché : le formulaire n'envoie alors ni jalons ni ces deux options.
  const [progressiveFinancing, setProgressiveFinancing] = useState(false);
  const [jalonsSequential, setJalonsSequential] = useState(false);
  // Mode de financement choisi à la PUBLICATION (2026-09-10) — quand il est présent, les
  // jalons ne se saisissent plus ici : ils sont dérivés du devis accepté par le serveur
  // (GET .../financing-mode renvoie l'aperçu exact de ce qui sera créé). Le formulaire manuel
  // ci-dessous ne subsiste que pour les missions publiées avant cette date, ou pour un mode à
  // jalons sur une mission à prix fixe sans devis (`previewError === "devis_required"`).
  const [financing, setFinancing] = useState<FinancingState | null>(null);
  const [signingRole, setSigningRole] = useState<"client" | "freelancer" | null>(null);
  // Déclenchement automatique du séquestre (recommandation #2 du modèle) : passé à true
  // quand LE CLIENT vient de signer (2/2 — il signe toujours en dernier, imposé serveur),
  // pour rediriger vers l'étape de financement à la fermeture de la modale.
  const [clientJustSigned, setClientJustSigned] = useState(false);

  async function loadSignatures(contractId: string) {
    try {
      const res = await fetch("/api/signature/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSignatures(data.signatures ?? []);
    } catch {
      /* la carte retombe sur l'état "✓ Signé le ..." sans QR — pas de simulation */
    }
  }

  async function load() {
    const res = await fetchDedupe(`/api/missions/${missionId}/contract`);
    if (res.status === 404) {
      setContract("none");
      const propRes = await fetchDedupe(`/api/missions/${missionId}/proposals`);
      if (propRes.ok) {
        const data = await propRes.json();
        const accepted = data.items?.find((p: { status: string; montant: number }) => p.status === "acceptee");
        setAcceptedMontant(accepted?.montant ?? null);
      }
      return;
    }
    if (res.ok) {
      const c: Contract = await res.json();
      setContract(c);
      if (c.clientSignedAt || c.providerSignedAt) loadSignatures(c.id);
    }
  }

  useEffect(() => {
    load();
    fetchDedupe(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setMissionStatus(d.status)).catch(() => {});
    fetchDedupe(`/api/missions/${missionId}/financing-mode`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFinancing(d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  // Le mode pilote la génération dès qu'il produit un découpage exploitable. `devis_required`
  // = mode à jalons sans devis à dériver : on repasse la main au formulaire manuel plutôt que
  // de bloquer le client.
  const derivedFinancing = financing?.mode && financing.previewError !== "devis_required" ? financing : null;

  const jalonsTotal = jalonRows.reduce((sum, r) => sum + (Number(r.montant) || 0), 0);
  const jalonsValid = useJalons && jalonRows.every((r) => r.titre.trim() && Number(r.montant) > 0) && acceptedMontant !== null && Math.abs(jalonsTotal - acceptedMontant) < 0.01;

  async function generateContract() {
    setError(null);
    // Mode choisi à la publication : le serveur dérive tout du devis, le corps est ignoré —
    // on n'envoie rien plutôt que d'envoyer des valeurs qui seraient silencieusement écartées.
    const body = derivedFinancing
      ? {}
      : {
          ...(useJalons ? { jalons: jalonRows.map((r) => ({ titre: r.titre, montant: Number(r.montant) })) } : {}),
          // Financement progressif : indépendant de useJalons (s'applique aussi bien par jalon
          // que sur le prix total d'un contrat sans jalon). Jalons séquentiels : sans effet si
          // useJalons est décoché, envoyé quand même sans risque (le serveur l'ignore).
          financingMode: progressiveFinancing ? "progressive" : "lump_sum",
          jalonsSequential,
        };
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

  if (contract === null) return <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center text-[13px] text-[#64748B]">Chargement...</div>;

  const stepIndex = stepIndexFor(contract, missionStatus);

  if (contract === "none") {
    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
        <div className="max-w-[800px] mx-auto px-4 lg:px-0 py-5">
          <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap mb-4">
            <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
            <span>›</span>
            <span className="text-[#0f172a] font-medium">Contrat</span>
          </div>

          <Stepper stepIndex={stepIndex} />
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
            <h1 className="text-[13px] font-semibold mb-3">Contrat de prestation</h1>
            <p className="text-[13px] text-[#64748B] mb-4">Aucun contrat généré pour cette mission — une proposition doit d&apos;abord être acceptée.</p>
            {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C] mb-4">{error}</div>}

            {/* Mode choisi à la publication : rien à saisir. Le découpage affiché ici est
                EXACTEMENT celui que le serveur créera (même fonction de dérivation), pas une
                estimation — le client valide ce qu'il voit. */}
            {derivedFinancing && (
              <div className="border-t border-[#F1F5F9] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[13px]">Financement — {derivedFinancing.mode!.label}</strong>
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[#E6F4EE] text-[#008751]">
                    Choisi à la publication
                  </span>
                </div>
                <p className="text-[12.5px] text-[#64748B] mt-1 leading-relaxed">{derivedFinancing.mode!.definition}</p>

                {derivedFinancing.preview && derivedFinancing.preview.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-[#E2E8F0] overflow-hidden">
                    {derivedFinancing.preview.map((j, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] border-b border-[#F1F5F9] last:border-b-0"
                      >
                        <span className="text-[#64748B] shrink-0">#{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[#0f172a]">{j.titre}</span>
                        <strong className="text-[#008751] shrink-0">{j.montant.toLocaleString("fr-FR")}</strong>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 text-[12.5px] bg-[#F8FAF9]">
                      <span className="font-semibold">Total</span>
                      <strong>{derivedFinancing.preview.reduce((s, j) => s + j.montant, 0).toLocaleString("fr-FR")}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] px-3 py-2.5 text-[12px] text-[#64748B]">
                    Paiement unique sur le prix total du contrat — aucun fractionnement.
                  </div>
                )}

                <div className="mt-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] px-3 py-2.5 text-[12px] text-[#64748B]">
                  <span className="font-semibold text-[#0f172a]">Avec ce mode : </span>
                  {derivedFinancing.mode!.usesJalons ? (
                    <>
                      chaque jalon sera financé, soumis et validé indépendamment,{" "}
                      {derivedFinancing.mode!.sequential
                        ? "dans l'ordre où ils apparaissent"
                        : "dans n'importe quel ordre"}
                      , et {derivedFinancing.mode!.progressive
                        ? "chacun sera payé progressivement, au fil de ses points d'étape validés."
                        : "chacun sera payé en une seule fois, une fois entièrement validé à 100%."}
                      {/* Sans cette branche, un mode à retenue de garantie (J4) héritait mot
                          pour mot de la phrase de J1 — « chacun sera payé en une seule fois »
                          — alors que seuls 95 % de chaque jalon sont versés à sa validation.
                          C'est l'écran où le client arrête un choix présenté comme définitif :
                          il ne peut pas y lire l'inverse de ce qui se produira. */}
                      {derivedFinancing.mode!.retentionRate > 0 && (
                        <>
                          {" "}
                          Sur chaque jalon, {Math.round(derivedFinancing.mode!.retentionRate * 100)} % resteront
                          au séquestre au titre de la retenue de garantie ; la retenue cumulée sera versée en une
                          seule fois une fois TOUS les jalons validés.
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      un seul paiement sera séquestré pour la mission entière, et{" "}
                      {derivedFinancing.mode!.progressive
                        ? "chaque point d'étape validé en libérera aussitôt la part correspondante."
                        : "il sera libéré en une seule fois, une fois la mission entièrement validée à 100%."}
                    </>
                  )}{" "}
                  Ce choix est définitif une fois le contrat généré.
                </div>
              </div>
            )}

            {!derivedFinancing && acceptedMontant !== null && (
              <div className="border-t border-[#F1F5F9] pt-3">
                <label className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold">
                  <input type="checkbox" className="w-auto" checked={useJalons} onChange={(e) => setUseJalons(e.target.checked)} />
                  Fractionner le paiement en jalons (prix total : <span>{acceptedMontant.toLocaleString("fr-FR")}</span>)
                </label>

                {useJalons && (
                  <div className="mt-3 space-y-2">
                    {jalonRows.map((row, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          placeholder={`Jalon ${i + 1} — titre`}
                          value={row.titre}
                          onChange={(e) => setJalonRows((rows) => rows.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                          className="flex-[2] h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                        />
                        <input
                          type="number"
                          placeholder="Montant"
                          value={row.montant}
                          onChange={(e) => setJalonRows((rows) => rows.map((r, j) => (j === i ? { ...r, montant: e.target.value } : r)))}
                          className="flex-1 h-9 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
                        />
                        {jalonRows.length > 2 && (
                          <button type="button" onClick={() => setJalonRows((rows) => rows.filter((_, j) => j !== i))} className="h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[13px] hover:bg-[#F8FAF9]">×</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setJalonRows((rows) => [...rows, { titre: "", montant: "" }])} className="h-8 px-3 rounded-md border border-[#E2E8F0] bg-white text-[11px] font-medium hover:bg-[#F1F5F9]">
                      + Ajouter un jalon
                    </button>
                    <p className={`text-[12.5px] mt-1 ${Math.abs(jalonsTotal - acceptedMontant) < 0.01 ? "text-[#008751]" : "text-[#E8112D]"}`}>
                      Total des jalons : <span>{jalonsTotal.toLocaleString("fr-FR")}</span> / <span>{acceptedMontant.toLocaleString("fr-FR")}</span>
                    </p>

                    <label className="flex items-center gap-2 cursor-pointer text-[12.5px] mt-2">
                      <input type="checkbox" className="w-auto" checked={jalonsSequential} onChange={(e) => setJalonsSequential(e.target.checked)} />
                      Jalons séquentiels — un jalon ne peut être financé que si le précédent est déjà validé par le client
                    </label>
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer text-[12.5px] mt-3">
                  <input type="checkbox" className="w-auto" checked={progressiveFinancing} onChange={(e) => setProgressiveFinancing(e.target.checked)} />
                  Financement progressif — chaque point d&apos;étape confirmé libère aussitôt la part correspondante des fonds, sans attendre la fin {useJalons ? "du jalon" : "de la mission"}
                </label>

                {/* Récapitulatif en clair de la combinaison choisie — les 3 cases ci-dessus
                    sont indépendantes dans le payload mais se combinent (voir
                    options-gestion-jalons.md) ; ce texte évite au client de devoir déduire
                    lui-même le comportement résultant des 6 combinaisons possibles. Figé à la
                    génération du contrat, comme les jalons eux-mêmes — d'où l'avertissement. */}
                <div className="mt-3 rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] px-3 py-2.5 text-[12px] text-[#64748B]">
                  <span className="font-semibold text-[#0f172a]">Avec ces choix : </span>
                  {useJalons ? (
                    <>
                      chaque jalon sera financé, soumis et validé indépendamment,{" "}
                      {jalonsSequential
                        ? "dans l'ordre où ils apparaissent (impossible de financer un jalon avant que le précédent soit validé)"
                        : "dans n'importe quel ordre"}
                      , et {progressiveFinancing
                        ? "chacun sera payé progressivement, au fil de ses points d'étape validés."
                        : "chacun sera payé en une seule fois, une fois entièrement validé à 100%."}
                    </>
                  ) : (
                    <>
                      un seul paiement sera séquestré pour la mission entière, et{" "}
                      {progressiveFinancing
                        ? "chaque point d'étape validé en libérera aussitôt la part correspondante, sans attendre la fin de la mission."
                        : "il sera libéré en une seule fois, une fois la mission entièrement validée à 100%."}
                    </>
                  )}{" "}
                  Ce choix est définitif une fois le contrat généré.
                </div>
              </div>
            )}

            <button onClick={generateContract} disabled={!derivedFinancing && useJalons && !jalonsValid} className="mt-4 h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors disabled:opacity-50">
              Générer le contrat
            </button>
          </div>
        </div>
      </div>
    );
  }

  const t = contract.termsSnapshot;
  const sections = buildContractSections(t);
  // En-tête du modèle de référence : bloc Parties + préambule rappelant la référence. Les
  // données viennent du termsSnapshot figé (et non du compte, qui peut avoir changé depuis).
  const parties = buildContractParties({
    reference: contractReference(contract.id),
    client: { ...(t.client ?? {}), name: t.client?.name ?? fullNameOf(contract.client) },
    provider: { ...(t.provider ?? {}), name: t.provider?.name ?? fullNameOf(contract.provider) },
  });
  const noInsurance = typeof t.declarationAssurance === "string";
  const isClient = userId === contract.clientId;
  const isProvider = userId === contract.providerId;
  const bothSigned = !!contract.clientSignedAt && !!contract.providerSignedAt;
  const clientSignature = signatures.find((s) => s.signerEmail === t.client.email) ?? null;
  const providerSignature = signatures.find((s) => s.signerEmail === t.provider.email) ?? null;

  // Fermeture de la modale de signature → si le CLIENT vient d'apposer la 2ᵉ signature
  // (les deux parties sont donc signataires), on le redirige automatiquement vers l'étape
  // de financement (séquestre) au lieu du clic manuel « Procéder au paiement sous
  // séquestre ». La navigation ne contourne JAMAIS le consentement explicite au HOLD : la
  // page séquestre reste celle qui instruit l'instruction au PSP (« En validant, vous
  // autorisez le PSP agréé à mettre sous séquestre le montant indiqué »). On navigue à la
  // fermeture (pas dès onSigned) pour laisser visible l'écran de preuve (QR code) qui
  // s'affiche après une signature réussie.
  function handleCloseSigning() {
    const advanceToEscrow = clientJustSigned && isClient && bothSigned;
    setClientJustSigned(false);
    setSigningRole(null);
    if (advanceToEscrow) router.push(`/missions/${missionId}/escrow`);
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[800px] mx-auto px-4 lg:px-0 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#64748B] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#0f172a]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#0f172a] font-medium">Contrat</span>
        </div>

        <Stepper stepIndex={stepIndex} />

        {noInsurance && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-[13px] text-[#B91C1C] leading-relaxed">
            <strong>⚠️ Avertissement :</strong> Ce prestataire n&apos;a déclaré <strong>aucune assurance</strong> de
            responsabilité civile professionnelle. En cas de dommage pendant les travaux, aucune indemnisation par une
            assurance ne sera possible.
          </div>
        )}

        {contract.providerSignedAt && !contract.clientSignedAt && (
          <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-[13px] text-[#92400E] leading-relaxed flex items-start gap-2">
            <span className="shrink-0">⏳</span>
            <span>
              <strong>Signature du prestataire reçue.</strong> Le client dispose de 48&nbsp;h pour contre-signer ;
              passé ce délai, le contrat sera annulé sans pénalité et le prestataire devra signer à nouveau.
            </span>
          </div>
        )}

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h1 className="text-[13px] font-semibold">Contrat de prestation de services</h1>
              <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5">Référence {contractReference(contract.id)}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#D97706] text-[11px] font-semibold border border-[#FDE68A]">Outil généré par Flexwork</span>
              <a
                href={`/api/missions/${missionId}/contract/document?format=pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#0f172a] text-white text-[12px] font-semibold hover:bg-black transition"
              >
                ⬇ PDF
              </a>
            </div>
          </div>

          {/* Bloc « LE CLIENT » / « ET LE PRESTATAIRE » + préambule — en-tête du modèle de référence. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {[parties.client, parties.provider].map((party) => (
              <div key={party.heading} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5">
                <div className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase">{party.heading}</div>
                <div className="text-[13px] font-semibold text-[#0f172a] mt-1">{party.name}</div>
                <dl className="mt-2 space-y-0.5">
                  {party.lines.map((l) => (
                    <div key={l.label} className="flex gap-2 text-[11.5px]">
                      <dt className="text-[#94A3B8] shrink-0 w-[68px]">{l.label}</dt>
                      <dd className="text-[#475569] min-w-0 break-words">{l.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-[#475569] italic mb-5">{parties.preamble}</p>

          <div className="text-[13px] leading-relaxed space-y-4 mb-5">
            {sections.filter((s) => s.table || s.paragraphs.some((p) => p.trim())).map((s) => (
              <div key={s.title}>
                <h3 className="text-[#008751] font-semibold text-[13px] mb-1.5">{s.title}</h3>
                {s.paragraphs.filter((p) => p.trim()).map((p, i) => (
                  <p key={i} className="text-[#475569]">{p}</p>
                ))}
                {s.table && (
                  <div className="overflow-x-auto mt-2.5 rounded-lg border border-[#E2E8F0]">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-[#F8FAF9] text-[10px] tracking-widest text-[#64748B] uppercase">
                          {s.table.columns.map((c) => (
                            <th key={c} className="text-left font-semibold py-2 px-3 whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.table.rows.map((row, ri) => (
                          <tr key={ri} className="border-t border-[#F1F5F9]">
                            {row.map((cell, ci) => (
                              <td key={ci} className={`py-2 px-3 ${ci === 3 ? "font-semibold text-[#0f172a] whitespace-nowrap" : "text-[#475569]"}`}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                        <tr className="border-t border-[#E2E8F0] bg-[#F8FAF9]">
                          <td colSpan={s.table.columns.length - 1} className="py-2 px-3 text-[11px] font-bold tracking-widest text-[#64748B] uppercase">{s.table.totalLabel}</td>
                          <td className="py-2 px-3 font-bold text-[#008751] whitespace-nowrap">{s.table.totalValue}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C] mb-4">{error}</div>}

          {isClient && !contract.clientSignedAt && (
            <div className="border-t-2 border-[#E2E8F0] pt-4">
              <label className="flex items-start gap-2 cursor-pointer text-[13px]">
                <input
                  type="checkbox"
                  className="w-auto mt-0.5"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SignatureCard
            role="client"
            roleLabel="Client"
            party={contract.client}
            signedAt={contract.clientSignedAt}
            signatureRecord={clientSignature}
            isSelf={isClient}
            canSignNow={!!contract.providerSignedAt}
            // Ordre imposé aussi côté serveur (POST /api/signature/sign) : le prestataire
            // signe en premier, le client contre-signe en dernier.
            blockedReason={!contract.providerSignedAt ? "Le prestataire signe en premier ; le client contre-signe ensuite." : null}
            contractId={contract.id}
            onOpenSigning={() => openSigning("client")}
            buttonClass="btn-primary"
          />
          <SignatureCard
            role="freelancer"
            roleLabel="Prestataire"
            party={contract.provider}
            signedAt={contract.providerSignedAt}
            signatureRecord={providerSignature}
            isSelf={isProvider}
            canSignNow={true}
            blockedReason={null}
            contractId={contract.id}
            onOpenSigning={() => openSigning("freelancer")}
            buttonClass="btn-secondary"
          />
        </div>

        {!bothSigned && (
          <p className="text-center text-[11.5px] text-[#94A3B8]">
            Les deux signatures sont requises pour activer la mise sous séquestre du paiement.
          </p>
        )}

        {bothSigned && isClient && (
          <div className="text-center">
            <Link href={`/missions/${missionId}/escrow`} className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49]" style={{ textDecoration: "none" }}>
              Procéder au paiement sous séquestre
            </Link>
          </div>
        )}

        {/* Le paiement sous séquestre est financé par le CLIENT, jamais par le prestataire :
            le bouton « Procéder au paiement » ci-dessus est réservé au client. Le prestataire
            voit un simple statut d'attente. (Le serveur refuse déjà le HOLD côté prestataire —
            POST /api/missions/[id]/escrow/hold vérifie contract.clientId — c'était un défaut
            d'affichage seul.) */}
        {bothSigned && isProvider && (
          <p className="text-center text-[11.5px] text-[#64748B]">
            Les deux signatures sont en place. Le client procède maintenant à la mise sous séquestre du paiement.
          </p>
        )}

        {signingRole && (
          <SignContractModal
            contractId={contract.id}
            role={signingRole}
            signerName={fullName ?? (signingRole === "client" ? "Client" : "Prestataire")}
            signerEmail={session?.user?.email ?? ""}
            // Ne ferme pas la modale : elle affiche elle-même l'écran "done" (QR code de
            // signature, étape 7) après une signature réussie — se fermer ici l'aurait
            // masqué immédiatement, avant que l'utilisateur n'ait pu le voir. La modale se
            // ferme via son propre bouton "Fermer" (onClose). On se contente de rafraîchir
            // les données du contrat en arrière-plan. À la fermeture, handleCloseSigning
            // redirige automatiquement le client vers le séquestre après sa 2ᵉ signature
            // (recommandation #2 — voir sa définition plus haut).
            onClose={handleCloseSigning}
            // Marque la signature client (2/2) pour l'avancement automatique, puis
            // rafraîchit le contrat (les deux signatures apparaissent derrière la modale).
            onSigned={() => {
              if (signingRole === "client") setClientJustSigned(true);
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}
