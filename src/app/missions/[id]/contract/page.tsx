"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FileText, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { SignContractModal } from "@/components/sign-contract-modal";
import { SignatureQRCode } from "@/components/signature-qrcode";
import { ATTENDANCE_VALIDATION_LABEL, RATE_UNIT_LABEL } from "@/lib/spot-time";
import { Avatar } from "@/components/avatar";
import { CONTRACT_STEPS, stepIndexFor } from "@/lib/contract-stepper";
import { isMissionFundingClosed } from "@/lib/mission-status";
import { buildContractSections, buildContractParties, contractReference } from "@/lib/contract-clauses";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { initials } from "@/lib/initials";
import { personFullName } from "@/lib/person-name";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";

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
    family: string;
    rateUnit: "hour" | "day" | "month" | null;
  } | null;
  // Conditions EXACTES qu'un contrat au temps figera (même fonction que la génération).
  timeTerms: {
    rateUnit: "hour" | "day" | "week" | "month";
    rate: number;
    maxQuantity: number;
    maxAmount: number;
    attendanceValidation?: "totale" | "partielle";
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
              ? "bg-[#4C1D95] text-white border-[#4C1D95]"
              : i === stepIndex
                ? "bg-[#191224] text-white border-[#191224]"
                : "bg-[#F6F5FA] text-[#9A93A8] border-[#E7E2F0]"
          }`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function fullNameOf(p: ContractParty | undefined): string | null {
  const n = personFullName(p);
  return n || null;
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
}) {
  // Bloc de la colonne « Signatures » (maquette 2026-11-12) : rôle, état, puis le bouton de
  // signature (soi) ou le QR vérifiable (signé).
  return (
    <div className="rounded-2xl bg-[#EFEAF8] p-4">
      <div className="flex items-center gap-2.5">
        <Avatar src={party.avatarPath ? `/api/users/${party.id}/avatar` : null} initials={initials(party.firstname, party.lastname)} size={32} />
        <div className="min-w-0">
          <div className="text-[13px] text-[#4A4258]">{roleLabel}</div>
          <div className="text-[12px] text-[#6B6478] truncate">{fullNameOf(party) ?? roleLabel}</div>
        </div>
      </div>
      <p className={`mt-2 font-display font-bold text-[17px] ${signedAt ? "text-[#047857]" : "text-[#191224]"}`}>
        {signedAt ? `Signé le ${new Date(signedAt).toLocaleDateString("fr-FR")}` : "En attente"}
      </p>

      {signedAt && signatureRecord ? (
        <div className="mt-3 rounded-xl bg-white p-3 text-center">
          <SignatureQRCode
            contractId={contractId}
            signatureId={signatureRecord.signatureId}
            role={role}
            signerName={signatureRecord.signerName}
            signedAt={signatureRecord.signedAt}
            keyFingerprint={signatureRecord.keyFingerprint}
            signedDataHash={signatureRecord.signedDataHash}
            size={96}
          />
          <p className="mt-2 text-[11px] text-[#6B6478]">
            Signature vérifiable · {new Date(signedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ) : signedAt ? (
        // Signé, mais le détail cryptographique (POST /api/signature/verify) n'est pas
        // encore revenu — évite un QR vide plutôt que d'en fabriquer un.
        <p className="mt-1 text-[12px] text-[#047857]">✓ Signature enregistrée</p>
      ) : isSelf ? (
        <>
          <button
            disabled={!canSignNow}
            onClick={onOpenSigning}
            className="mt-3 w-full py-2.5 rounded-full bg-[#4C1D95] text-white text-[14px] font-bold hover:bg-[#3B1578] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Signer en tant que {roleLabel}
          </button>
          {blockedReason && <p className="mt-2 text-[11.5px] text-[#6B6478] text-center">{blockedReason}</p>}
        </>
      ) : (
        <p className="mt-1 text-[12px] text-[#6B6478]">{role === "client" ? "Le client contre-signe après le prestataire." : "Le prestataire signe en premier."}</p>
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
  const userRole = (session?.user as { role?: string } | undefined)?.role;
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
  // Acceptation des termes (2026-11-10) : le bouton « Signer » de chaque partie reste inactif
  // tant qu'elle n'a pas coché « J'ai lu et j'accepte les termes du contrat ».
  const [termsAccepted, setTermsAccepted] = useState(false);
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
  // Prestataire qui vient de signer (1/2) : « Terminer » le ramène à son tableau de bord, en
  // attendant la contre-signature du client (2026-11-10).
  const [providerJustSigned, setProviderJustSigned] = useState(false);

  // Mémoïsée car `load` l'appelle : sans ça, `load` ne pourrait pas déclarer ses dépendances
  // sans être recréée à chaque rendu, et l'effet de montage partirait en boucle.
  const loadSignatures = useCallback(async (contractId: string) => {
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
  }, []);

  const load = useCallback(async () => {
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
  }, [missionId, loadSignatures]);

  useEffect(() => {
    load();
    fetchDedupe(`/api/missions/${missionId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setMissionStatus(d.status)).catch(() => {});
    fetchDedupe(`/api/missions/${missionId}/financing-mode`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFinancing(d))
      .catch(() => {});
  }, [missionId, load]);

  // Client en attente de la signature du prestataire (2026-11-10) : la page se met à jour
  // d'elle-même quand il signe, au lieu d'exiger un rechargement pour voir le bouton se
  // débloquer. Rafraîchissement léger, seulement onglet visible et seulement pendant l'attente.
  const waitingForProvider =
    !!contract && contract !== "none" && !contract.providerSignedAt && !!userId && userId === contract.clientId;
  useEffect(() => {
    if (!waitingForProvider) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [waitingForProvider, load]);

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
            : data.error === "time_terms_missing"
              ? "Cette mission au temps n'a pas de quantité maximale : corrigez son mode de financement avant de générer le contrat."
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
    if (!termsAccepted) {
      setError("Vous devez accepter les termes du contrat avant de signer.");
      return;
    }
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

  if (contract === null) return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement...</div>;

  const stepIndex = stepIndexFor(contract, missionStatus);

  if (contract === "none") {
    return (
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
        <div className="fluid-doc [--fw:800px] mx-auto px-4 lg:px-0 py-5">
          <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap mb-4">
            <Link href={`/missions/${missionId}`} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Mission</Link>
            <span>›</span>
            <span className="text-[#191224] font-medium">Contrat</span>
          </div>

          <Stepper stepIndex={stepIndex} />
          <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
            <h1 className="text-[13px] font-semibold mb-3">Contrat de prestation</h1>
            <p className="text-[13px] text-[#6B6478] mb-4">Aucun contrat généré pour cette mission — une proposition doit d&apos;abord être acceptée.</p>
            {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318] mb-4">{error}</div>}

            {/* Mode choisi à la publication : rien à saisir. Le découpage affiché ici est
                EXACTEMENT celui que le serveur créera (même fonction de dérivation), pas une
                estimation — le client valide ce qu'il voit. */}
            {derivedFinancing && (
              <div className="border-t border-[#EFEAF8] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[13px]">Financement — {derivedFinancing.mode!.label}</strong>
                  <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[#F0EAFF] text-[#4C1D95]">
                    Choisi à la publication
                  </span>
                </div>
                <p className="text-[12.5px] text-[#6B6478] mt-1 leading-relaxed">{derivedFinancing.mode!.definition}</p>

                {derivedFinancing.preview && derivedFinancing.preview.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-[#E7E2F0] overflow-hidden">
                    {derivedFinancing.preview.map((j, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] border-b border-[#EFEAF8] last:border-b-0"
                      >
                        <span className="text-[#6B6478] shrink-0">#{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[#191224]">{j.titre}</span>
                        <strong className="text-[#047857] shrink-0">{j.montant.toLocaleString("fr-FR")}</strong>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 text-[12.5px] bg-[#F6F5FA]">
                      <span className="font-semibold">Total</span>
                      <strong>{derivedFinancing.preview.reduce((s, j) => s + j.montant, 0).toLocaleString("fr-FR")}</strong>
                    </div>
                  </div>
                ) : derivedFinancing.timeTerms ? (
                  <div className="mt-3 rounded-lg border border-[#E7E2F0] overflow-hidden text-[12.5px]">
                    {[
                      ["Tarif", `${derivedFinancing.timeTerms.rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} / ${RATE_UNIT_LABEL[derivedFinancing.timeTerms.rateUnit].one}`],
                      ["Quantité maximale", `${derivedFinancing.timeTerms.maxQuantity.toLocaleString("fr-FR")} ${RATE_UNIT_LABEL[derivedFinancing.timeTerms.rateUnit].many}`],
                      ["Mode de pointage", ATTENDANCE_VALIDATION_LABEL[derivedFinancing.timeTerms.attendanceValidation ?? "partielle"].label],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#EFEAF8]">
                        <span className="text-[#6B6478]">{k}</span>
                        <strong className="tabular-nums">{v}</strong>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-[#F6F5FA]">
                      <span className="font-semibold">Plafond séquestré</span>
                      <strong className="text-[#047857] tabular-nums">{derivedFinancing.timeTerms.maxAmount.toLocaleString("fr-FR")}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg bg-[#F6F5FA] border border-[#E7E2F0] px-3 py-2.5 text-[12px] text-[#6B6478]">
                    Paiement unique sur le prix total du contrat — aucun fractionnement.
                  </div>
                )}

                <div className="mt-3 rounded-lg bg-[#F6F5FA] border border-[#E7E2F0] px-3 py-2.5 text-[12px] text-[#6B6478]">
                  <span className="font-semibold text-[#191224]">Avec ce mode : </span>
                  {derivedFinancing.mode!.family === "temps" ? (
                    <>
                      le plafond sera séquestré une seule fois avant le démarrage ; chaque relevé de présence que vous
                      constaterez en libérera la part, et le solde non consommé vous sera restitué à la clôture du chantier.
                    </>
                  ) : derivedFinancing.mode!.usesJalons ? (
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
              <div className="border-t border-[#EFEAF8] pt-3">
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
                          className="flex-[2] h-9 px-2.5 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                        />
                        <input
                          type="number"
                          placeholder="Montant"
                          value={row.montant}
                          onChange={(e) => setJalonRows((rows) => rows.map((r, j) => (j === i ? { ...r, montant: e.target.value } : r)))}
                          className="flex-1 h-9 px-2.5 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
                        />
                        {jalonRows.length > 2 && (
                          <button type="button" onClick={() => setJalonRows((rows) => rows.filter((_, j) => j !== i))} className="h-9 px-3 rounded-lg border border-[#E7E2F0] bg-white text-[13px] hover:bg-[#F6F5FA]">×</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setJalonRows((rows) => [...rows, { titre: "", montant: "" }])} className="h-8 px-3 rounded-md border border-[#E7E2F0] bg-white text-[11px] font-medium hover:bg-[#EFEAF8]">
                      + Ajouter un jalon
                    </button>
                    <p className={`text-[12.5px] mt-1 ${Math.abs(jalonsTotal - acceptedMontant) < 0.01 ? "text-[#047857]" : "text-[#B42318]"}`}>
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
                <div className="mt-3 rounded-lg bg-[#F6F5FA] border border-[#E7E2F0] px-3 py-2.5 text-[12px] text-[#6B6478]">
                  <span className="font-semibold text-[#191224]">Avec ces choix : </span>
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

            <button onClick={generateContract} disabled={!derivedFinancing && useJalons && !jalonsValid} className="mt-4 h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] transition-colors disabled:opacity-50">
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
  // Bloc « Avant de signer » : la partie connectée n'a pas encore signé.
  const mySignPending = (isClient && !contract.clientSignedAt) || (isProvider && !contract.providerSignedAt);
  const readyToSign = termsAccepted && (!isClient || consent);
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
    const backToDashboard = providerJustSigned && isProvider && !(contract && contract !== "none" && contract.clientSignedAt);
    setClientJustSigned(false);
    setProviderJustSigned(false);
    setSigningRole(null);
    if (advanceToEscrow) router.push(`/missions/${missionId}/escrow`);
    else if (backToDashboard) router.push(ROLE_DASHBOARD[userRole ?? ""] ?? "/dashboard");
  }

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-doc [--fw:1200px] mx-auto px-4 lg:px-6 py-5 space-y-4">
        <div className="flex items-center gap-1.5 text-[12px] text-[#6B6478] flex-wrap">
          <Link href={`/missions/${missionId}`} className="hover:text-[#191224]" style={{ textDecoration: "none" }}>Mission</Link>
          <span>›</span>
          <span className="text-[#191224] font-medium">Contrat</span>
        </div>

        <Stepper stepIndex={stepIndex} />

        {noInsurance && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3.5 text-[13px] text-[#B42318] leading-relaxed">
            <strong>⚠️ Avertissement :</strong> Ce prestataire n&apos;a déclaré <strong>aucune assurance</strong> de
            responsabilité civile professionnelle. En cas de dommage pendant les travaux, aucune indemnisation par une
            assurance ne sera possible.
          </div>
        )}

        {/* Le prestataire signe en premier (imposé par POST /api/signature/sign) : tant qu'il ne
            l'a pas fait, le client le voit d'emblée — sa case de consentement ne pouvait rien
            déclencher, sans que rien ne dise pourquoi (2026-11-10). */}
        {isClient && !contract.providerSignedAt && (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-[#BFDBFE] bg-[#EAF1FF] p-4">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[16px]">
              ✍️
            </span>
            <div className="min-w-0 text-[13px] leading-relaxed">
              <p className="font-semibold text-[#191224]">Étape 1/2 — en attente de la signature du prestataire.</p>
              <p className="text-[#4A4258]">
                Le prestataire signe en premier ; il a été notifié. Vous pourrez contre-signer dès sa signature : vous serez
                prévenu et cette page se mettra à jour d&apos;elle-même.
              </p>
            </div>
          </div>
        )}

        {contract.providerSignedAt && !contract.clientSignedAt && (
          <div className="rounded-xl border border-[#FDE68A] bg-[#FFF6E3] p-3.5 text-[13px] text-[#92400E] leading-relaxed flex items-start gap-2">
            <span className="shrink-0">⏳</span>
            <span>
              <strong>Signature du prestataire reçue.</strong> Le client dispose de 48&nbsp;h pour contre-signer ;
              passé ce délai, le contrat sera annulé sans pénalité et le prestataire devra signer à nouveau.
            </span>
          </div>
        )}

        {/* Maquette « Contrat client & prestataire » (2026-11-12) : le document à gauche, la
            colonne « Signatures » à droite. Contenu du contrat (parties, articles, tableau des
            jalons) et logique de signature inchangés. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px] items-start">
          <article className="min-w-0 rounded-3xl border border-[#E7E2F0] bg-white overflow-hidden">
            <header className="flex items-start justify-between gap-3 border-b border-[#E7E2F0] px-5 py-5 lg:px-7">
              <div className="min-w-0">
                <p className="kicker">Contrat de prestation — Flexwork</p>
                <h1 className="font-display font-extrabold text-[#191224] leading-tight mt-1" style={{ fontSize: "clamp(22px, 2.6vw, 28px)" }}>
                  Contrat client &amp; prestataire
                </h1>
                <p className="mt-1 text-[12px] text-[#9A93A8] font-mono">Référence {contractReference(contract.id)}</p>
              </div>
              <a
                href={`/api/missions/${missionId}/contract/document?format=pdf`}
                target="_blank"
                rel="noreferrer"
                title="Télécharger le contrat (PDF)"
                aria-label="Télécharger le contrat (PDF)"
                className="shrink-0 grid place-items-center w-10 h-10 rounded-xl text-[#4C1D95] hover:bg-[#F0EAFF] transition"
              >
                <FileText className="w-6 h-6" aria-hidden />
              </a>
            </header>

            <div className="px-5 py-6 lg:px-7 space-y-6 text-[14px] leading-relaxed text-[#191224]">
              {/* Parties — en-tête du modèle de référence. */}
              <section>
                <h2 className="font-bold text-[15px] mb-2">Parties</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[parties.client, parties.provider].map((party) => (
                    <div key={party.heading} className="rounded-2xl bg-[#F6F5FA] p-4">
                      <div className="text-[11px] font-bold tracking-widest text-[#6B6478] uppercase">{party.heading}</div>
                      <div className="font-bold mt-1">{party.name}</div>
                      <dl className="mt-1.5 space-y-0.5">
                        {party.lines.map((l) => (
                          <div key={l.label} className="flex gap-2 text-[12.5px]">
                            <dt className="text-[#6B6478] shrink-0 w-[72px]">{l.label}</dt>
                            <dd className="min-w-0 break-words">{l.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[13px] text-[#4A4258] italic">{parties.preamble}</p>
              </section>

              {sections.filter((s) => s.table || s.paragraphs.some((p) => p.trim())).map((s) => (
                <section key={s.title}>
                  <h2 className="font-bold text-[15px] mb-1">{s.title}</h2>
                  {s.paragraphs.filter((p) => p.trim()).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  {s.table && (
                    <div className="overflow-x-auto mt-3 rounded-2xl border border-[#E7E2F0]">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="bg-[#EFEAF8] text-[11px] tracking-widest text-[#6B6478] uppercase">
                            {s.table.columns.map((c) => (
                              <th key={c} className="text-left font-semibold py-2.5 px-3 whitespace-nowrap bg-transparent">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((row, ri) => (
                            <tr key={ri} className="border-t border-[#EFEAF8] hover:bg-transparent">
                              {row.map((cell, ci) => (
                                <td key={ci} className={`py-2.5 px-3 ${ci === 3 ? "font-bold whitespace-nowrap" : ""}`}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                          <tr className="border-t border-[#E7E2F0] bg-[#F6F5FA] hover:bg-[#F6F5FA]">
                            <td colSpan={s.table.columns.length - 1} className="py-2.5 px-3 font-bold">{s.table.totalLabel}</td>
                            <td className="py-2.5 px-3 font-extrabold text-[#047857] whitespace-nowrap">{s.table.totalValue}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}

              {error && <div className="rounded-2xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318]">{error}</div>}

              {/* Acceptation — encadré du modèle. */}
              {mySignPending && (
                <div className="rounded-2xl border border-[#E7E2F0] p-4 space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer text-[14px] mb-0 font-normal">
                    <input
                      type="checkbox"
                      className="w-5 h-5 mt-0.5 shrink-0"
                      checked={termsAccepted}
                      onChange={(e) => {
                        setTermsAccepted(e.target.checked);
                        if (e.target.checked) setError(null);
                      }}
                    />
                    <span>
                      J&apos;ai lu et j&apos;accepte l&apos;ensemble des termes du présent contrat, y compris le prix, le délai,
                      les modalités de paiement sous séquestre et de règlement des litiges.
                    </span>
                  </label>
                  {isClient && (
                    <label className="flex items-start gap-3 cursor-pointer text-[14px] mb-0 font-normal">
                      <input
                        type="checkbox"
                        className="w-5 h-5 mt-0.5 shrink-0"
                        checked={consent}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setConsent(checked);
                          if (checked && noInsurance) acknowledgeNoInsurance();
                        }}
                      />
                      <span>J&apos;ai compris et je choisis ce prestataire en pleine connaissance de cause.</span>
                    </label>
                  )}
                  <p className="pl-8 text-[12.5px] text-[#6B6478]">
                    {waitingForProvider
                      ? "Le prestataire signe en premier : votre bouton de signature s'activera dès sa signature."
                      : readyToSign
                        ? "✓ Termes acceptés : signez depuis la colonne « Signatures »."
                        : isClient
                          ? "Cochez les deux cases pour activer votre bouton de signature."
                          : "Acceptez les termes du contrat pour activer votre bouton de signature."}
                  </p>
                </div>
              )}
            </div>
          </article>

          {/* Colonne « Signatures » */}
          <aside className="space-y-4 lg:sticky lg:top-20">
            <div className="rounded-3xl border border-[#E7E2F0] bg-white p-5 space-y-3">
              <h2 className="font-display font-bold text-[18px] text-[#191224]">Signatures</h2>
              <SignatureCard
                role="client"
                roleLabel="Client"
                party={contract.client}
                signedAt={contract.clientSignedAt}
                signatureRecord={clientSignature}
                isSelf={isClient}
                canSignNow={!!contract.providerSignedAt && termsAccepted && consent}
                // Ordre imposé aussi côté serveur (POST /api/signature/sign) : le prestataire
                // signe en premier, le client contre-signe en dernier.
                blockedReason={
                  !contract.providerSignedAt
                    ? "Le prestataire signe en premier ; le client contre-signe ensuite."
                    : !termsAccepted || !consent
                      ? "Acceptez d'abord les termes du contrat (ci-dessus)."
                      : null
                }
                contractId={contract.id}
                onOpenSigning={() => openSigning("client")}
              />
              <SignatureCard
                role="freelancer"
                roleLabel="Prestataire"
                party={contract.provider}
                signedAt={contract.providerSignedAt}
                signatureRecord={providerSignature}
                isSelf={isProvider}
                canSignNow={termsAccepted}
                blockedReason={termsAccepted ? null : "Acceptez d'abord les termes du contrat (ci-dessus)."}
                contractId={contract.id}
                onOpenSigning={() => openSigning("freelancer")}
              />
              <p className="text-[12px] text-[#6B6478]">
                Le prestataire signe en premier, puis le client contre-signe sous 48&nbsp;h.
              </p>

              {/* Financement : client seulement, après la double signature. Mission close ou
                  remboursée : plus rien à financer (règle partagée avec le serveur,
                  isMissionFundingClosed). */}
              {isClient && !isMissionFundingClosed(missionStatus) &&
                (bothSigned ? (
                  <Link
                    href={`/missions/${missionId}/escrow`}
                    className="flex items-center justify-center w-full py-3 rounded-full bg-[#047857] text-white text-[15px] font-bold hover:bg-[#065F46]"
                    style={{ textDecoration: "none" }}
                  >
                    Procéder au paiement sous séquestre
                  </Link>
                ) : (
                  <button type="button" disabled className="w-full py-3 rounded-full bg-[#6B6478] text-white text-[15px] font-bold opacity-80 cursor-not-allowed">
                    Aller au financement
                  </button>
                ))}

              {/* Prestataire ayant signé (1/2), en attente du client : « Terminer » le ramène à
                  son tableau de bord (la fenêtre de signature se referme). */}
              {isProvider && !!contract.providerSignedAt && !contract.clientSignedAt && (
                <div className="rounded-2xl bg-[#E7F7EF] p-3">
                  <p className="text-[13px] font-bold text-[#065F46]">✓ Vous avez signé le contrat</p>
                  <p className="mt-0.5 text-[12px] text-[#065F46]">En attente de la contre-signature du client : vous serez prévenu.</p>
                  <button
                    type="button"
                    onClick={() => router.push(ROLE_DASHBOARD[userRole ?? ""] ?? "/dashboard")}
                    className="mt-2 w-full py-2.5 rounded-full bg-[#191224] text-white text-[13px] font-bold hover:bg-black"
                  >
                    Terminer
                  </button>
                </div>
              )}

              {bothSigned && isProvider && !isMissionFundingClosed(missionStatus) && (
                <p className="text-[12.5px] text-[#6B6478]">Les deux signatures sont en place. Le client procède maintenant à la mise sous séquestre du paiement.</p>
              )}
              {bothSigned && isMissionFundingClosed(missionStatus) && (
                <p className="text-[12.5px] text-[#6B6478]">
                  {missionStatus === "remboursee"
                    ? "Mission remboursée — le séquestre a été rendu au client, aucun financement n'est attendu."
                    : "Mission close — aucun financement n'est attendu."}
                </p>
              )}
            </div>

            {!bothSigned && (
              <p className="flex items-start gap-2 rounded-2xl bg-[#FFF6E3] px-4 py-3 text-[14px] text-[#B45309]">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                Sans double signature, le financement reste bloqué.
              </p>
            )}
          </aside>
        </div>

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
            doneHint={
              signingRole === "freelancer" && !contract.clientSignedAt
                ? "Le client a été notifié et va contre-signer le contrat. Vous serez prévenu dès sa signature."
                : undefined
            }
            doneLabel={signingRole === "freelancer" && !contract.clientSignedAt ? "Terminer et revenir au tableau de bord" : "Terminer"}
            // Marque la signature client (2/2) pour l'avancement automatique, puis
            // rafraîchit le contrat (les deux signatures apparaissent derrière la modale).
            onSigned={() => {
              if (signingRole === "client") setClientJustSigned(true);
              if (signingRole === "freelancer") setProviderJustSigned(true);
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}
