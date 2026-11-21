import { handleValidateDeliverable } from "@/lib/deliverable-actions";

// US-504 : le client valide le livrable, portée MISSION ENTIÈRE (contrat sans jalon) —
// instruction RELEASE pour le prix du contrat. La confirmation reste conditionnée au webhook
// PSP, jamais optimiste. Voir src/lib/deliverable-actions.ts.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;
  return handleValidateDeliverable({ missionId, jalonId: null, wrongScopeError: "use_jalon_validate" });
}
