import { handleCheckpoint } from "@/lib/deliverable-actions";

// Point d'étape confirmé par le client, portée MISSION ENTIÈRE (contrat sans jalon) — la
// mécanique progressive s'applique alors au prix du contrat. Voir
// src/lib/deliverable-actions.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;
  return handleCheckpoint(req, { missionId, jalonId: null, wrongScopeError: "use_jalon_checkpoint" });
}
