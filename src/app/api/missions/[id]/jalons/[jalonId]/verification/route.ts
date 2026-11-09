import { handleTransmitVerification } from "@/lib/deliverable-actions";

// Mode OPR : le responsable de chantier transmet au client UN jalon vérifié (preuves validées,
// avancement constaté à 100 %), pour validation définitive. Logique partagée avec la variante
// mission (contrat sans jalon) — voir src/lib/deliverable-actions.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; jalonId: string }> }) {
  const { id: missionId, jalonId } = await params;
  return handleTransmitVerification(req, { missionId, jalonId, wrongScopeError: "use_jalon_verification" });
}
