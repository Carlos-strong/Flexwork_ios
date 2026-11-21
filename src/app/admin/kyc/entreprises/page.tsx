"use client";

import { KycWorkspace } from "@/components/admin/kyc-workspace";

// Route reprise de flexwork_job (`/admin/kyc/entreprises`). Ce projet n'a pas d'entité
// entreprise : la rubrique réunit le côté client — les clients et leurs responsables de chantier.
export default function AdminKycClientsPage() {
  return <KycWorkspace population="clients" />;
}
