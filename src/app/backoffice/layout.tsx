import type { Metadata } from "next";
import { AdminGate } from "@/components/admin/admin-gate";

export const metadata: Metadata = { title: "Back Office — FlexWork" };

/** Espace « Back Office » — même porte que `/admin` : aucun des deux n'est laissé ouvert. */
export default function BackOfficeLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate space="backoffice">{children}</AdminGate>;
}
