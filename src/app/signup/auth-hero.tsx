import { Shield, Zap, Users } from "lucide-react";

// Panneau de branding statique — aucun state/hook requis, donc rendu côté
// serveur (pas de "use client") pour ne pas alourdir le bundle JS envoyé
// au navigateur pour /signup.
// Faits produits réels, pas des chiffres de volume : la plateforme n'a ni « 500K+ talents »
// ni note de satisfaction à revendiquer (voir la règle appliquée au Hero de l'accueil :
// un chiffre affiché doit pouvoir être recalculé). L'escrow libère les fonds après
// validation, et l'identité (KYC) est le seul fait vérifié par la plateforme.
const FEATURES = [
  { icon: <Zap className="w-4 h-4" />, label: "Paiement Mobile Money FCFA", sub: "MTN MoMo · Moov · Orange Money" },
  { icon: <Shield className="w-4 h-4" />, label: "Paiement sous séquestre", sub: "Fonds libérés après validation du travail" },
  { icon: <Users className="w-4 h-4" />, label: "Identité vérifiée (KYC)", sub: "Obligatoire avant toute mise en relation" },
];

// Sous lg (mobile, tablette), seul le bandeau titre reste : l'argumentaire complet repoussait
// le formulaire sous la ligne de flottaison (audit 2026-10-02).
export function AuthHero() {
  return (
    <div className="lg:w-[45%] xl:w-[42%] bg-[#0A1931] text-white flex flex-col justify-between p-6 md:p-10 lg:p-12 relative overflow-hidden">
      {/* Decorative gradient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-[#FF7A00]/10 blur-[80px]" />
      <div className="absolute bottom-[-10%] left-[-20%] w-[300px] h-[300px] rounded-full bg-[#008751]/10 blur-[60px]" />

      <div className="relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-5 lg:mb-16">
          <div className="w-10 h-10 rounded-xl bg-[#FF7A00] flex items-center justify-center text-white font-extrabold text-[16px]">FW</div>
          <span className="text-white font-extrabold text-[18px] tracking-tight">FlexWork</span>
        </div>

        <h1 className="text-[24px] md:text-[34px] lg:text-[38px] font-extrabold leading-tight lg:mb-4">
          Le talent <span className="text-[#FF7A00]">vérifié</span>,<br />
          la mission <span className="text-[#FCD116]">sécurisée</span>
        </h1>
        <p className="hidden lg:block text-white/60 text-[15px] leading-relaxed max-w-[420px] mb-8">
          Identité vérifiée avant toute mise en relation. Contrat signé, paiement sous
          séquestre en FCFA.
        </p>

        {/* Feature pills */}
        <div className="hidden lg:block space-y-4">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.05] border border-white/[0.06]">
              <div className="w-8 h-8 rounded-full bg-[#FF7A00]/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[#FF7A00]">{f.icon}</span>
              </div>
              <div>
                <div className="text-[13px] font-semibold">{f.label}</div>
                <div className="text-[12px] text-white/60 mt-0.5">{f.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Parcours réel — pas de témoignage ni de chiffre inventé ici.
          Remis à jour le 2026-09-23 (« Option C ») : l'inscription ne demande plus de choisir
          une filière, et le KYC n'est plus présenté comme une étape d'entrée mais comme la
          condition de la mise en relation — ce qu'il est réellement (§9). */}
      <div className="hidden lg:block relative z-10 mt-8 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
        <p className="text-[12px] font-semibold text-white/80 mb-2">Comment ça se passe</p>
        <ol className="space-y-1.5 text-[12px] text-white/70">
          <li>1. Crée ton compte — sans choisir de rôle</li>
          <li>2. Publie une mission, ou propose tes services quand tu veux</li>
          <li>3. Vérifie ton identité (KYC) avant la mise en relation</li>
        </ol>
      </div>

      {/* Footer */}
      <div className="hidden lg:flex relative z-10 mt-6 items-center gap-2 text-[12px] text-white/50">
        <span>© 2026 FlexWork</span> <span>•</span> <span>Identité vérifiée</span> <span>•</span> <span>Paiement sous séquestre</span>
      </div>
    </div>
  );
}
