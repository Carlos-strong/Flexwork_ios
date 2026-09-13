import { handleRejectDeliverable } from "@/lib/deliverable-actions";

// Rejet motivé du livrable, portée MISSION ENTIÈRE (contrat sans jalon) — la mission redescend
// à `fonds_sous_sequestre` pour resoumission. Voir src/lib/deliverable-actions.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;
  return handleRejectDeliverable(req, { missionId, jalonId: null, wrongScopeError: "use_jalon_reject" });
}
