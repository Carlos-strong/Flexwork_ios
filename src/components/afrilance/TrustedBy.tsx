import Link from 'next/link'

// Bandeau de réassurance. Remplace (2026-09-09) une liste « Ils nous font confiance :
// Flutterwave, Paystack, Andela, MTN, Wave, Jumia + 2 300 entreprises africaines » : ces
// entreprises existent réellement et étaient présentées comme clientes ou partenaires de
// FlexWork sans qu'aucun partenariat n'existe. Afficher le nom et la réputation d'une
// société tierce pour se créditer de sa confiance est une fausse caution, indépendamment de
// l'intention — on n'y substitue donc pas d'autres logos, mais les garanties que la
// plateforme met réellement en œuvre dans le code, chacune documentée sur /confiance.
const GUARANTEES: { label: string; detail: string }[] = [
  { label: 'Identité vérifiée', detail: 'KYC obligatoire avant toute mise en relation' },
  { label: 'Paiement sous séquestre', detail: 'Fonds bloqués jusqu’à validation du livrable' },
  { label: 'Médiation intégrée', detail: 'Litige arbitré par la plateforme' },
  { label: 'Contrat signé', detail: 'Signature électronique et certificat horodaté' },
]

export default function TrustedBy() {
  return (
    <div className="bg-white border-y border-gray-100 py-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-6 lg:gap-8 overflow-x-auto scrollbar-hide text-sm">
        <span className="font-bold text-gray-600 whitespace-nowrap">Vos garanties :</span>
        {GUARANTEES.map((g) => (
          <span key={g.label} className="whitespace-nowrap text-gray-500">
            <span className="font-extrabold text-[#0A1931]">{g.label}</span>
            <span className="hidden lg:inline"> — {g.detail}</span>
          </span>
        ))}
        <Link href="/confiance" className="ml-auto whitespace-nowrap font-bold text-[#FF6B35] hover:underline">
          En savoir plus →
        </Link>
      </div>
    </div>
  )
}
