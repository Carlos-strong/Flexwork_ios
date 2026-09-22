import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor, requireFrontendReader } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { getAllDomainUsage, getUnreferencedDomains, slugify } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

/**
 * Arbre de TRAVAIL du référentiel : tous les statuts sauf archivé, avec pour chaque domaine
 * son adhérence réelle aux données (missions, gigs, profils, règles de risque).
 *
 * L'écran d'édition a besoin des brouillons — c'est là qu'on les écrit. L'API publique, elle,
 * ne voit que le publié. Deux lectures, deux besoins, aucune confusion possible entre les
 * deux puisqu'elles ne passent pas par la même route.
 */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const domains = await prisma.taxonomyDomain.findMany({
    where: { status: { not: "archive" } },
    orderBy: { sortOrder: "asc" },
    include: {
      specialties: {
        where: { status: { not: "archive" } },
        orderBy: { sortOrder: "asc" },
        include: {
          competencies: { where: { status: { not: "archive" } }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  const [usage, unreferenced] = await Promise.all([
    getAllDomainUsage(domains.map((d) => d.name)),
    getUnreferencedDomains(),
  ]);

  return NextResponse.json({
    domains: domains.map((d) => ({ ...d, usage: usage[d.name] })),
    // Libellés saisis en base qu'aucune entrée du référentiel ne décrit. Les afficher évite
    // de construire un référentiel qui ignore ce que les utilisateurs écrivent réellement.
    unreferenced,
  });
}

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("domain"),
    name: z.string().min(2).max(80),
    icon: z.string().max(8).optional(),
  }),
  z.object({
    kind: z.literal("specialty"),
    parentId: z.string().min(1),
    name: z.string().min(2).max(80),
    description: z.string().max(240).optional(),
  }),
  z.object({
    kind: z.literal("competency"),
    parentId: z.string().min(1),
    name: z.string().min(2).max(80),
    verificationExpected: z.boolean().optional(),
  }),
]);

/**
 * Création d'un nœud. Toujours en BROUILLON : rien de ce qui est créé ici n'atteint le public
 * avant deux gestes explicites — passer le nœud en publié, puis publier une version.
 */
export async function POST(req: Request) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const input = parsed.data;
  const slug = slugify(input.name);
  if (!slug) return NextResponse.json({ error: "invalid_slug" }, { status: 400 });

  try {
    if (input.kind === "domain") {
      const last = await prisma.taxonomyDomain.findFirst({ orderBy: { sortOrder: "desc" } });
      const created = await prisma.taxonomyDomain.create({
        data: { slug, name: input.name, icon: input.icon, sortOrder: (last?.sortOrder ?? 0) + 1 },
      });
      await logAdminAction({
        adminId: guard.user.id,
        action: "frontend_taxonomy_create",
        targetType: "TaxonomyDomain",
        targetId: created.id,
        justification: `Création du domaine « ${input.name} »`,
      });
      return NextResponse.json(created, { status: 201 });
    }

    if (input.kind === "specialty") {
      const last = await prisma.taxonomySpecialty.findFirst({
        where: { domainId: input.parentId },
        orderBy: { sortOrder: "desc" },
      });
      const created = await prisma.taxonomySpecialty.create({
        data: {
          domainId: input.parentId,
          slug,
          name: input.name,
          description: input.description,
          sortOrder: (last?.sortOrder ?? 0) + 1,
        },
      });
      await logAdminAction({
        adminId: guard.user.id,
        action: "frontend_taxonomy_create",
        targetType: "TaxonomySpecialty",
        targetId: created.id,
        justification: `Création de la spécialité « ${input.name} »`,
      });
      return NextResponse.json(created, { status: 201 });
    }

    const last = await prisma.taxonomyCompetency.findFirst({
      where: { specialtyId: input.parentId },
      orderBy: { sortOrder: "desc" },
    });
    const created = await prisma.taxonomyCompetency.create({
      data: {
        specialtyId: input.parentId,
        slug,
        name: input.name,
        verificationExpected: input.verificationExpected ?? false,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_taxonomy_create",
      targetType: "TaxonomyCompetency",
      targetId: created.id,
      justification: `Création de la compétence « ${input.name} »`,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // Collision de slug (contrainte unique) : deux « Maçonnerie » dans le même parent
    // produiraient deux URL identiques. Message explicite plutôt qu'un 500 opaque.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "duplicate_slug", slug }, { status: 409 });
    }
    throw error;
  }
}
