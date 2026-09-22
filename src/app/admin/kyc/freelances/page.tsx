"use client";

import { KycWorkspace } from "@/components/admin/kyc-workspace";

// Route reprise de flexwork_job (`/admin/kyc/freelances`) : les quatre filières prestataires.
export default function AdminKycProvidersPage() {
  return <KycWorkspace population="prestataires" />;
}
