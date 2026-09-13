"use client";

/**
 * SignContractModal — Modale de signature électronique.
 *
 * Flux :
 *   1. Charge les certificats de l'utilisateur
 *   2. Si aucun certificat ACTIVE → propose d'en générer un (passphrase ≥ 8 car.)
 *   3. Si certificat ACTIVE → demande la passphrase pour signer
 *   4. Appelle POST /api/signature/sign
 *   5. Affiche le QR code de confirmation
 */

import { useEffect, useState } from "react";
import { X, Shield, Key, Loader2, CheckCircle } from "lucide-react";
import { SignatureQRCode } from "@/components/signature-qrcode";

type Certificate = {
  id: string;
  commonName: string;
  email: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  keyFingerprint: string;
  validUntil: string;
};

interface SignContractModalProps {
  contractId: string;
  signerName: string;
  signerEmail: string;
  role: "client" | "freelancer";
  onClose: () => void;
  onSigned: () => void;
  // Modèle Gig (recommandation #3) : endpoint et clé du corps JSON peuvent différer
  // (commande Gig → POST /api/gigs/orders/[orderId]/sign, clé "orderId"). Défauts = modèle
  // Mission inchangé.
  signUrl?: string;
  bodyIdKey?: string;
}

type Step = "loading" | "no_cert" | "sign" | "done" | "error";

export function SignContractModal({
  contractId,
  signerName,
  signerEmail,
  role,
  onClose,
  onSigned,
  signUrl = "/api/signature/sign",
  bodyIdKey = "contractId",
}: SignContractModalProps) {
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [activeCert, setActiveCert] = useState<Certificate | null>(null);

  // Formulaire génération certificat
  const [commonName, setCommonName] = useState(signerName);
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  // Formulaire signature
  const [signPassphrase, setSignPassphrase] = useState("");

  // Résultat — données réelles renvoyées par POST /api/signature/sign, jamais recalculées
  // ni simulées côté client (voir signature-qrcode.tsx).
  const [submitting, setSubmitting] = useState(false);
  const [signResult, setSignResult] = useState<{
    signatureId: string;
    signedAt: string;
    keyFingerprint: string;
    signedDataHash: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/signature/certificate")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const certs = json.data as Certificate[];
          setCertificates(certs);
          const active = certs.find((c) => c.status === "ACTIVE") ?? null;
          setActiveCert(active);
          setStep(active ? "sign" : "no_cert");
        } else {
          setError(json.error ?? "Impossible de charger vos certificats");
          setStep("error");
        }
      })
      .catch(() => {
        setError("Impossible de charger vos certificats");
        setStep("error");
      });
  }, []);

  async function handleCreateCertificate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassphrase.length < 8) {
      setError("La passphrase doit contenir au moins 8 caractères.");
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setError("Les deux passphrases ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/signature/certificate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commonName, email: signerEmail, passphrase: newPassphrase }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setError(json.error ?? "Échec de la génération du certificat");
      setSubmitting(false);
      setStep("no_cert");
      return;
    }
    const newCert = json.data as Certificate;
    setCertificates((prev) => [newCert, ...prev]);
    setActiveCert(newCert);
    // Signer directement avec la passphrase déjà saisie
    await doSign(newCert.id, newPassphrase);
  }

  async function handleSignWithExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCert) return;
    await doSign(activeCert.id, signPassphrase);
  }

  async function doSign(certificateId: string, passphrase: string) {
    setError(null);
    setSubmitting(true);
    const res = await fetch(signUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [bodyIdKey]: contractId, certificateId, passphrase }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setError(json.error ?? "Échec de la signature");
      setSubmitting(false);
      setStep(activeCert ? "sign" : "no_cert");
      return;
    }
    setSubmitting(false);
    setSignResult({
      signatureId: json.signatureId,
      signedAt: json.signedAt,
      keyFingerprint: json.keyFingerprint,
      signedDataHash: json.signedDataHash,
    });
    setStep("done");
    onSigned();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {step === "done" ? "Contrat signé" : "Signature électronique"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {step === "loading" && (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm text-gray-500">Chargement de vos certificats...</p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                <X className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm text-red-600 text-center">{error}</p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          )}

          {step === "no_cert" && (
            <form onSubmit={handleCreateCertificate} className="space-y-4">
              <p className="text-sm text-gray-600">
                Vous devez d&apos;abord générer un certificat numérique pour signer vos contrats.
                Choisissez une passphrase qui vous sera demandée à chaque signature.
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nom complet</label>
                <input
                  type="text"
                  value={commonName}
                  onChange={(e) => setCommonName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Passphrase</label>
                <input
                  type="password"
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Minimum 8 caractères"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Confirmer la passphrase</label>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Répéter la passphrase"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Générer le certificat et signer
              </button>
            </form>
          )}

          {step === "sign" && activeCert && (
            <form onSubmit={handleSignWithExisting} className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                <p className="font-medium">{activeCert.commonName}</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Certificat actif — Empreinte : {activeCert.keyFingerprint.slice(0, 20)}...
                </p>
                <p className="text-xs text-blue-500 mt-0.5">
                  Valide jusqu&apos;au {new Date(activeCert.validUntil).toLocaleDateString("fr-FR")}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Votre passphrase de signature
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    value={signPassphrase}
                    onChange={(e) => setSignPassphrase(e.target.value)}
                    required
                    placeholder="Saisissez votre passphrase"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={submitting || !signPassphrase}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Signer le contrat
              </button>
            </form>
          )}

          {submitting && step !== "no_cert" && step !== "sign" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <p className="text-sm text-gray-500">Signature en cours...</p>
            </div>
          )}

          {step === "done" && signResult && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <span className="text-sm font-semibold">Signature enregistrée</span>
              </div>

              <SignatureQRCode
                contractId={contractId}
                signatureId={signResult.signatureId}
                role={role}
                signerName={signerName}
                signedAt={signResult.signedAt}
                keyFingerprint={signResult.keyFingerprint}
                signedDataHash={signResult.signedDataHash}
                size={120}
              />

              <p className="text-xs text-gray-500 text-center">
                Ce QR code contient les informations vérifiables de votre signature.
                Conservez-le comme preuve d&apos;engagement.
              </p>

              <button
                onClick={onClose}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
