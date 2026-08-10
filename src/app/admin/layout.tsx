import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin — FlexWork" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
