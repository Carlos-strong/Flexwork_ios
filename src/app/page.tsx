import Header from '@/components/afrilance/Header'
import CategoriesBar from '@/components/afrilance/CategoriesBar'
import Hero from '@/components/afrilance/Hero'
import TrustedBy from '@/components/afrilance/TrustedBy'
import PopularServices from '@/components/afrilance/PopularServices'
import CategoryGrid from '@/components/afrilance/CategoryGrid'
import TalentsAfrique from '@/components/afrilance/TalentsAfrique'
import Footer from '@/components/afrilance/Footer'
import { getPublishedFrontendConfig, resolveMenu } from '@/lib/frontend-config'

// Page d'accueil — assemblage seul. Chaque section lit elle-même la configuration publiée
// (mémoïsée par requête), sauf l'en-tête : composant client, il reçoit son menu en prop.
//
// La grille d'icônes qui était écrite ici en JSX est devenue CategoryGrid, pour la même
// raison que les autres : son contenu est éditable depuis /backoffice/content.
export default async function Home() {
  const config = await getPublishedFrontendConfig()

  return (
    <main className="min-h-screen bg-white">
      <Header exploreLinks={resolveMenu(config, 'header_explore')} />
      <CategoriesBar />
      <Hero />
      <TrustedBy />
      <PopularServices />
      <CategoryGrid />
      <TalentsAfrique />
      <Footer />
    </main>
  )
}
