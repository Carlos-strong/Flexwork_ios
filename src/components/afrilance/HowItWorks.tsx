import Image from 'next/image'
import Link from 'next/link'

// « Comment ça marche », version courte pour l'accueil : photo à gauche, étapes à droite.
// Le texte résume les ÉTAPES CLIENT de /comment-ca-marche et n'avance rien qu'elles ne
// disent pas déjà — pas de « gratuit », pas de délai chiffré. Toute nouvelle promesse se
// documente d'abord sur cette page, puis se résume ici.
const STEPS = [
  { t: 'Publiez une mission', d: 'Décrivez votre besoin, votre budget et votre délai. Votre identité est vérifiée avant publication.' },
  { t: 'Comparez les offres', d: 'Les prestataires candidatent à prix fixe ou par devis détaillé, en jalons si besoin.' },
  { t: 'Signez et sécurisez', d: 'Le contrat est généré automatiquement ; vous financez le séquestre par Mobile Money.' },
  { t: 'Validez, puis payez', d: 'Les fonds ne sont libérés qu’après validation du livrable.' },
]

export default function HowItWorks() {
  return (
    <section className="py-12 lg:py-16 bg-white">
      <div className="page-shell grid lg:grid-cols-2 gap-8 lg:gap-14 items-center">
        <div className="relative aspect-[4/3] lg:aspect-[4/5] rounded-2xl overflow-hidden">
          <Image
            src="/images/african_designer_studio.webp"
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 560px"
            className="object-cover"
          />
        </div>

        <div>
          <h2 className="text-[30px] md:text-[40px] leading-[1.1] font-semibold text-[#0A1931]">
            De la mission au paiement, sans surprise
          </h2>
          <ol className="mt-8 lg:mt-10 space-y-6 lg:space-y-8">
            {STEPS.map((s, i) => (
              <li key={s.t} className="flex gap-4">
                <span className="w-9 h-9 shrink-0 rounded-full border-2 border-[#0A1931] text-[#0A1931] grid place-items-center font-semibold text-sm">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base lg:text-lg font-semibold text-[#0A1931]">{s.t}</h3>
                  <p className="mt-1 text-[15px] text-gray-600 leading-relaxed">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 lg:mt-10 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="bg-[#FF6B35] hover:bg-[#E85A24] text-white px-6 py-3 rounded-lg font-semibold transition"
              style={{ textDecoration: 'none' }}
            >
              Créer un compte
            </Link>
            <Link
              href="/comment-ca-marche"
              className="border-2 border-[#0A1931] text-[#0A1931] hover:bg-[#0A1931] hover:text-white px-6 py-2.5 rounded-lg font-semibold transition"
              style={{ textDecoration: 'none' }}
            >
              Voir le détail
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
