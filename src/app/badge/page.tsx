import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { BadgePanel } from "@/components/profile/BadgePanel";
import { BackLink } from "@/components/BackLink";
import { safeCallbackUrl } from "@/lib/safe-callback";

// Écran P7 — Badge « Vérifié » (2026-09-23).
//
// Une page à part plutôt qu'une section de /declarations : le badge n'est pas une déclaration,
// c'est une DEMANDE dont l'état évolue sans que l'utilisateur ait rien à faire. Un état qui
// change tout seul mérite un écran où on vient le consulter, pas un bloc en bas d'un
// formulaire de saisie.
//
// Retour : vers la page d'origine si elle est passée en `?returnTo=` (le profil la transmet),
// sinon vers le tableau de bord prestataire, d'où part le lien « Voir mon badge ».
export default async function BadgePage({ searchParams }: { searchParams: { returnTo?: string | string[] } }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const returnTo = safeCallbackUrl(typeof searchParams.returnTo === "string" ? searchParams.returnTo : null);
  const back = returnTo
    ? { href: returnTo, label: "Revenir à la page précédente" }
    : { href: "/dashboard/provider", label: "Retour au tableau de bord" };

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto fluid-form [--fw:720px] space-y-5">
        <BackLink href={back.href} label={back.label} />
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1931]">Badge « Vérifié »</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Demande instruite par un administrateur KYC, sur la base de votre diplôme d&apos;État déclaré.
          </p>
        </div>
        <BadgePanel />
      </div>
    </div>
  );
}
