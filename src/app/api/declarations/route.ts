import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { declarationSchema } from "@/lib/validation";
import { computeChainedHash } from "@/lib/hash-chain";
import { saveDeclarationDocument } from "@/lib/storage";
import { recordVerificationHistory } from "@/lib/verification-history";
import { findPrimaryProfile } from "@/lib/profile-query";

// Formulations imposées par modele-skillafrica-v3-Flexwork.md §4.3/§5 — jamais "vérifié"/
// "certifié" côté plateforme, toujours "déclaré par le prestataire".
const DECLARATION_TEXT_TEMPLATES: Record<"insurance" | "qualification" | "experience", (data: Record<string, unknown>) => string> = {
  insurance: (d) =>
    `Je déclare détenir une assurance de responsabilité civile professionnelle valide, ` +
    `souscrite auprès de ${d.insurerName ?? "[assureur]"} sous le numéro de police ` +
    `${d.policyNumber ?? "[numéro]"}, d'un plafond de ${d.coverageCeiling ?? "[montant]"}, ` +
    `valable jusqu'au ${d.validUntil ?? "[date]"}. Je garantis le client et Flexwork contre ` +
    `toute conséquence d'une déclaration inexacte ou d'un défaut de couverture.`,
  qualification: (d) => {
    // Le texte scellé énumère désormais les diplômes déclarés : c'est LUI qui est haché et
    // chaîné, donc lui qui doit porter ce qui a été affirmé. Un intitulé générique rendait la
    // chaîne inattaquable mais vide de sens.
    const diplomes = Array.isArray(d.diplomes) ? (d.diplomes as { qualificationName?: string; year?: number; institution?: string; isStateIssued?: boolean }[]) : [];
    if (diplomes.length === 0) {
      return (
        `Je déclare détenir la qualification "${d.label ?? "[intitulé]"}". Je garantis l'exactitude ` +
        `et l'authenticité de cette déclaration et du document joint.`
      );
    }
    const liste = diplomes
      .map((x) => `${x.qualificationName ?? "[intitulé]"}${x.year ? ` (${x.year})` : ""}${x.institution ? `, ${x.institution}` : ""}${x.isStateIssued ? " — diplôme d'État" : " — déclaratif"}`)
      .join(" ; ");
    return (
      `Je déclare détenir ${diplomes.length === 1 ? "la qualification suivante" : "les qualifications suivantes"} : ${liste}. ` +
      `Je garantis l'exactitude et l'authenticité de cette déclaration et des documents joints.`
    );
  },
  experience: (d) => {
    const xps = Array.isArray(d.experiences) ? (d.experiences as { role?: string; clientName?: string; startDate?: string; endDate?: string }[]) : [];
    const liste = xps
      .map((x) => `${x.role ?? "[poste]"}${x.clientName ? ` chez ${x.clientName}` : ""}${x.startDate ? ` (${x.startDate}${x.endDate ? ` → ${x.endDate}` : ""})` : ""}`)
      .join(" ; ");
    return (
      `Je déclare avoir exercé ${xps.length === 1 ? "la mission suivante" : "les missions suivantes"} : ${liste || "[aucune]"}. ` +
      `Je garantis l'exactitude de ces informations et autorise leur vérification auprès des personnes ressources indiquées.`
    );
  },
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
  // src/app/api/profile/route.ts. findPrimaryProfile trie explicitement : un findFirst sans
  // orderBy pouvait sceller une déclaration sur le profil secondaire.
  const profile = await findPrimaryProfile(userId);
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

  // Déclaration ET détail dans UNE transaction (2026-09-23) : la chaîne est append-only, une
  // déclaration scellée dont les diplômes n'auraient pas été écrits resterait là pour
  // toujours, à affirmer des qualifications introuvables. Soit tout est enregistré, soit rien.
  const declaration = await prisma.$transaction(async (tx) => {
    const declaration = await tx.professionalDeclaration.create({
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

    // ── Détail de la déclaration (2026-09-23) ──────────────────────────────────────────────
    // Jusqu'ici, `diplomes` et `experiences` étaient envoyés par /declarations puis supprimés
    // par zod, et la réponse annonçait malgré tout un enregistrement réussi. Ils sont désormais
    // persistés, rattachés à la déclaration qui les scelle.
    const diplomes = parsed.data.diplomes ?? [];
    if (diplomes.length > 0) {
      await tx.declaredDiploma.createMany({
        data: diplomes.map((d) => ({
          declarationId: declaration.id,
          qualificationName: d.qualificationName,
          year: d.year ?? null,
          location: d.location || null,
          institution: d.institution || null,
          specialty: d.specialty || null,
          isStateIssued: d.isStateIssued ?? false,
        })),
      });
    }

    const experiences = parsed.data.experiences ?? [];
    if (experiences.length > 0) {
      // Créées une à une pour récupérer leur identifiant : les personnes ressources y sont
      // rattachées, et `createMany` ne renvoie pas les lignes créées.
      //
      // `clientIdToDbId` fait le pont entre l'indice CLIENT de l'expérience (un compteur du
      // navigateur) et sa clé réelle — sans lui, on ne saurait plus qui atteste de quoi.
      const clientIdToDbId = new Map<number, string>();
      for (const [index, xp] of experiences.entries()) {
        const created = await tx.declaredExperience.create({
          data: {
            declarationId: declaration.id,
            clientType: xp.clientType ?? "INDIVIDUAL",
            clientName: xp.clientName || null,
            role: xp.role,
            domain: xp.domain || null,
            description: xp.description || null,
            startDate: xp.startDate || null,
            endDate: xp.endDate || null,
            technologies: xp.technologies || null,
            projectUrl: xp.projectUrl || null,
            livrables: xp.livrables || null,
          },
        });
        clientIdToDbId.set(xp.id ?? index + 1, created.id);
      }

      const references = parsed.data.references ?? [];
      const resolues = references
        .map((r) => ({ ref: r, experienceId: r.experienceId ? clientIdToDbId.get(r.experienceId) : undefined }))
        // Une référence dont l'expérience n'a pas été envoyée n'est rattachable à rien : on la
        // laisse tomber plutôt que de l'accrocher arbitrairement à la première.
        .filter((x): x is { ref: (typeof references)[number]; experienceId: string } => Boolean(x.experienceId));
      if (resolues.length > 0) {
        await tx.declaredReference.createMany({
          data: resolues.map(({ ref, experienceId }) => ({
            experienceId,
            kind: ref.kind ?? "primary",
            nom: ref.nom,
            prenom: ref.prenom || null,
            tel: ref.tel || null,
            email: ref.email || null,
            lien: ref.lien || null,
          })),
        });
      }
    }

    return declaration;
  });

  // Le fichier est écrit APRÈS la transaction : un envoi disque dans une transaction la
  // ferait courir le temps de l'écriture, et un échec d'écriture ne doit pas défaire une
  // déclaration déjà scellée dans la chaîne.
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
    // Le DÉTAIL est inclus (2026-09-23) : `diplomas` et `experiences` étaient écrits mais
    // jamais relus, et l'onglet Expérience du profil prestataire a besoin de les afficher —
    // il affichait sinon des compteurs vides en face de données réellement enregistrées.
    include: { documents: true, diplomas: true, experiences: { include: { references: true } } },
    orderBy: { declaredAt: "desc" },
  });

  const latestByType = new Map<string, (typeof declarations)[number]>();
  for (const d of declarations) {
    if (!latestByType.has(d.declarationType)) latestByType.set(d.declarationType, d);
  }

  return NextResponse.json({ items: Array.from(latestByType.values()) });
}
