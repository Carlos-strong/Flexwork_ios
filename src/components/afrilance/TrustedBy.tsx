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
    <section className="bg-white py-10 lg:py-12">
      <div className="page-shell">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          {section.title && <p className="text-sm font-medium text-gray-500">{section.title}</p>}
          {section.ctaText && (
            <Link href={section.ctaLink ?? '/confiance'} className="text-sm font-semibold text-[#E85A24] hover:underline">
              {section.ctaText}
            </Link>
          )}
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5">
          {section.items.map((g) => (
            <li key={g.label} className="flex gap-3">
              <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-[#0A1931] text-white grid place-items-center text-xs" aria-hidden>✓</span>
              <div>
                <p className="font-semibold text-[#0A1931]">{g.label}</p>
                {g.sublabel && <p className="text-sm text-gray-500 leading-snug">{g.sublabel}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
