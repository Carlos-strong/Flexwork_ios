// En-tête de section partagé des pages publiques de vitrine — design system Flexwork
// (vert #008751, neutres #0f172a/#64748B/#E2E8F0, fond #F8FAF9), cohérent avec les pages
// missions/dashboards de l'app.
export function PageHero({
  badge,
  title,
  subtitle,
}: {
  badge: string;
  title: string;
  subtitle: string;
}) {
  return (
    <section className="bg-white border-b border-[#E2E8F0]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 lg:py-16">
        <span className="inline-block text-[12px] font-bold uppercase tracking-wider text-[#008751] bg-[#008751]/5 border border-[#008751]/20 rounded-full px-3 py-1 mb-4">
          {badge}
        </span>
        <h1 className="text-3xl lg:text-4xl font-extrabold text-[#0f172a] tracking-tight">
          {title}
        </h1>
        <p className="mt-3 text-[15px] lg:text-base text-[#64748B] max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      </div>
    </section>
  );
}
