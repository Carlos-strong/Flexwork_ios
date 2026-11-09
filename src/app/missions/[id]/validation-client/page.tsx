import { redirect } from "next/navigation";

// Redondante depuis 2026-09-03 : missions/[id]/page.tsx AFFICHE déjà la vue « Validation
// Client » (ClientValidationWorkspace) pour le client propriétaire d'une mission engagée.
// Cette route est conservée uniquement en REDIRECTION vers /missions/[id] pour ne pas casser
// les anciens liens (favoris, notifications…) ; les liens internes pointent désormais
// directement vers /missions/[id] (voir MesMissions.tsx).
export default function ValidationClientPage({ params }: { params: { id: string } }) {
  redirect(`/missions/${params.id}`);
}
