import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FinancialKycForm } from "@/components/kyc/FinancialKycForm";
import { BackLink } from "@/components/BackLink";
import { safeCallbackUrl } from "@/lib/safe-callback";

// Écran P8 — KYC financier (2026-09-23).
//
// Page distincte de /kyc, et non une cinquième étape du parcours d'identité : les deux
// dossiers ont deux statuts, deux files d'instruction et deux moments. Un prestataire
// complète son identité à l'inscription ; il renseigne son compte de versement quand il a
// quelque chose à recevoir.
//
// Retour : vers la page d'origine (`?returnTo=`, transmis par le Wallet), sinon le tableau de bord.
export default async function KycFinancierPage({ searchParams }: { searchParams: { returnTo?: string | string[] } }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const returnTo = safeCallbackUrl(typeof searchParams.returnTo === "string" ? searchParams.returnTo : null);
  const back = returnTo?.includes("/wallet")
    ? { href: returnTo, label: "Retour au wallet" }
    : returnTo
      ? { href: returnTo, label: "Revenir à la page précédente" }
      : { href: "/dashboard/provider", label: "Retour au tableau de bord" };

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto fluid-form [--fw:720px] space-y-5">
        <BackLink href={back.href} label={back.label} />
        <div>
          <h1 className="text-[22px] font-bold text-[#0A1931]">Vérification financière requise</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Pour recevoir votre premier paiement, complétez votre compte de versement Mobile Money.
          </p>
        </div>
        <FinancialKycForm />
      </div>
    </div>
  );
}
