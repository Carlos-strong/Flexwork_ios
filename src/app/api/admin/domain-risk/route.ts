import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

const schema = z.object({
  domain: z.string().min(2),
  country: z.string().min(2),
  riskLevel: z.enum(["low", "medium", "high"]),
  amountThreshold: z.number().positive().optional(),
  justification: z.string().optional(),
});

// US-701 (Phase 7) : CRUD des paliers de risque par domaine/pays. insuranceRequired est
// dérivé de riskLevel côté serveur — true uniquement pour "high", jamais configurable à
// false pour ce palier (garde-fou métier, pas une simple convention d'usage).
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const entry = await prisma.domainRiskLevel.upsert({
    where: { domain_country: { domain: parsed.data.domain, country: parsed.data.country } },
    create: { ...parsed.data, insuranceRequired: parsed.data.riskLevel === "high" },
    update: { ...parsed.data, insuranceRequired: parsed.data.riskLevel === "high" },
  });

  return NextResponse.json(entry);
}

export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const items = await prisma.domainRiskLevel.findMany({ orderBy: [{ country: "asc" }, { domain: "asc" }] });
  return NextResponse.json({ items });
}
