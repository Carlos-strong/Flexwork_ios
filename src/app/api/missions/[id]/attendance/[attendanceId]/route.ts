import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  approveAttendance,
  disputeAttendance,
  rejectAttendance,
  resolveAttendanceDispute,
} from "@/lib/spot-time-actions";

// Décision sur UN relevé de présence : validation ou refus.
//
// Une seule route pour les deux gestes, distingués par le corps : ce sont les deux issues d'une
// même décision, et les séparer en deux endpoints aurait dupliqué l'autorisation, le chargement
// et la gestion d'erreur pour une différence d'un champ.
//
// L'autorisation elle-même vit dans `canValidateAttendance` (src/lib/spot-time-actions.ts) :
// le client, ou le responsable de chantier DÉSIGNÉ sur ce contrat. Jamais le prestataire —
// valider ses propres heures, c'est se payer soi-même.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; attendanceId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { attendanceId } = await params;

  const body = await req.json().catch(() => null);

  if (body?.action === "reject") {
    const res = await rejectAttendance({
      attendanceId,
      validatorId: userId,
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.error === "not_found" ? 404 : 409 });
    }
    return NextResponse.json({ status: "rejected" });
  }

  // Contestation (§21) : une part reconnue, une part gelée. Distincte d'un constat partiel —
  // celui-ci laisse le reste disponible, celle-là l'immobilise en attendant l'arbitrage.
  if (body?.action === "dispute") {
    const res = await disputeAttendance({
      attendanceId,
      validatorId: userId,
      approvedQuantity: typeof body.approvedQuantity === "number" ? body.approvedQuantity : 0,
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: res.error, allowed: res.allowed, available: res.available },
        { status: res.error === "not_found" ? 404 : 409 }
      );
    }
    return NextResponse.json(res);
  }

  // Arbitrage d'un litige : la part contestée est reconnue, ou écartée. Dans les deux cas le gel
  // est levé — un différend clos ne doit plus immobiliser de fonds.
  if (body?.action === "resolve") {
    const res = await resolveAttendanceDispute({
      attendanceId,
      validatorId: userId,
      accept: body.accept === true,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.error === "not_found" ? 404 : 409 });
    }
    return NextResponse.json(res);
  }

  const approvedQuantity =
    typeof body?.approvedQuantity === "number" ? body.approvedQuantity : NaN;
  if (Number.isNaN(approvedQuantity)) {
    return NextResponse.json({ error: "invalid_quantity" }, { status: 400 });
  }

  const res = await approveAttendance({
    attendanceId,
    validatorId: userId,
    approvedQuantity,
    overtimeQuantity: typeof body?.overtimeQuantity === "number" ? body.overtimeQuantity : 0,
  });
  if (!res.ok) {
    // `escrow_insufficient` n'est PAS un échec de la validation : le travail est reconnu et la
    // créance enregistrée. Seul le versement attend une recharge (§18). Le corps porte de quoi
    // le dire au client, plutôt qu'un refus sec qui laisserait croire le relevé perdu.
    return NextResponse.json(
      { error: res.error, allowed: res.allowed, available: res.available },
      { status: res.error === "not_found" ? 404 : 409 }
    );
  }
  return NextResponse.json(res);
}
