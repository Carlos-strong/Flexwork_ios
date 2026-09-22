import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/adminGuard";
import { getAutomationBacklog } from "@/lib/automation-backlog";

export const dynamic = "force-dynamic";

/**
 * Arriéré des tâches automatiques — superviseur, en lecture seule.
 *
 * Contrairement à `/api/admin/queues` de flexwork_job, qui n'a aucune garde et met en pause ou
 * relance une file par un simple GET, cette route ne fait que LIRE, et seulement pour le
 * superviseur. Aucune action n'y est exposée, ni par GET ni autrement.
 */
export async function GET() {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  return NextResponse.json({ generatedAt: new Date().toISOString(), tasks: await getAutomationBacklog() });
}
