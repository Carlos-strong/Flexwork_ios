import { NextResponse } from "next/server";
import { getVirtualPspSnapshot } from "@/lib/psp-virtual";

// GET /api/psp-virtual/operations — état de la PSP virtuelle (console de développement) :
// soldes séquestrés par contrat + opérations récentes. Accepte un paramètre `?ref=` pour
// renvoyer le détail d'UNE opération (page de paiement Mobile Money simulée).
// Hors développement, la route renvoie 404 (aucune donnée de la console n'existe en
// production — seule la PSP réelle y existe).
export async function GET(req: Request) {
  const snapshot = await getVirtualPspSnapshot();
  if (!snapshot.enabled) {
    return NextResponse.json({ error: "psp_virtual_disabled" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const ref = searchParams.get("ref");
  if (ref) {
    const op = snapshot.operations.find((o) => o.pspReference === ref);
    if (!op) {
      return NextResponse.json({ error: "operation_not_found" }, { status: 404 });
    }
    return NextResponse.json({ operation: op, mode: snapshot.mode, pspName: snapshot.pspName });
  }

  return NextResponse.json(snapshot);
}
