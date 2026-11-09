import { handleRejectDeliverable } from "@/lib/deliverable-actions";

// « Révision(N) » sur un jalon : rejet motivé du livrable, les fonds restent au séquestre.
// Logique partagée avec la variante mission — voir src/lib/deliverable-actions.ts.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const { id: missionId, jalonId } = await params;
  return handleRejectDeliverable(req, { missionId, jalonId, wrongScopeError: "use_jalon_reject" });
}
