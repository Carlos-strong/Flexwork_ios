import { Plus_Jakarta_Sans } from 'next/font/google'
import Header from '@/components/afrilance/Header'
import CategoriesBar from '@/components/afrilance/CategoriesBar'
import Hero from '@/components/afrilance/Hero'
import TrustedBy from '@/components/afrilance/TrustedBy'
import PopularServices from '@/components/afrilance/PopularServices'
import LatestMissions from '@/components/afrilance/LatestMissions'
import LatestGigs from '@/components/afrilance/LatestGigs'
import TalentsAfrique from '@/components/afrilance/TalentsAfrique'
import HowItWorks from '@/components/afrilance/HowItWorks'
import ForTalent from '@/components/afrilance/ForTalent'
import Footer from '@/components/afrilance/Footer'
import { getPublishedFrontendConfig, resolveMenu } from '@/lib/frontend-config'

// Page d'accueil — assemblage seul. Chaque section lit elle-même la configuration publiée
// (mémoïsée par requête), sauf l'en-tête : composant client, il reçoit son menu en prop.
//
// La section « Parcourir les talents par domaine » (CategoryGrid) a été retirée le 2026-11-08 :
// elle doublait la barre de catégories et le carrousel « Services 🔥 ».
// Police des titres de l'accueil (voir `.landing` dans globals.css). Importée ICI et pas dans
// le layout racine : next/font précharge la police là où elle est déclarée, et les autres
// écrans n'en ont pas l'usage.
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-landing-display',
  display: 'swap',
})

export default async function Home() {
  const config = await getPublishedFrontendConfig()

  return (
    <main className={`landing min-h-screen bg-white ${display.variable}`}>
      <Header exploreLinks={resolveMenu(config, 'header_explore')} />
      <CategoriesBar />
      <Hero />
      <TrustedBy />
      <LatestMissions />
      <LatestGigs />
      <PopularServices />
      <HowItWorks />
      <TalentsAfrique />
      <ForTalent />
      <Footer />
    </main>
  )
}
