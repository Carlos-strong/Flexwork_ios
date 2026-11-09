import { handleObserveProgress } from "@/lib/deliverable-actions";

// Progression CONSTATÉE par le client sur un jalon. Toute la logique est partagée avec la
// variante mission (contrat sans jalon) — voir src/lib/deliverable-actions.ts.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const { id: missionId, jalonId } = await params;
  return handleObserveProgress(req, { missionId, jalonId, wrongScopeError: "use_jalon_observe_progress" });
}
