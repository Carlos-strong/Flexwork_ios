import { ProviderMissionsBoard } from "@/components/provider-missions-board";

export default function ManoeuvreMissionsPage() {
  return (
    <ProviderMissionsBoard
      role="manoeuvre"
      title="Missions disponibles — Manœuvre"
      subtitle="Filière chantier : garant obligatoire, assurance effective requise sur les missions à risque élevé."
    />
  );
}
