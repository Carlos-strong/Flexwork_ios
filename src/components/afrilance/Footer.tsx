import Link from 'next/link'
import { getPublishedFrontendConfig, resolveMenu, resolveSetting } from '@/lib/frontend-config'
import { DEFAULT_MENUS, FOOTER_MENU_KEYS } from '@/lib/frontend-defaults'

// Colonnes du pied de page, éditables depuis /backoffice/content.
//
// Toutes les entrées étaient de simples <li> non cliquables jusqu'au 2026-08. Elles sont
// devenues des liens vers des pages qui existent dans src/app, et les rubriques sans page
// réelle (« Carrières », « Presse », « Blog AfroTech », « Événements Dakar ») ont été
// retirées plutôt que transformées en liens morts. Ce garde-fou est maintenant appliqué à
// l'écriture par isLinkableHref : une destination inexistante est refusée par l'API avant
// d'atteindre la base, ce qui vaut mieux que de la découvrir en production.
//
// L'intitulé de colonne est celui du menu, amputé de son préfixe technique.
function columnTitle(key: string): string {
  return (DEFAULT_MENUS[key]?.label ?? key).replace(/^Pied de page — /, '')
}

// Le logo textuel colore la seconde moitié du nom : « Flex » + « Work » en orange. La coupure
// se fait sur la majuscule interne plutôt qu'à un rang fixe, pour qu'un nom renommé depuis les
// réglages ne soit pas tranché au milieu d'un mot.
function splitBrand(name: string): [string, string] {
  const match = name.match(/^(.[^A-ZÀ-Ý]*)(.*)$/u)
  return match ? [match[1], match[2]] : [name, '']
}

export default async function Footer() {
  const config = await getPublishedFrontendConfig()
  const columns = FOOTER_MENU_KEYS.map((key) => ({
    key,
    title: columnTitle(key),
    links: resolveMenu(config, key),
  })).filter((column) => column.links.length > 0)

  const siteName = resolveSetting(config, 'site.name')
  const [brandHead, brandTail] = splitBrand(siteName)
  const baseline = resolveSetting(config, 'site.baseline')
  const footerNote = resolveSetting(config, 'site.footerNote')

  return (
    <footer className="bg-white pb-6">
      {/* Gabarit Upwork : boîte sombre de 1488 px max, coins de 8 px, à 24 px des bords. */}
      <div className="footer-shell">
        <div className="footer-box bg-[#0A1931] text-white">
          <div className="page-inner">
            <div className="py-12 lg:py-16 grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-10 text-sm lg:text-base">
              <div>
                <Link href="/" className="font-extrabold text-xl mb-4 block" style={{ textDecoration: 'none', color: 'inherit' }}>
                  {brandHead}<span className="text-[#FF6B35]">{brandTail}</span>.
                </Link>
                <p className="text-white/60 text-sm leading-relaxed">{baseline}</p>
              </div>
              {columns.map((col) => (
                <div key={col.key}>
                  <p className="font-bold mb-4">{col.title}</p>
                  <ul className="space-y-2.5 text-white/60 text-sm">
                    {col.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className="hover:text-[#FF6B35] transition" style={{ textDecoration: 'none' }}>
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 py-5 lg:py-6">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs lg:text-sm text-white/50">
                <p>© {new Date().getFullYear()} {siteName} — {footerNote}</p>
                <div className="flex gap-4"><span>FR</span><span>FCFA</span><span>● Mobile Money</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
