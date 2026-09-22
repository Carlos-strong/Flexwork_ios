import Link from 'next/link'
import { getPublishedFrontendConfig, resolveSection } from '@/lib/frontend-config'

// Bandeau de réassurance, désormais éditable depuis /backoffice/content.
//
// Il a remplacé (2026-09-09) une liste « Ils nous font confiance : Flutterwave, Paystack,
// Andela, MTN, Wave, Jumia » : ces entreprises existent réellement et étaient présentées
// comme clientes ou partenaires sans qu'aucun partenariat n'existe. Le rendre éditable ne
// change rien à cette règle — ce bandeau énonce les garanties que la plateforme met
// elle-même en œuvre, chacune documentée sur /confiance, et pas la caution d'un tiers.
export default async function TrustedBy() {
  const config = await getPublishedFrontendConfig()
  const section = resolveSection(config, 'guarantees')
  if (!section || section.items.length === 0) return null

  return (
    <div className="bg-white border-y border-gray-100 py-4">
      <div className="page-shell flex items-center gap-6 lg:gap-8 overflow-x-auto scrollbar-hide text-sm">
        {section.title && <span className="font-bold text-gray-600 whitespace-nowrap">{section.title}</span>}
        {section.items.map((g) => (
          <span key={g.label} className="whitespace-nowrap text-gray-500">
            <span className="font-extrabold text-[#0A1931]">{g.label}</span>
            {g.sublabel && <span className="hidden lg:inline"> — {g.sublabel}</span>}
          </span>
        ))}
        {section.ctaText && (
          <Link href={section.ctaLink ?? '/confiance'} className="ml-auto whitespace-nowrap font-bold text-[#FF6B35] hover:underline">
            {section.ctaText}
          </Link>
        )}
      </div>
    </div>
  )
}
