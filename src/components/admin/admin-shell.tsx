"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { AdminRole } from "@prisma/client";
import {
  ADMIN_ROLE_META,
  ADMIN_SPACES,
  activeModuleForRole,
  activeSubItemForRole,
  canOpenPath,
  isReadOnlyForRole,
  modulesForRole,
  spacesForRole,
  subItemsForRole,
  type AdminSpace,
} from "@/lib/admin-roles";
import { AdminRoleProvider } from "@/components/admin/admin-role-context";

/**
 * Coquille des deux espaces d'administration, au gabarit de `flexwork_job` : sidebar de 224 px,
 * titre d'espace en bleu, section « Admin Métier » / « Opérationnel », entrées à emoji, lien de
 * bascule vers l'autre espace sous un séparateur, déconnexion en pied, contenu sur fond
 * `#F4F3EF` plafonné à 1200 px.
 *
 * Deux ajouts par rapport à l'original, tous deux dus à la séparation des pouvoirs (§13) :
 *   · la sidebar ne contient que les rubriques du rôle, et le lien de bascule n'apparaît que si
 *     le rôle a quelque chose dans l'autre espace ;
 *   · une carte de rôle dit sous quel pouvoir on est connecté — sans elle, un superviseur et un
 *     médiateur voient des interfaces voisines et doivent deviner lequel des deux compte leurs
 *     clics.
 *
 * Elle refuse aussi d'afficher un écran hors du pouvoir du rôle, même atteint par URL directe.
 * C'est une protection d'AFFICHAGE : la donnée, elle, est protégée par la garde de chaque route
 * d'API, qu'un appel direct ne contourne pas.
 */
export function AdminShell({
  role,
  user,
  space,
  children,
}: {
  role: AdminRole;
  user: { id: string; email: string };
  space: AdminSpace;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");
  const meta = ADMIN_ROLE_META[role];
  const spaceMeta = ADMIN_SPACES[space];
  const items = modulesForRole(role, space);
  const otherSpace = spacesForRole(role).find((s) => s !== space);

  const activeModule = activeModuleForRole(role, pathname);
  const activeSub = activeModule ? activeSubItemForRole(activeModule, role, pathname, hash) : undefined;
  const allowed = canOpenPath(role, pathname);

  // Une sous-rubrique ancrée (`#proposer`) change l'URL sans changer de route : Next ne
  // re-rend rien, il faut suivre le hash à la main.
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [pathname]);

  useEffect(() => setOpen(false), [pathname]);

  const linkBase =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  return (
    <AdminRoleProvider role={role}>
      <div className="flex min-h-screen text-[#1A1916]">
        {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}

        <aside
          className={`fixed lg:sticky top-0 left-0 z-50 h-screen h-dvh w-56 shrink-0 border-r border-[#E2E0D9] bg-white flex flex-col transition-transform duration-200 ${
            open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[#E2E0D9] px-5">
            <span className="text-base leading-none">{spaceMeta.icon}</span>
            <Link href={spaceMeta.root} className="text-sm font-bold text-[#2D5BE3]" style={{ textDecoration: "none" }}>
              {spaceMeta.label}
            </Link>
          </div>

          <div className="shrink-0 px-3 pt-3">
            <div
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: `${meta.accent}40`, background: `${meta.accent}0F` }}
            >
              <div className="text-[12px] font-bold" style={{ color: meta.accent }}>
                {meta.label}
              </div>
              <div className="mt-0.5 text-[10.5px] leading-snug text-[#5A5750]">{meta.tagline}</div>
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#5A5750]">
              {spaceMeta.section}
            </p>

            {items.map((item) => {
              const active = item.id === activeModule?.id;
              const consultation = isReadOnlyForRole(item, role);
              const subs = active ? subItemsForRole(item, role) : [];
              return (
                <div key={item.id}>
                  <Link
                    href={item.href}
                    title={item.hint}
                    className={`${linkBase} ${
                      active
                        ? "bg-[#EEF2FD] text-[#1A1916]"
                        : "text-[#5A5750] hover:bg-[#EEF2FD] hover:text-[#1A1916]"
                    } ${item.unavailable ? "opacity-60" : ""}`}
                    style={{ textDecoration: "none" }}
                  >
                    <span className="text-base leading-none">{item.icon}</span>
                    {/* Passage à la ligne plutôt que troncature : dans 224 px, avec l'œil de consultation,
                        « KYC et Vérifications » devenait « KYC et Vérificati… ». */}
                    <span className="flex-1 leading-snug">{item.label}</span>
                    {/* Sur un Dashboard, tous les rôles sont en consultation : l'œil n'y
                        distinguerait rien, il n'est montré que là où il sépare lire d'agir. */}
                    {consultation && !item.unavailable && item.href !== spaceMeta.root && (
                      <span title="Consultation — aucun geste" className="text-[11px] leading-none text-[#9C9A95]">
                        👁
                      </span>
                    )}
                  </Link>

                  {subs.length > 0 && (
                    <div className="ml-[22px] mt-0.5 mb-1 space-y-0.5 border-l border-[#E2E0D9] pl-2.5">
                      {subs.map((sub) => {
                        const isAnchor = sub.href.startsWith("#");
                        const subActive = sub.id === activeSub?.id;
                        return (
                          <Link
                            key={sub.id}
                            href={isAnchor ? `${item.href}${sub.href}` : sub.href}
                            title={sub.hint}
                            onClick={() => {
                              if (!isAnchor) return;
                              // Next ne re-défile pas vers une ancre déjà présente dans l'URL :
                              // un second clic sur la même sous-rubrique ne ferait rien.
                              const id = sub.href.slice(1);
                              setHash(`#${id}`);
                              requestAnimationFrame(() =>
                                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
                              );
                            }}
                            className={`block rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                              subActive
                                ? "font-semibold text-[#2D5BE3] bg-[#EEF2FD]"
                                : "text-[#5A5750] hover:bg-[#F4F3EF] hover:text-[#1A1916]"
                            }`}
                            style={{ textDecoration: "none" }}
                          >
                            {sub.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {otherSpace && (
              <>
                <div className="my-2 border-t border-[#E2E0D9]" />
                <Link
                  href={ADMIN_SPACES[otherSpace].root}
                  className={`${linkBase} text-[#5A5750] hover:bg-[#EEF2FD] hover:text-[#1A1916]`}
                  style={{ textDecoration: "none" }}
                >
                  <span className="text-base leading-none">{ADMIN_SPACES[otherSpace].icon}</span>
                  {ADMIN_SPACES[otherSpace].crossLabel}
                </Link>
              </>
            )}
          </nav>

          <div className="shrink-0 space-y-1 border-t border-[#E2E0D9] p-3">
            <div className="truncate px-3 text-[11px] text-[#9C9A95]" title={user.email}>
              {user.email}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className={`${linkBase} w-full text-[#B42318] hover:bg-[#FDEDEC]`}
            >
              <span className="text-base leading-none">🚪</span>
              Déconnexion
            </button>
          </div>
        </aside>

        <main className="min-h-screen min-w-0 flex-1 bg-[#F4F3EF] p-4 sm:p-6 lg:p-8">
          <button
            onClick={() => setOpen(true)}
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-[#E2E0D9] bg-white px-3 py-2 text-sm font-medium text-[#5A5750] lg:hidden"
          >
            ☰ {spaceMeta.label}
          </button>

          {/* `space-y-5` : plusieurs écrans renvoient un fragment (en-tête, barre de publication,
              blocs) et comptaient sur leur ancien gabarit pour les espacer. */}
          <div className="page-width space-y-5">
            {!allowed ? (
              <OutOfRole roleLabel={meta.label} />
            ) : activeModule?.unavailable ? (
              <Unavailable title={`${activeModule.icon} ${activeModule.label}`} reason={activeModule.unavailable} />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </AdminRoleProvider>
  );
}

function OutOfRole({ roleLabel }: { roleLabel: string }) {
  return (
    <div className="rounded-[16px] border border-[#E2E0D9] bg-white p-8 text-center shadow-sm">
      <div className="text-[22px]">🔒</div>
      <h1 className="mt-2 text-[18px] font-semibold tracking-[-0.02em]">Hors de votre pouvoir</h1>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[#5A5750]">
        Cette rubrique relève d’un autre rôle d’administration que « {roleLabel} ». La séparation des
        pouvoirs (§13) réserve chaque geste à un seul rôle : elle ne vous est pas ouverte, même par
        adresse directe.
      </p>
    </div>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[14px] text-[#5A5750]">Rubrique de flexwork_job sans contrepartie dans ce projet.</p>
      </div>
      <div className="rounded-[16px] border border-[#E2E0D9] bg-white p-6 shadow-sm">
        <span className="inline-block rounded-full border border-[#E2E0D9] bg-[#FAFAF8] px-2.5 py-0.5 text-[11px] font-semibold text-[#5A5750]">
          Non disponible
        </span>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-[#1A1916]">{reason}</p>
        <p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-[#9C9A95]">
          La rubrique figure dans la navigation pour que l’architecture soit complète. Elle n’affiche
          aucune donnée plutôt que des données inventées.
        </p>
      </div>
    </div>
  );
}

