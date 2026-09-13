import type { Metadata } from "next";
import { PageHero } from "@/components/public/PageHero";

export const metadata: Metadata = { title: "Contact — FlexWork" };

const CANAUX = [
  { t: "Support client", d: "questions@flexwork.bj", icon: "✉️" },
  { t: "WhatsApp", d: "+229 01 00 00 00 00", icon: "💬" },
  { t: "Signalement", d: "Un comportement suspect ou une fausse déclaration ? Utilisez la page Signalement.", icon: "🚩", href: "/signalement" },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        badge="Contact"
        title="Une question ? Parlons-en."
        subtitle="Notre équipe basée à Cotonou vous répond. Pour un litige en cours, passez d'abord par la médiation de votre mission."
      />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 lg:py-16 space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          {CANAUX.map((c) => (
            <div key={c.t} className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
              <div className="text-2xl mb-2">{c.icon}</div>
              <h3 className="font-bold text-[#0f172a] text-sm">{c.t}</h3>
              {c.href ? (
                <a href={c.href} className="text-sm text-[#008751] hover:underline mt-1 inline-block">{c.d}</a>
              ) : (
                <p className="text-sm text-[#64748B] mt-1">{c.d}</p>
              )}
            </div>
          ))}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 lg:p-8">
          <h2 className="font-bold text-[#0f172a] mb-4">Envoyer un message</h2>
          <form className="space-y-4" action="mailto:questions@flexwork.bj" method="post" encType="text/plain">
            <div className="grid sm:grid-cols-2 gap-4">
              <input required name="nom" placeholder="Votre nom" className="h-11 px-4 rounded-lg border border-[#E2E8F0] text-sm outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
              <input required type="email" name="email" placeholder="Votre e-mail" className="h-11 px-4 rounded-lg border border-[#E2E8F0] text-sm outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
            </div>
            <textarea required name="message" rows={5} placeholder="Votre message" className="w-full p-4 rounded-lg border border-[#E2E8F0] text-sm outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
            <button type="submit" className="h-11 px-6 rounded-lg bg-[#008751] text-white text-sm font-semibold hover:bg-[#006e43] transition">
              Envoyer
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
