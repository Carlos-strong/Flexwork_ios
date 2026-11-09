import { handleCheckpoint } from "@/lib/deliverable-actions";

// Point d'étape confirmé par le client sur un jalon (« validation partielle ») — et, en
// financement progressif, libération de l'incrément validé. Logique partagée avec la variante
// mission : voir src/lib/deliverable-actions.ts.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const { id: missionId, jalonId } = await params;
  return handleCheckpoint(req, { missionId, jalonId, wrongScopeError: "use_jalon_checkpoint" });
}
