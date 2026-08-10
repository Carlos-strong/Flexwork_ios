"use client";

/**
 * SignatureQRCode — Représentation visuelle d'une signature électronique.
 *
 * Encode les données RÉELLES de la signature RSA-SHA256 renvoyées par
 * POST /api/signature/sign (src/lib/signature.ts, SignatureService.signContract) :
 * signatureId, empreinte du certificat et hash SHA-256 du contenu signé. Aucune valeur
 * n'est calculée ni simulée ici — auparavant ce composant fabriquait un faux
 * certificateId (`Date.now()`) et un faux hash (`simpleHash`, un simple hash de chaîne,
 * pas SHA-256 malgré le libellé "SHA256:" affiché) sans lien avec la signature réelle
 * enregistrée dans `ContractSignature` : un QR "vérifiable" qui ne vérifiait rien.
 * Vérification réelle possible via POST /api/signature/verify avec (contractId, signatureId).
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface SignatureQRCodeProps {
  contractId: string;
  signatureId: string;
  role: "client" | "freelancer";
  signerName: string;
  signedAt: string; // ISO 8601
  keyFingerprint: string;
  signedDataHash: string;
  size?: number;
}

export function SignatureQRCode({
  contractId,
  signatureId,
  role,
  signerName,
  signedAt,
  keyFingerprint,
  signedDataHash,
  size = 120,
}: SignatureQRCodeProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const roleLabel = role === "client" ? "CLIENT" : "PRESTATAIRE";

  useEffect(() => {
    const qrPayload = JSON.stringify({
      v: 1,
      cid: contractId,
      sid: signatureId,
      role: roleLabel,
      signer: signerName,
      ts: signedAt,
      fingerprint: keyFingerprint,
      hash: signedDataHash,
      method: "RSA-SHA256",
      verify: "/api/signature/verify",
    });

    QRCode.toDataURL(qrPayload, {
      width: size * 2,
      margin: 1,
      color: { dark: "#14213D", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(null));
  }, [contractId, signatureId, roleLabel, signerName, signedAt, keyFingerprint, signedDataHash, size]);

  if (!qrDataUrl) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* QR Code */}
      <div className="bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
        <img
          src={qrDataUrl}
          alt="QR Code de signature"
          width={size}
          height={size}
          className="block"
        />
      </div>

      {/* Infos compactes sous le QR — empreinte réelle du certificat + hash signé */}
      <div className="text-center">
        <p className="text-[10px] text-gray-500 font-mono leading-tight break-all max-w-[160px]">
          {signedDataHash.slice(0, 16)}...
        </p>
        <p className="text-[9px] text-gray-400 font-mono leading-tight mt-0.5 break-all max-w-[160px]">
          {keyFingerprint.slice(0, 24)}
        </p>
      </div>

      {/* Badge de vérification */}
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold rounded-full">
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
        </svg>
        Signature vérifiable
      </span>
    </div>
  );
}
