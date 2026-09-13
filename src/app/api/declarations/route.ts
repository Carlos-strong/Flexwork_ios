import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { declarationSchema } from "@/lib/validation";
import { computeChainedHash } from "@/lib/hash-chain";
import { saveDeclarationDocument } from "@/lib/storage";
import { recordVerificationHistory } from "@/lib/verification-history";

// Formulations imposées par modele-skillafrica-v3-Flexwork.md §4.3/§5 — jamais "vérifié"/
// "certifié" côté plateforme, toujours "déclaré par le prestataire".
const DECLARATION_TEXT_TEMPLATES: Record<"insurance" | "qualification", (data: Record<string, unknown>) => string> = {
  insurance: (d) =>
    `Je déclare détenir une assurance de responsabilité civile professionnelle valide, ` +
    `souscrite auprès de ${d.insurerName ?? "[assureur]"} sous le numéro de police ` +
    `${d.policyNumber ?? "[numéro]"}, d'un plafond de ${d.coverageCeiling ?? "[montant]"}, ` +
    `valable jusqu'au ${d.validUntil ?? "[date]"}. Je garantis le client et Flexwork contre ` +
    `toute conséquence d'une déclaration inexacte ou d'un défaut de couverture.`,
  qualification: (d) =>
    `Je déclare détenir la qualification "${d.label ?? "[intitulé]"}". Je garantis l'exactitude ` +
    `et l'authenticité de cette déclaration et du document joint.`,
};

// US-301/302 (Phase 3) : déclaration professionnelle append-only, chaînée par hash — jamais
// de UPDATE/DELETE, une correction crée une nouvelle déclaration. Document optionnel joint
// (multipart) pour une qualification.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // { where: { userId } } n'est pas une clé unique valide depuis le passage multi-profils
  // (@@unique([userId, label]), pas userId seul) — voir le correctif détaillé dans
  // src/app/api/profile/route.ts. findFirst() n'exige pas de contrainte unique.
  const profile = await prisma.profile.findFirst({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "profile_required" }, { status: 409 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let payload: Record<string, unknown>;
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    payload = Object.fromEntries(formData.entries());
    const maybeFile = formData.get("file");
    file = maybeFile instanceof File ? maybeFile : null;
    if (payload.coverageCeiling) payload.coverageCeiling = Number(payload.coverageCeiling);
  } else {
    payload = (await req.json().catch(() => null)) ?? {};
  }

  const parsed = declarationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const declarationTextSnapshot = DECLARATION_TEXT_TEMPLATES[parsed.data.declarationType](parsed.data);

  const last = await prisma.professionalDeclaration.findFirst({
    where: { profileId: profile.id },
    orderBy: { declaredAt: "desc" },
  });
  const chainPayload = { profileId: profile.id, declarationTextSnapshot, declarationType: parsed.data.declarationType };
  const currentHash = computeChainedHash(last?.currentHash ?? null, chainPayload);

  const declaration = await prisma.professionalDeclaration.create({
    data: {
      profileId: profile.id,
      declarationType: parsed.data.declarationType,
      label: parsed.data.label,
      insurerName: parsed.data.insurerName,
      policyNumber: parsed.data.policyNumber,
      coverageCeiling: parsed.data.coverageCeiling,
      validUntil: parsed.data.validUntil ? new Date(parsed.data.validUntil) : null,
      declarationTextSnapshot,
      ipAddress: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
      previousHash: last?.currentHash ?? null,
      currentHash,
    },
  });

  if (file) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = await saveDeclarationDocument({ profileId: profile.id, fileName: file.name, buffer });
    await prisma.declarationDocument.create({
      data: { declarationId: declaration.id, filePath, fileName: file.name },
    });
  }

  await recordVerificationHistory({
    subjectType: "declaration",
    subjectId: profile.id,
    event: `declared:${parsed.data.declarationType}`,
  });

  return NextResponse.json(declaration);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get("profileId");
  if (!profileId) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  // Consultables par tout utilisateur authentifié — une déclaration est par nature publique
  // (modele-skillafrica-v3-Flexwork.md §5 : "rendre le document consultable n'est pas le
  // certifier"), on n'affiche que la déclaration la plus récente par type.
  const declarations = await prisma.professionalDeclaration.findMany({
    where: { profileId, removedAt: null },
    include: { documents: true },
    orderBy: { declaredAt: "desc" },
  });

  const latestByType = new Map<string, (typeof declarations)[number]>();
  for (const d of declarations) {
    if (!latestByType.has(d.declarationType)) latestByType.set(d.declarationType, d);
  }

  return NextResponse.json({ items: Array.from(latestByType.values()) });
}
