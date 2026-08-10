// Pastille drapeau Bénin — utilisée par le logo (Nav) et la page d'accueil.
// Était dupliquée à l'identique dans src/components/nav.tsx et src/app/page.tsx.
export function BeninFlag() {
  return (
    <div className="w-7 h-5 rounded-[3px] overflow-hidden flex shadow-sm border border-zinc-100 shrink-0">
      <div className="w-[40%] bg-[#008751] h-full" />
      <div className="flex-1 flex flex-col">
        <div className="flex-1 bg-[#FCD116]" />
        <div className="flex-1 bg-[#E8112D]" />
      </div>
    </div>
  );
}
