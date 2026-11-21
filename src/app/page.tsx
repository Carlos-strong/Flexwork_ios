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

// Page d'accueil — assemblage seul. Chaque section lit elle-même la configuration publiée
// (mémoïsée par requête), sauf l'en-tête : composant client, il reçoit son menu en prop.
//
// La section « Parcourir les talents par domaine » (CategoryGrid) a été retirée le 2026-11-08 :
// elle doublait la barre de catégories et le carrousel « Services 🔥 ».

export default async function Home() {
  return (
    <main className={`landing min-h-screen bg-white`}>
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
