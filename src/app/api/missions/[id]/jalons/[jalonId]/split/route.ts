import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isJalonUnengaged, validateJalonsSum } from "@/lib/jalons";
import { hasInFlightHold } from "@/lib/escrow";

const schema = z.object({
  parts: z
    .array(z.object({ titre: z.string().min(1), montant: z.number().positive() }))
    .min(2, "Une scission nécessite au moins 2 parts."),
});

// Scinde UN jalon non encore financé (statut en_attente) en plusieurs sous-jalons dont la
// somme des montants reste strictement égale au jalon d'origine — le total du contrat signé
// ne bouge jamais (voir plan « Jalons » : pas d'ajout libre post-contrat, seulement une
// redistribution d'un montant déjà engagé). Réservé au client, propriétaire du contrat.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Retenue de garantie (règle 18.10) : la retenue totale est la SOMME des retenues arrondies
  // jalon par jalon (voir totalRetentionAmount, src/lib/jalons.ts) — scinder un jalon change le
  // nombre d'arrondis, donc le total. Or ce total est écrit en toutes lettres à l'Article 4 du
  // contrat SIGNÉ, dont le `termsSnapshot` est immuable et chaîné par hash : on ne peut ni le
  // corriger après coup, ni laisser le contrat annoncer un montant que la plateforme ne
  // retiendra pas. Mesuré : un jalon de 12 345 scindé en trois fait passer la retenue de 4 617
  // à 4 618 — un franc qui resterait séquestré sans instruction pour aller le chercher.
  if (contract.retentionRate > 0) {
    return NextResponse.json({ error: "split_forbidden_with_retention" }, { status: 409 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isJalonUnengaged(jalon.status)) {
    return NextResponse.json({ error: "jalon_not_splittable" }, { status: 409 });
  }
  // Le statut ne suffit pas : un jalon dont le HOLD est `pending` est ENCORE `en_attente` (seul
  // le webhook le fait basculer). Or la scission SUPPRIME le jalon, et `PspEscrowOperation` est
  // en `onDelete: Cascade` sur lui — l'opération partait avec. Le webhook arrivait ensuite sur
  // une référence disparue (`operation_not_found`) : le client était débité et la plateforme
  // n'en gardait aucune trace, sans aucun moyen de rejouer. Vérification explicite du
  // mouvement, pas seulement du statut.
  if (await hasInFlightHold({ jalonId: jalon.id })) {
    return NextResponse.json({ error: "jalon_payment_in_flight" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const validation = validateJalonsSum(parsed.data.parts, jalon.montant);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const parts = parsed.data.parts;
  const shift = parts.length - 1; // nombre de rangs à libérer après le jalon scindé

  const created = await prisma.$transaction(async (tx) => {
    // Jalons situés après celui qu'on scinde — décalés pour libérer `shift` rangs. Traités du
    // plus grand ordre au plus petit pour ne jamais entrer en collision transitoire avec
    // @@unique([contractId, ordre]) (chaque valeur cible est libre au moment où elle est écrite).
    const trailing = await tx.jalon.findMany({
      where: { contractId: contract.id, ordre: { gt: jalon.ordre } },
      orderBy: { ordre: "desc" },
    });
    for (const t of trailing) {
      await tx.jalon.update({ where: { id: t.id }, data: { ordre: t.ordre + shift } });
    }

    await tx.jalon.delete({ where: { id: jalon.id } });

    const newJalons = [];
    for (let i = 0; i < parts.length; i++) {
      newJalons.push(
        await tx.jalon.create({
          data: {
            contractId: contract.id,
            ordre: jalon.ordre + i,
            titre: parts[i].titre,
            montant: parts[i].montant,
          },
        })
      );
    }
    return newJalons;
  });

  return NextResponse.json({ items: created });
}
