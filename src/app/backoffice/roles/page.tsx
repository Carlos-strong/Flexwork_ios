"use client";

import { useEffect, useState } from "react";
import type { AdminRole } from "@prisma/client";
import { ADMIN_MODULES, ADMIN_ROLES, ADMIN_ROLE_META, ADMIN_SPACES, isReadOnlyForRole } from "@/lib/admin-roles";
import { AdminCard, AdminEmpty, AdminPageHeader, fetchJson, tableCell, tableHead } from "@/components/admin/admin-ui";

type AdminHolder = {
  id: string;
  email: string;
  adminRole: AdminRole | null;
  status: string;
  createdAt: string;
  lastActionAt: string | null;
  actions: number;
};

/**
 * Rôles & Accès — rubrique du Back Office de flexwork_job.
 *
 * Là-bas : cinq rôles écrits en dur (Super Administrateur, Support, Finance…) qui ne
 * correspondent à rien dans le code. Ici, deux choses vérifiables :
 *   · la MATRICE, calculée depuis `src/lib/admin-roles.ts` — le registre même qui construit les
 *     sidebars. Elle ne peut pas dire autre chose que ce que l'interface fait ;
 *   · les TITULAIRES, lus en base, avec leur dernière action journalisée.
 *
 * Elle remplace aussi l'ancien tableau « 5 rôles admin » de l'écran Prérequis, qui listait encore
 * Admin Qualification, Admin Expérience et Admin Technique — trois rôles supprimés par les
 * arbitrages A8 et A11.
 */
export default function RolesPage() {
  const [admins, setAdmins] = useState<AdminHolder[] | null>(null);

  useEffect(() => {
    fetchJson<{ admins: AdminHolder[] }>("/api/admin/roles").then((r) => r.ok && setAdmins(r.data.admins));
  }, []);

  const holders = (role: AdminRole) => (admins ?? []).filter((a) => a.adminRole === role);
  const withoutRole = (admins ?? []).filter((a) => !a.adminRole);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="🔐"
        title="Rôles & Accès"
        subtitle="Cinq pouvoirs séparés (§13). Aucun ne s’attribue depuis l’interface : un administrateur qui pourrait s’octroyer un rôle supprimerait la séparation qu’il institue."
        readOnly
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_ROLES.map((role) => {
          const meta = ADMIN_ROLE_META[role];
          const list = holders(role);
          return (
            <div key={role} className="min-w-0 rounded-[16px] border border-[#E2E0D9] bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold" style={{ color: meta.accent }}>
                  {meta.label}
                </span>
                <code className="rounded bg-[#F4F3EF] px-1.5 py-0.5 text-[11px] text-[#5A5750]">{role}</code>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-[#5A5750]">{meta.tagline}</p>
              <div className="mt-3 space-y-1">
                {admins === null ? (
                  <div className="text-[12px] text-[#9C9A95]">Chargement…</div>
                ) : list.length === 0 ? (
                  <div className="text-[12px] font-medium text-[#B45309]">Aucun titulaire</div>
                ) : (
                  list.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-[#1A1916]">{a.email}</span>
                      <span className="shrink-0 text-[#9C9A95]">
                        {a.actions > 0 ? `${a.actions} action${a.actions > 1 ? "s" : ""}` : "jamais exercé"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {withoutRole.length > 0 && (
        <AdminCard title="Administrateurs sans pouvoir" subtitle="Marqués administrateurs en base, sans rôle attribué : ils n’ouvrent aucun espace.">
          <ul className="space-y-1 text-[13px]">
            {withoutRole.map((a) => (
              <li key={a.id}>{a.email}</li>
            ))}
          </ul>
        </AdminCard>
      )}

      <AdminCard
        title="Matrice des accès"
        subtitle="● agit · 👁 consulte · — n’a pas accès. Calculée depuis le registre qui construit les sidebars."
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
              <tr>
                <th className={tableHead}>Rubrique</th>
                {ADMIN_ROLES.map((role) => (
                  <th key={role} className={`${tableHead} text-center`}>
                    {ADMIN_ROLE_META[role].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E0D9]">
              {(["admin", "backoffice"] as const).flatMap((space) => [
                <tr key={`space-${space}`} className="bg-[#F4F3EF]">
                  <td colSpan={ADMIN_ROLES.length + 1} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#5A5750]">
                    {ADMIN_SPACES[space].icon} {ADMIN_SPACES[space].label} — {ADMIN_SPACES[space].section}
                  </td>
                </tr>,
                ...ADMIN_MODULES.filter((m) => m.space === space).map((m) => (
                  <tr key={m.id}>
                    <td className={tableCell}>
                      {m.icon} {m.label}
                      {m.unavailable && <span className="ml-1.5 text-[11px] text-[#9C9A95]">(non disponible)</span>}
                    </td>
                    {ADMIN_ROLES.map((role) => {
                      const has = m.roles.includes(role);
                      const reads = has && isReadOnlyForRole(m, role);
                      return (
                        <td key={role} className={`${tableCell} text-center`}>
                          {!has ? (
                            <span className="text-[#C9C6BE]">—</span>
                          ) : reads ? (
                            <span title="Consultation">👁</span>
                          ) : (
                            <span className="font-bold text-[#1A7A4A]" title="Agit">
                              ●
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </AdminCard>

      <AdminCard title="Où se changent les rôles">
        <p className="text-[13px] leading-relaxed text-[#5A5750]">
          Directement en base, champ <code className="rounded bg-[#F4F3EF] px-1">User.adminRole</code> (avec{" "}
          <code className="rounded bg-[#F4F3EF] px-1">isAdmin = true</code>). La prise d’effet est immédiate : la session de
          l’administrateur relit son rôle à chaque requête. Le script <code className="rounded bg-[#F4F3EF] px-1">scripts/list-admins.ts</code>{" "}
          liste les titulaires actuels.
        </p>
        {admins !== null && admins.length === 0 && (
          <div className="mt-3">
            <AdminEmpty>Aucun administrateur en base.</AdminEmpty>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
