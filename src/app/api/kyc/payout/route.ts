import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordVerificationHistory } from "@/lib/verification-history";
import { KYC_DOC_TYPES } from "@/lib/kyc-status";
import {
  MOBILE_MONEY_OPERATOR_VALUES,
  PAYOUT_STATUS_LABELS,
  isValidMobileMoneyNumber,
  isPayoutReady,
} from "@/lib/mobile-money";

export const dynamic = "force-dynamic";

// KYC financier — compte de versement Mobile Money (2026-09-23).
//
// ── Pourquoi une route séparée de /api/kyc/upload ───────────────────────────────────────
//
// `/api/kyc/upload` refuse toute resoumission une fois l'identité vérifiée
// (`kyc_already_verified`) — garde légitime : on ne réinjecte pas des documents d'identité
// après validation. Mais c'est précisément l'état d'un prestataire au moment où il veut être
// payé. Le dossier financier a donc son propre point d'entrée et son propre statut, sans
// affaiblir la garde du dossier d'identité.
//
// ── Ce qui est exigé, et pourquoi ───────────────────────────────────────────────────────
//
//   - les documents d'identité sont déjà là. Le dossier financier ne les redemande pas : il
//     les RÉFÉRENCE. Redemander une pièce d'identité déjà en base serait une saisie de
//     confort qui n'apprend rien à l'instruction ;
//   - un justificatif de domicile. Un versement Mobile Money se contrôle (titulaire du
//     compte, adresse déclarée) — c'est la seule pièce propre au dossier financier ;
//   - un numéro dans un format plausible. Le contrôle fin reste celui de l'opérateur, mais
//     un numéro manifestement tronqué ne doit pas partir en file d'instruction.
//
// Elle n'ACCORDE rien : elle enregistre un dossier que l'Admin KYC instruira, comme pour le
// badge. Une plateforme qui s'auto-validerait ses coordonnées bancaires ne contrôlerait rien.

const payoutSchema = z.object({
  operator: z.enum(MOBILE_MONEY_OPERATOR_VALUES),
  // Saisi tel quel (espaces et tirets acceptés) et stocké tel quel : c'est le numéro que
  // l'opérateur reconnaîtra. Le normaliser risquerait de casser un préfixe local.
  number: z
    .string()
    .min(8)
    .max(25)
    .refine(isValidMobileMoneyNumber, "mobile_money_number_invalid"),
  // Le titulaire est SAISI, jamais déduit du compte : un prestataire peut être payé sur un
  // compte tiers, et c'est à l'Admin KYC de le voir.
  holder: z.string().min(2).max(120),
  addressProofDocId: z.string().min(1),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const [account, identityDocs, addressProof] = await Promise.all([
    prisma.payoutAccount.findUnique({ where: { userId } }),
    prisma.kycDocument.findMany({
      where: { userId, type: { in: [...KYC_DOC_TYPES] } },
      select: { type: true },
      distinct: ["type"],
    }),
    prisma.kycDocument.findFirst({
      where: { userId, type: "justificatif_domicile" },
      orderBy: { createdAt: "desc" },
      select: { id: true, filePath: true, status: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    status: account?.status ?? "non_renseigne",
    statusLabel: PAYOUT_STATUS_LABELS[account?.status ?? "non_renseigne"],
    operator: account?.operator ?? null,
    number: account?.number ?? null,
    holder: account?.holder ?? null,
    submittedAt: account?.submittedAt ?? null,
    reviewedAt: account?.reviewedAt ?? null,
    refusalReason: account?.refusalReason ?? null,
    // L'écran a besoin de savoir si le dossier est INSTRUCTABLE avant de laisser envoyer :
    // découvrir un refus après coup, pour une pièce manquante, serait une perte de temps.
    identityReady: identityDocs.length >= KYC_DOC_TYPES.length,
    identityDocsCount: identityDocs.length,
    identityDocsExpected: KYC_DOC_TYPES.length,
    addressProof: addressProof ? { id: addressProof.id, status: addressProof.status } : null,
    ready: isPayoutReady(account?.status),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = payoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Le justificatif est vérifié comme APPARTENANT à l'utilisateur et étant du bon type : un
  // identifiant de document accepté sans contrôle permettrait d'attacher le justificatif
  // d'autrui à son propre dossier.
  const proof = await prisma.kycDocument.findFirst({
    where: { id: parsed.data.addressProofDocId, userId, type: "justificatif_domicile" },
    select: { id: true },
  });
  if (!proof) {
    return NextResponse.json(
      { error: "address_proof_required", message: "Téléversez d'abord un justificatif de domicile." },
      { status: 400 },
    );
  }

  const identityCount = await prisma.kycDocument.groupBy({
    by: ["type"],
    where: { userId, type: { in: [...KYC_DOC_TYPES] } },
  });
  if (identityCount.length < KYC_DOC_TYPES.length) {
    return NextResponse.json(
      {
        error: "identity_required",
        message:
          "Complétez d'abord votre vérification d'identité : le dossier financier la référence, il ne la remplace pas.",
        href: "/kyc",
      },
      { status: 409 },
    );
  }

  // Toute soumission repasse le dossier en instruction, y compris sur un compte DÉJÀ vérifié
  // qui change de numéro : une validation portait sur un numéro précis, elle ne vaut pas pour
  // le suivant. Conserver `verifie` après un changement de coordonnées serait exactement le
  // trou que cette route existe pour fermer.
  const account = await prisma.payoutAccount.upsert({
    where: { userId },
    create: {
      userId,
      operator: parsed.data.operator,
      number: parsed.data.number.trim(),
      holder: parsed.data.holder.trim(),
      addressProofDocId: proof.id,
      status: "en_attente",
    },
    update: {
      operator: parsed.data.operator,
      number: parsed.data.number.trim(),
      holder: parsed.data.holder.trim(),
      addressProofDocId: proof.id,
      status: "en_attente",
      submittedAt: new Date(),
      reviewedById: null,
      reviewedAt: null,
      refusalReason: null,
    },
    select: { id: true, status: true, submittedAt: true },
  });

  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: "payout:submitted",
  });

  return NextResponse.json(account, { status: 201 });
}
