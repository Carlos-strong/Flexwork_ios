import { handleValidateDeliverable } from "@/lib/deliverable-actions";

// Le client valide le livrable d'UN jalon (« Vérifier ») : instruction RELEASE pour le montant
// de ce jalon, retenue de garantie déduite le cas échéant. Logique partagée avec la variante
// mission (contrat sans jalon) — voir src/lib/deliverable-actions.ts.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const { id: missionId, jalonId } = await params;
  return handleValidateDeliverable({ missionId, jalonId, wrongScopeError: "use_jalon_validate" });
}
