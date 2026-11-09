import Image from 'next/image'
import Link from 'next/link'

// Bloc d'appel aux prestataires : photo à gauche, panneau plein à droite. Mêmes règles que
// HowItWorks — le texte résume les ÉTAPES PRESTATAIRE de /comment-ca-marche, rien de plus.
const POINTS = [
  'Répondez aux missions publiées, en prix fixe ou par devis détaillé.',
  'Les fonds sont sécurisés chez un PSP agréé avant que vous commenciez.',
  'Livrez, faites valider, recevez le paiement libéré par le séquestre.',
]

export default function ForTalent() {
  return (
    <section className="py-12 lg:py-16 bg-white">
      {/* Bandeau plein écran : la photo grandit avec l'écran, le texte s'arrête à la largeur
          utile des autres sections (moitié de 1344 px). */}
      <div className="page-wide">
        <div className="grid lg:grid-cols-2 rounded-2xl lg:rounded-3xl overflow-hidden bg-[#0A1931]">
          <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-[440px]">
            <Image
              src="/images/ankara_video_editor.webp"
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="p-6 sm:p-10 lg:p-12 lg:max-w-[42rem] flex flex-col justify-center text-white">
            <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#FF8A5C]">Pour les prestataires</p>
            <h2 className="mt-4 text-[30px] md:text-[40px] leading-[1.1] font-semibold">
              Trouvez des missions, soyez payé en toute sécurité
            </h2>
            <ul className="mt-8 space-y-4">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-3 text-white/85 leading-relaxed">
                  <span className="mt-1 w-5 h-5 shrink-0 rounded-full bg-[#FF6B35] grid place-items-center text-[10px] text-white" aria-hidden>✓</span>
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Link
                href="/devenir-prestataire"
                className="inline-block bg-white text-[#0A1931] hover:bg-white/85 px-6 py-3 rounded-lg font-semibold transition"
                style={{ textDecoration: 'none' }}
              >
                Devenir prestataire
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
