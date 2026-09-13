import Link from "next/link";

// Layout partagé des pages publiques de vitrine (a-propos, comment-ca-marche, confiance,
// confidentialite, cgu, contact, faq, tarifs). Le header global (Nav vert Flexwork) est
// rendu par le layout racine ; ce layout ajoute le conteneur de contenu et le pied de page
// commun, dans le design system Flexwork (#008751, #0A1931, #0f172a/#E2E8F0/#F8FAF9).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8FAF9] flex flex-col">
      <main className="flex-1">{children}</main>

      <footer className="bg-[#0A1931] text-white">
        <div className="h-1 w-full bg-gradient-to-r from-[#008751] via-[#FCD116] to-[#E8112D]" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div>
            <p className="font-extrabold text-lg mb-3">
              Flex<span style={{ color: "#008751" }}>Work</span>
              <span className="ml-1 text-[9px] font-bold tracking-widest bg-white/10 text-white px-1.5 py-0.5 rounded align-middle">
                BJ
              </span>
            </p>
            <p className="text-white/60 leading-relaxed">
              Talents vérifiés, paiement sécurisé en Mobile Money. Cotonou, Bénin 🇧🇯
            </p>
          </div>
          <div>
            <p className="font-bold mb-3">Découvrir</p>
            <ul className="space-y-2 text-white/60">
              <li><Link className="hover:text-white transition" href="/a-propos">À propos</Link></li>
              <li><Link className="hover:text-white transition" href="/comment-ca-marche">Comment ça marche</Link></li>
              <li><Link className="hover:text-white transition" href="/confiance">Confiance &amp; sécurité</Link></li>
              <li><Link className="hover:text-white transition" href="/tarifs">Tarifs</Link></li>
              <li><Link className="hover:text-white transition" href="/chronologie">Chronologie des pages</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-bold mb-3">Légal</p>
            <ul className="space-y-2 text-white/60">
              <li><Link className="hover:text-white transition" href="/cgu">Conditions générales</Link></li>
              <li><Link className="hover:text-white transition" href="/confidentialite">Confidentialité</Link></li>
              <li><Link className="hover:text-white transition" href="/faq">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-bold mb-3">Rejoindre</p>
            <ul className="space-y-2 text-white/60">
              <li><Link className="hover:text-white transition" href="/signup">Créer un compte</Link></li>
              <li><Link className="hover:text-white transition" href="/signin">Se connecter</Link></li>
              <li><Link className="hover:text-white transition" href="/contact">Contact</Link></li>
              <li><Link className="hover:text-white transition" href="/missions/new">Publier une mission</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 py-4">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
            <p>© 2026 FlexWork — Made with ❤️ à Cotonou 🇧🇯</p>
            <p>Mobile Money · FedaPay · MTN · Moov · Orange</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
