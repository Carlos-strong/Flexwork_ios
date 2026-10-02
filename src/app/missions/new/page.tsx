import { MissionWizard } from "@/components/mission/MissionWizard";

// Publication d'une mission — tunnel en quatre étapes (2026-09-23), en remplacement du
// formulaire d'une seule page. Tout l'état vit dans le composant client : un tunnel partage
// ses champs entre les étapes, ce qu'un formulaire non contrôlé lu via FormData ne permet pas.
export default function PublishMissionPage() {
  return <MissionWizard />;
}
