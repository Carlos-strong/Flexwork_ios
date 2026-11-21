import { handleTransmitVerification } from "@/lib/deliverable-actions";

// Mode OPR, contrat SANS jalon : le responsable de chantier transmet au client le livrable de la
// mission entière, vérifié, pour validation définitive.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: missionId } = await params;
  return handleTransmitVerification(req, { missionId, jalonId: null, wrongScopeError: "use_jalon_verification" });
}
