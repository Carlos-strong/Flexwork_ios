import type { Metadata } from "next";
import { AdminGate } from "@/components/admin/admin-gate";

export const metadata: Metadata = { title: "Admin — FlexWork" };

/** Espace « Admin Métier » — architecture de flexwork_job, porte et rôles communs. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate space="admin">{children}</AdminGate>;
}
