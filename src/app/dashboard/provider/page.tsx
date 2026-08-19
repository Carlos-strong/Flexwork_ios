import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";

export default async function ProviderDashboardRedirectPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.isAdmin) redirect("/admin");
  redirect(ROLE_DASHBOARD[session.user.role] ?? "/dashboard/client");
}
