import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireFrontendEditor } from "@/lib/frontend-admin-guard";
import { logAdminAction } from "@/lib/admin-audit";
import { getDomainUsage } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const KINDS = ["domain", "specialty", "competency"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  icon: z.string().max(8).nullable().optional(),
  description: z.string().max(240).nullable().optional(),
  verificationExpected: z.boolean().optional(),
  status: z.enum(["brouillon", "publie", "desactive", "archive"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// Le SLUG est absent de ce schéma, et ce n'est pas un oubli : il est fixé à la création et ne
// bouge plus (voir slugify dans src/lib/taxonomy.ts). Renommer un libellé ne doit pas casser
// une URL déjà indexée.

export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { kind, id } = await params;
  if (!isKind(kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const data = parsed.data;
  const justification =
    data.status
      ? `Passage au statut « ${data.status} »`
      : data.sortOrder !== undefined
        ? "Réordonnancement"
        : "Modification du libellé";

  if (kind === "domain") {
    const updated = await prisma.taxonomyDomain.update({
      where: { id },
      data: { name: data.name, icon: data.icon, status: data.status, sortOrder: data.sortOrder },
    });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_taxonomy_update",
      targetType: "TaxonomyDomain",
      targetId: id,
      justification,
    });
    return NextResponse.json(updated);
  }

  if (kind === "specialty") {
    const updated = await prisma.taxonomySpecialty.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        status: data.status,
        sortOrder: data.sortOrder,
      },
    });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_taxonomy_update",
      targetType: "TaxonomySpecialty",
      targetId: id,
      justification,
    });
    return NextResponse.json(updated);
  }

  const updated = await prisma.taxonomyCompetency.update({
    where: { id },
    data: {
      name: data.name,
      verificationExpected: data.verificationExpected,
      status: data.status,
      sortOrder: data.sortOrder,
    },
  });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_taxonomy_update",
    targetType: "TaxonomyCompetency",
    targetId: id,
    justification,
  });
  return NextResponse.json(updated);
}

/**
 * Suppression définitive — refusée dès qu'une donnée réelle s'y rattache.
 *
 * Le référentiel décrit du texte libre déjà saisi (voir le commentaire de TaxonomyDomain) :
 * effacer « Plomberie » n'efface aucune mission, mais prive de leur description les 40
 * missions qui portent ce libellé, et les rend invisibles dans tout écran qui s'appuiera
 * demain sur le référentiel. L'archivage existe pour exactement ce cas : l'entrée sort des
 * écrans publics et d'édition, la description reste disponible pour ce qui s'y rattache.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const guard = await requireFrontendEditor();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { kind, id } = await params;
  if (!isKind(kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 404 });

  if (kind === "domain") {
    const domain = await prisma.taxonomyDomain.findUnique({ where: { id } });
    if (!domain) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const usage = await getDomainUsage(domain.name);
    if (usage.total > 0) {
      return NextResponse.json(
        { error: "domain_in_use", usage, remedy: "archive" },
        { status: 409 }
      );
    }

    await prisma.taxonomyDomain.delete({ where: { id } });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_taxonomy_delete",
      targetType: "TaxonomyDomain",
      targetId: id,
      justification: `Suppression du domaine « ${domain.name} » — aucune donnée rattachée`,
    });
    return NextResponse.json({ deleted: true });
  }

  // Spécialités et compétences ne sont encore citées par AUCUNE table métier : `Mission`,
  // `Gig` et `Profile` ne portent qu'un domaine. Leur suppression est donc sans conséquence
  // sur des données existantes, et n'a pas de garde à opposer. Le jour où une mission
  // référencera une spécialité, ce bloc devra compter cet usage comme le fait celui du
  // domaine — la remarque est ici pour que ce ne soit pas découvert par un incident.
  if (kind === "specialty") {
    const specialty = await prisma.taxonomySpecialty.findUnique({ where: { id } });
    if (!specialty) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await prisma.taxonomySpecialty.delete({ where: { id } });
    await logAdminAction({
      adminId: guard.user.id,
      action: "frontend_taxonomy_delete",
      targetType: "TaxonomySpecialty",
      targetId: id,
      justification: `Suppression de la spécialité « ${specialty.name} »`,
    });
    return NextResponse.json({ deleted: true });
  }

  const competency = await prisma.taxonomyCompetency.findUnique({ where: { id } });
  if (!competency) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await prisma.taxonomyCompetency.delete({ where: { id } });
  await logAdminAction({
    adminId: guard.user.id,
    action: "frontend_taxonomy_delete",
    targetType: "TaxonomyCompetency",
    targetId: id,
    justification: `Suppression de la compétence « ${competency.name} »`,
  });
  return NextResponse.json({ deleted: true });
}
