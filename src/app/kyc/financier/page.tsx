import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FinancialKycForm } from "@/components/kyc/FinancialKycForm";

// Écran P8 — KYC financier (2026-09-23).
//
// Page distincte de /kyc, et non une cinquième étape du parcours d'identité : les deux
// dossiers ont deux statuts, deux files d'instruction et deux moments. Un prestataire
// complète son identité à l'inscription ; il renseigne son compte de versement quand il a
// quelque chose à recevoir.
export default async function KycFinancierPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="min-h-screen bg-zinc-50 py-10 px-4">
      <div className="mx-auto fluid-form [--fw:720px] space-y-5">
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
