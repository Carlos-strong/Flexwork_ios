import { handleObserveProgress } from "@/lib/deliverable-actions";

// Progression CONSTATÉE par le client, portée MISSION ENTIÈRE (contrat sans jalon). Même
// logique que la variante jalon — voir src/lib/deliverable-actions.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;
  return handleObserveProgress(req, { missionId, jalonId: null, wrongScopeError: "use_jalon_observe_progress" });
}
