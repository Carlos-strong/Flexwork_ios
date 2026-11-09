import Link from "next/link";
import { auth } from "@/auth";
import { MissionWizard } from "@/components/mission/MissionWizard";
import { PublishAuthGate } from "@/components/mission/PublishAuthGate";

// Publication d'une mission — tunnel en quatre étapes (2026-09-23), en remplacement du
// formulaire d'une seule page. Tout l'état vit dans le composant client : un tunnel partage
// ses champs entre les étapes, ce qu'un formulaire non contrôlé lu via FormData ne permet pas.
//
// Visiteur non connecté (2026-11-09) : on vérifie d'abord s'il a un compte — connexion par code
// s'il en a un, inscription sinon — AVANT de lui faire remplir le tunnel, qui échouait en 401 à
// la publication. Il revient ensuite ici avec la même URL (métier, prestataire invité).
//
// Sur SON PROPRE profil (2026-11-09) : un prestataire non connecté voit « Publier une mission »
// sur sa page publique ; une fois identifié, `?pour=` le désigne lui-même. Le tunnel ne s'ouvre
// pas — l'API refuse de toute façon (`self_invitation`, POST /api/missions).
export const dynamic = "force-dynamic";

export default async function PublishMissionPage({ searchParams }: { searchParams: { pour?: string | string[] } }) {
  const session = await auth();
  if (!session?.user) return <PublishAuthGate />;

  const userId = (session.user as { id?: string }).id;
  const pour = Array.isArray(searchParams.pour) ? searchParams.pour[0] : searchParams.pour;
  if (userId && pour && pour === userId) return <SelfPublishBlocked userId={userId} />;

  return <MissionWizard />;
}

function SelfPublishBlocked({ userId }: { userId: string }) {
  return (
    <main className="min-h-screen bg-[#F8FAF9] flex items-start md:items-center justify-center p-4 pt-8 md:p-8">
      <div role="alert" className="w-full max-w-[480px] bg-white border border-[#E2E8F0] rounded-2xl p-6 md:p-8">
        <h1 className="text-[20px] md:text-[22px] font-bold text-[#0A1931] leading-tight">
          Vous ne pouvez pas publier une mission sur votre propre profil
        </h1>
        <p className="mt-3 text-[14px] text-zinc-600 leading-relaxed">
          Ce bouton de votre page publique permet aux <span className="font-semibold">clients</span> de vous confier une mission
          dans votre domaine. Vous ne pouvez pas vous l&apos;adresser à vous-même.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link
            href={`/profil/${userId}`}
            className="h-11 px-5 inline-flex items-center justify-center rounded-xl bg-[#0A1931] text-white text-[14px] font-semibold hover:bg-[#1e293b]"
            style={{ textDecoration: "none" }}
          >
            Voir mon profil
          </Link>
          <Link
            href="/dashboard"
            className="h-11 px-5 inline-flex items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-medium text-zinc-700 hover:bg-zinc-50"
            style={{ textDecoration: "none" }}
          >
            Mon tableau de bord
          </Link>
        </div>
      </div>
    </main>
  );
}
