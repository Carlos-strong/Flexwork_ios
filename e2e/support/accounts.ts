import type { AdminRole, KycStatus, PayoutStatus, UserRole } from "@prisma/client";
import { prisma } from "./db";

// Comptes de test (PLAN_TESTS_GLOBAL.md §0.2), créés à la demande avec des identifiants uniques :
// la base des tests navigateur n'est jamais purgée entre deux campagnes, deux exécutions ne doivent
// donc jamais se disputer un e-mail ou un numéro.
let seq = 0;
const RUN = Date.now().toString().slice(-8);

export type TestUser = { id: string; email: string; tel: string };

export async function createUser(opts: {
  label: string;
  role?: UserRole;
  kycStatus?: KycStatus;
  payout?: PayoutStatus;
  adminRole?: AdminRole;
  isProvider?: boolean;
  firstname?: string;
  lastname?: string;
}): Promise<TestUser> {
  seq += 1;
  const n = `${RUN}${String(seq).padStart(2, "0")}`;
  const isProvider = opts.isProvider ?? (opts.role !== undefined && opts.role !== "client" && opts.role !== "responsable_chantier");
  const user = await prisma.user.create({
    data: {
      email: `pw-${opts.label}-${n}@e2e.flexwork.test`,
      tel: `+2299${n}`,
      role: opts.role ?? "client",
      kycStatus: opts.kycStatus ?? "verifie",
      status: "active",
      country: "BJ",
      city: "Cotonou",
      firstname: opts.firstname ?? "Test",
      lastname: opts.lastname ?? opts.label.toUpperCase(),
      emailVerified: new Date(),
      cgvAcceptedAt: new Date(),
      isProvider,
      providerActivatedAt: isProvider ? new Date() : null,
      isAdmin: !!opts.adminRole,
      adminRole: opts.adminRole ?? null,
    },
  });
  if (opts.payout) {
    await prisma.payoutAccount.create({
      data: { userId: user.id, operator: "mtn", number: `+2299${n}`, holder: "Titulaire Test", status: opts.payout },
    });
  }
  return { id: user.id, email: user.email, tel: user.tel };
}
