"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, BadgeCheck, ShieldCheck, Scale, Flag,
  FileText, History
} from "lucide-react";

const links = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/kyc", label: "KYC", icon: BadgeCheck },
  { href: "/admin/kyc/historique", label: "Histo. KYC", icon: History },
  { href: "/admin/moderation", label: "Modération", icon: ShieldCheck },
  { href: "/admin/mediation", label: "Médiation", icon: Scale },
  { href: "/admin/risk", label: "Risques", icon: Flag },
  { href: "/admin/audit", label: "Audit", icon: History },
  { href: "/admin/prerequisites", label: "Prérequis", icon: FileText },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-zinc-200 sticky top-0 z-30">
      <div className="mx-auto max-w-[1400px] px-4 flex items-center h-12 gap-1 overflow-x-auto">
        <Link
          href="/admin"
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold mr-2"
          style={{ color: "#008751" }}
        >
          🇧🇯 FlexWork Admin
        </Link>
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                active
                  ? "bg-[#008751] text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
