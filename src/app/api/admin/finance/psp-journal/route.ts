import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { listPspJournal, pspJournalStats } from "@/lib/psp-journal";

// Journal des échanges plateforme ⇄ PSP : instructions transmises et messages reçus, entrelacés.
// Les indicateurs accompagnent la première page seulement — les pages suivantes ne les recalculent
// pas. Lecture seule (Superviseur, Médiation).
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const url = new URL(req.url);
  const get = (k: string) => url.searchParams.get(k);
  const cursor = get("cursor");

  const [page, stats] = await Promise.all([
    listPspJournal({
      direction: get("direction"),
      outcome: get("outcome"),
      channel: get("channel"),
      error: get("error"),
      type: get("type"),
      q: get("q"),
      period: get("period"),
      cursor,
      limit: get("limit") ? Number(get("limit")) : undefined,
    }),
    cursor ? null : pspJournalStats(get("period")),
  ]);

  return NextResponse.json({ ...page, stats });
}
