"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneCall, PhoneOff, RefreshCw } from "lucide-react";
import { useCanActIn } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnSecondary,
  fetchJson,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

type GarantEntry = {
  id: string;
  nom: string;
  tel: string;
  obligatoire: boolean;
  manoeuvre: { email: string; tel: string; country: string | null };
};

type GarantAccount = {
  userId: string;
  email: string;
  tel: string;
  role: string;
  kycStatus: string;
  garantRequired: boolean;
  garantRequiredSetAt: string | null;
  garantRequiredSetByEmail: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  expert_btp_autres: "Expert BTP / Autres",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
};

const KYC_LABEL: Record<string, string> = {
  en_attente: "En attente",
  verifie: "Vérifié",
  rejete: "Rejeté",
};

/**
 * Validation utilisateurs — rubrique de flexwork_job (« Validation des prestataires »).
 *
 * Ici la plateforme ne valide ni compétence ni qualification (arbitrage A11) : la seule
 * validation d'une personne qui ne soit pas le KYC est celle des PERSONNES RESSOURCES des
 * filières chantier (§1.3 de l'état consolidé : « 1 obligatoire + 2 optionnelles »). Ces deux
 * gestes — appeler un garant, exiger un garant d'un compte — relèvent du rôle KYC : ils
 * portent sur l'identité et la joignabilité de quelqu'un, pas sur son travail.
 *
 * Ils vivaient auparavant dans deux écrans : la confirmation dans le tableau de bord du
 * superviseur (qui, par le §13, ne doit rien modifier), l'exigence au bas de l'écran KYC. Ils
 * sont réunis ici, sous le rôle qui les détient.
 */
export default function ValidationUtilisateursPage() {
  const canAct = useCanActIn("validation");

  const [garants, setGarants] = useState<GarantEntry[] | null>(null);
  const [accounts, setAccounts] = useState<GarantAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [g, a] = await Promise.all([
      fetchJson<{ items: GarantEntry[] }>("/api/admin/garants/queue"),
      fetchJson<{ items: GarantAccount[] }>("/api/admin/kyc/garant-accounts"),
    ]);
    if (g.ok) setGarants(g.data.items);
    if (a.ok) setAccounts(a.data.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decideGarant(id: string, statutAppel: "confirme" | "injoignable") {
    setBusy(id);
    setFeedback(null);
    const res = await fetch(`/api/admin/garants/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statutAppel }),
    });
    setBusy(null);
    if (!res.ok) {
      setFeedback({ ok: false, text: "L’appel n’a pas pu être enregistré." });
      return;
    }
    setFeedback({ ok: true, text: statutAppel === "confirme" ? "Garant confirmé." : "Garant marqué injoignable." });
    load();
  }

  async function toggleRequirement(account: GarantAccount) {
    setBusy(account.userId);
    setFeedback(null);
    const res = await fetch(`/api/admin/kyc/${account.userId}/garant-requirement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ garantRequired: !account.garantRequired }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFeedback({
        ok: false,
        text: data.error === "not_chantier_role" ? "L’exigence de garant est réservée aux filières chantier." : "La mise à jour a échoué.",
      });
      return;
    }
    setFeedback({ ok: true, text: `Exigence de garant ${account.garantRequired ? "levée" : "activée"} pour ${account.email}.` });
    load();
  }

  const required = (accounts ?? []).filter((a) => a.garantRequired).length;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="✅"
        title="Validation utilisateurs"
        subtitle="Personnes ressources des filières chantier. La plateforme ne valide aucune compétence : elle vérifie qu’un garant existe et répond."
        readOnly={!canAct}
        actions={
          <button onClick={load} className={btnSecondary}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        }
      />

      <KpiStrip
        items={[
          { icon: "📞", label: "Garants à appeler", value: garants ? garants.length : "…", hint: "en attente de confirmation", tone: (garants?.length ?? 0) > 0 ? "amber" : "neutral" },
          { icon: "🦺", label: "Comptes chantier", value: accounts ? accounts.length : "…", hint: "tous statuts KYC" },
          { icon: "🤝", label: "Garant exigé", value: required, hint: "présentiel et hybride", tone: "blue" },
        ]}
      />

      {feedback && <AdminNotice tone={feedback.ok ? "green" : "red"}>{feedback.text}</AdminNotice>}

      <AdminCard
        title="Garants à confirmer"
        subtitle="Appeler le garant déclaré, puis consigner le résultat. Un garant injoignable ne bloque pas le compte : il ne compte simplement pas."
        padded={false}
      >
        {garants === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : garants.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun garant en attente d’appel.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Prestataire</th>
                  <th className={tableHead}>Garant</th>
                  <th className={tableHead}>Téléphone</th>
                  <th className={`${tableHead} text-right`}>{canAct ? "Résultat de l’appel" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {garants.map((g) => (
                  <tr key={g.id}>
                    <td className={tableCell}>
                      {g.manoeuvre.email}
                      <div className="text-[11px] text-[#9C9A95]">{g.manoeuvre.tel}</div>
                    </td>
                    <td className={tableCell}>
                      {g.nom}
                      {g.obligatoire && <span className="ml-1.5 text-[10.5px] text-[#9C9A95]">(obligatoire)</span>}
                    </td>
                    <td className={`${tableCell} font-mono text-[12px]`}>{g.tel}</td>
                    <td className={`${tableCell} text-right`}>
                      {canAct && (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => decideGarant(g.id, "confirme")}
                            disabled={busy === g.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1A7A4A] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                          >
                            <PhoneCall size={13} /> Confirmé
                          </button>
                          <button
                            onClick={() => decideGarant(g.id, "injoignable")}
                            disabled={busy === g.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E0D9] bg-white px-3 text-[12px] font-medium text-[#5A5750] disabled:opacity-50"
                          >
                            <PhoneOff size={13} /> Injoignable
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminCard
        id="exigence"
        title="Exigence de garant"
        subtitle="Désactivée par défaut. Activée sur un compte, elle oblige à déclarer un garant pour candidater en présentiel ou en hybride — sans effet à distance, ni sur l’expert digital."
        padded={false}
      >
        {accounts === null ? (
          <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
        ) : accounts.length === 0 ? (
          <div className="p-5">
            <AdminEmpty>Aucun compte de filière chantier.</AdminEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                <tr>
                  <th className={tableHead}>Compte</th>
                  <th className={tableHead}>Filière</th>
                  <th className={tableHead}>KYC</th>
                  <th className={tableHead}>Garant exigé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E0D9]">
                {accounts.map((a) => (
                  <tr key={a.userId}>
                    <td className={tableCell}>
                      {a.email}
                      <div className="text-[11px] text-[#9C9A95]">{a.tel}</div>
                    </td>
                    <td className={tableCell}>{ROLE_LABEL[a.role] ?? a.role}</td>
                    <td className={tableCell}>{KYC_LABEL[a.kycStatus] ?? a.kycStatus}</td>
                    <td className={tableCell}>
                      {canAct ? (
                        <button
                          onClick={() => toggleRequirement(a)}
                          disabled={busy === a.userId}
                          className={`inline-flex h-8 items-center rounded-lg border px-3 text-[12px] font-semibold disabled:opacity-50 ${
                            a.garantRequired
                              ? "border-[#9FD4B4] bg-[#E6F5EE] text-[#1A7A4A]"
                              : "border-[#E2E0D9] bg-white text-[#5A5750]"
                          }`}
                        >
                          {busy === a.userId ? "…" : a.garantRequired ? "● Exigé" : "○ Non exigé"}
                        </button>
                      ) : (
                        <span className="text-[12.5px] text-[#5A5750]">{a.garantRequired ? "● Exigé" : "○ Non exigé"}</span>
                      )}
                      {a.garantRequired && a.garantRequiredSetAt && (
                        <div className="mt-1 text-[11px] text-[#9C9A95]">
                          depuis le {new Date(a.garantRequiredSetAt).toLocaleDateString("fr-FR")}
                          {a.garantRequiredSetByEmail ? ` · ${a.garantRequiredSetByEmail}` : ""}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
