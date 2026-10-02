"use client";

// Onglet 5 — Configuration (15 % du profil prestataire).
//
// Critères du barème : l'unité de tarif. La DEVISE n'y compte pas : elle a une valeur par
// défaut (XOF) et compter un champ pré-rempli offrirait un point gratuit à un profil vide —
// exactement ce que le barème client refuse. Elle reste éditable, elle n'est simplement pas
// un critère.
//
// Le MONTANT (tarif indicatif) est facultatif et hors barème : le formulaire le dit lui-même,
// « on peut répondre à une demande de devis sans tarif fixe ». Un barème qui l'exigerait
// contredirait cette règle.
//
// Les notifications sont annoncées mais non configurables : le modèle de données n'a aucun
// réglage de préférence, et une case à cocher sans effet serait une promesse en l'air.

import { useState } from "react";
import { CURRENCIES } from "@/lib/currencies";
import { MODE_CONTACTS, TARIF_UNITES } from "@/lib/provider-options";
import {
  Field,
  ProfileCard,
  SaveRow,
  inputClass,
  PROFILE_ERROR_MESSAGES,
  type ProviderProfile,
} from "@/components/profile/profile-shared";

export function ConfigurationTab({
  profile,
  onSaved,
}: {
  profile: ProviderProfile | null;
  onSaved: (profile: ProviderProfile) => void;
}) {
  const [currency, setCurrency] = useState(profile?.currency ?? "XOF");
  const [tarifUnite, setTarifUnite] = useState(profile?.tarifUnite ?? "");
  // Canal de contact préféré. C'est une PRÉFÉRENCE, pas une autorisation : aucun numéro ni
  // email n'est exposé au client par ce réglage. « Via FlexWork uniquement » reste la valeur
  // la plus sûre, et la seule qui n'ouvre rien du tout.
  const [modeContact, setModeContact] = useState(profile?.modeContact ?? "");
  const [indicativeRate, setIndicativeRate] = useState(
    profile?.indicativeRate ? String(profile.indicativeRate) : "",
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const tarifLabel = TARIF_UNITES.find((u) => u.value === tarifUnite)?.label.toLowerCase() ?? "";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency,
        tarifUnite: tarifUnite || undefined,
        modeContact: modeContact || undefined,
        // Le schéma exige un montant STRICTEMENT positif : vider le champ (ou saisir 0) doit
        // donc omettre la clé plutôt que d'envoyer une valeur refusée.
        indicativeRate: indicativeRate && Number(indicativeRate) > 0 ? Number(indicativeRate) : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(await res.json());
      setMsg({ text: "Configuration enregistrée.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({
      text:
        PROFILE_ERROR_MESSAGES[data.error] ??
        (res.status >= 500 ? "Erreur serveur inattendue — réessayez dans un instant." : "Échec de l'enregistrement."),
      ok: false,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ProfileCard title="Devise" description="La devise dans laquelle vous facturez.">
        <Field label="Devise" htmlFor="currency">
          <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </ProfileCard>

      <ProfileCard title="Tarifs" description="Facultatif. Vous pouvez répondre à une demande de devis sans tarif fixe.">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Unité de tarif" htmlFor="tarifUnite">
            <select
              id="tarifUnite"
              value={tarifUnite}
              onChange={(e) => setTarifUnite(e.target.value)}
              className={inputClass}
            >
              <option value="">Non précisée</option>
              {TARIF_UNITES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={tarifLabel ? `Tarif indicatif (${currency} / ${tarifLabel})` : "Tarif indicatif"}
            htmlFor="indicativeRate"
            hint="Indicatif : il n'est jamais imposé au client, il sert de repère."
          >
            <input
              id="indicativeRate"
              type="number"
              min={1}
              value={indicativeRate}
              onChange={(e) => setIndicativeRate(e.target.value)}
              className={inputClass}
              placeholder="5000"
            />
          </Field>
        </div>
        <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-[12px] text-zinc-500">
          Le tarif n&apos;est pas obligatoire. Vous pouvez répondre à une demande de devis sans tarif fixe.
        </p>
      </ProfileCard>

      <ProfileCard
        title="Contact"
        description="Par quel canal un client peut vous joindre. Une préférence, pas une autorisation : aucun contact direct n'est ouvert par ce réglage."
      >
        <Field label="Mode de contact" htmlFor="modeContact">
          <select
            id="modeContact"
            value={modeContact}
            onChange={(e) => setModeContact(e.target.value)}
            className={inputClass}
          >
            <option value="">Non précisé</option>
            {MODE_CONTACTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </ProfileCard>

      <ProfileCard title="Notifications" description="Toutes les notifications sont activées.">
        <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-800">
          La configuration des préférences de notification n&apos;est pas encore disponible. Tous les événements vous
          sont notifiés par e-mail et dans la cloche de notification.
        </p>
      </ProfileCard>

      <SaveRow saving={saving} message={msg} />
    </form>
  );
}
