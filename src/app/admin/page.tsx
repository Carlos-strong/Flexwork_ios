"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Award, BadgeCheck, Briefcase, Check, Eye, Flag, History, Kanban, LayoutDashboard, LogOut, Menu,
  PhoneOff, PhoneCall, Scale, ShieldCheck, Trash2, Users, X, type LucideIcon
} from "lucide-react";
import { KycDocsViewer } from "@/components/admin/KycDocsViewer";
import { CHANTIER_ROLES } from "@/lib/age-gate";

// --------------- helpers ---------------
const GREEN = "#008751", YELLOW = "#FCD116", RED = "#E8112D";

// Item du sidebar admin — `href` optionnel : si présent, l'entrée est un lien (ex. vers la
// page dédiée /admin/kyc/historique) au lieu d'une section interne.
type NavGroupItem = { id: string; label: string; icon: LucideIcon; count: number; href?: string };

// Les 11 statuts réels de Mission.status (prisma/schema.prisma) — remplace l'ancien
// Kanban "16 colonnes" fictif (retraits, sessions de formation, visites techniques...
// concepts jamais implémentés côté schéma/API, v2 non migré vers le pivot v3).
const MISSION_STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  publiee: "Publiée",
  proposition_acceptee: "Proposition acceptée",
  contrat_genere: "Contrat généré",
  contrat_signe: "Contrat signé",
  fonds_sous_sequestre: "Fonds sous séquestre",
  en_cours: "En cours",
  livrable_soumis: "Livrable soumis",
  validee: "Validée",
  cloturee: "Clôturée",
  mediation_ouverte: "Médiation ouverte",
};
const MISSION_STATUS_ORDER = Object.keys(MISSION_STATUS_LABELS);

// UserRole (prisma/schema.prisma) — libellé court affiché dans la colonne Profil.
const KYC_STATUS_LABELS: Record<string, string> = {
  non_soumis: "Non soumis",
  en_attente: "En attente",
  verifie: "Vérifié",
  rejete: "Rejeté",
};

const ROLE_LABELS: Record<string, string> = {
  client: "Client",
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
};

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="w-full h-full rounded-full flex items-center justify-center text-white font-bold border-2 border-white shadow-sm"
        style={{ fontSize: size * 0.38, background: `linear-gradient(135deg, ${GREEN} 0%, #0ab46a 40%, ${YELLOW} 100%)` }}>
        {initials || "?"}
      </span>
    </span>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => { if (!disabled) onChange(!checked); }} disabled={disabled}
      className={`relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-all shrink-0 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${checked ? "bg-[#008751]" : "bg-gray-200"}`}>
      <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[20px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

function StatCard({ label, value, sub, border }: { label: string; value: string | number; sub?: string; border: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: border }} />
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-[22px] font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-5 py-8 text-center text-[12px] text-gray-400">{text}</div>;
}

// Remplace window.prompt() — invisible dans certains navigateurs/contextes embarqués et
// hors charte graphique — par un vrai formulaire modal, pour saisir la justification
// obligatoire (US-202/US-602) exigée par les routes de décision KYC/médiation.
function DecisionModal({
  title, fields, onCancel, onSubmit, danger,
}: {
  title: string;
  fields: { key: string; label: string; type: "text" | "textarea" | "date"; required?: boolean; placeholder?: string }[];
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
  danger?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = fields.some(f => f.required && !values[f.key]?.trim());
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold">{title}</h3>
        <div className="space-y-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                {f.label}{f.required && <span className="text-red-600"> *</span>}
              </label>
              {f.type === "textarea" ? (
                <textarea rows={3} placeholder={f.placeholder} value={values[f.key] ?? ""}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
              ) : f.type === "date" ? (
                <input type="date" value={values[f.key] ?? ""}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
              ) : (
                <input type="text" placeholder={f.placeholder} value={values[f.key] ?? ""}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]" />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onCancel} className="h-9 px-4 rounded-full border border-gray-200 text-[13px] font-medium hover:bg-gray-50">Annuler</button>
          <button onClick={() => !missing && onSubmit(values)} disabled={missing}
            className={`h-9 px-4 rounded-full text-white text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${danger ? "bg-red-600 hover:bg-red-700" : "bg-[#008751] hover:bg-[#006e43]"}`}>
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- API types ----
type KanbanMission = { id: string; titre: string; status: string; budget: number; client: { email: string }; mediationEnCours: boolean };
type KycEntry = { userId: string; email: string; tel: string; role: string; isAdmin: boolean; adminRole: string | null; garantRequired: boolean; createdAt: string; documents: { id: string; type: string; status: string }[] };
// Comptes de filière chantier (tous statuts KYC) pilotables pour « garant requis » —
// GET /api/admin/kyc/garant-accounts. La file KYC ne contient que les dossiers en attente,
// alors que candidater exige un KYC vérifié : le drapeau doit rester accessible après
// validation du dossier.
type GarantAccount = { userId: string; email: string; tel: string; role: string; kycStatus: string; garantRequired: boolean; garantRequiredSetAt: string | null; garantRequiredSetByEmail: string | null };
type GarantEntry = { id: string; nom: string; tel: string; obligatoire: boolean; manoeuvre: { email: string; tel: string; country: string | null } };
type MediationEntry = { id: string; reason: string; proposedResolution: string | null; openedBy: string; mission: { id: string; titre: string } };
type FeatureFlagEntry = { id: string; key: string; zone: string; enabled: boolean; note: string | null };
type CollusionSuspect = { clientId: string; providerId: string; transactionCount: number };

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// --------------- Main Dashboard ---------------
export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [kanban, setKanban] = useState<KanbanMission[]>([]);
  const [kyc, setKyc] = useState<KycEntry[]>([]);
  const [garants, setGarants] = useState<GarantEntry[]>([]);
  const [garantAccounts, setGarantAccounts] = useState<GarantAccount[]>([]);
  const [mediations, setMediations] = useState<MediationEntry[]>([]);
  const [flags, setFlags] = useState<FeatureFlagEntry[]>([]);
  const [collusion, setCollusion] = useState<CollusionSuspect[]>([]);

  const [kycModal, setKycModal] = useState<{ userId: string; decisionStatus: "verifie" | "rejete"; role?: string } | null>(null);
  // Compte dont le toggle « Garant requis » est en cours (POST .../garant-requirement).
  const [garantToggling, setGarantToggling] = useState<string | null>(null);
  // Visualiseur/lecteur des documents KYC d'un dossier (vignettes + plein écran).
  const [viewingDocs, setViewingDocs] = useState<{ userId: string; email: string } | null>(null);
  const [mediationModal, setMediationModal] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ userId: string; email: string } | null>(null);

  const notify = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [k, ky, ga, g, m, f, c] = await Promise.all([
      fetchJson<{ items: KanbanMission[] }>("/api/admin/missions/kanban"),
      fetchJson<{ items: KycEntry[] }>("/api/admin/kyc/queue"),
      fetchJson<{ items: GarantAccount[] }>("/api/admin/kyc/garant-accounts"),
      fetchJson<{ items: GarantEntry[] }>("/api/admin/garants/queue"),
      fetchJson<{ items: MediationEntry[] }>("/api/admin/mediations/queue"),
      fetchJson<{ items: FeatureFlagEntry[] }>("/api/admin/feature-flags"),
      fetchJson<{ items: CollusionSuspect[] }>("/api/admin/fraud/collusion"),
    ]);
    setKanban(k?.items ?? []);
    setKyc(ky?.items ?? []);
    setGarantAccounts(ga?.items ?? []);
    setGarants(g?.items ?? []);
    setMediations(m?.items ?? []);
    setFlags(f?.items ?? []);
    setCollusion(c?.items ?? []);
    setLoading(false);
  }, []);

  // Auth guard
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") loadAll(); }, [status, loadAll]);

  if (status === "loading") return <div className="min-h-screen bg-zinc-50 flex items-center justify-center"><div className="text-[14px] text-zinc-500">Chargement...</div></div>;
  if (status === "unauthenticated") return null;

  // ---- decision actions (appels API réels) ----
  async function submitKycDecision(values: Record<string, string>) {
    if (!kycModal) return;
    const { userId, decisionStatus } = kycModal;
    setKycModal(null);
    const res = await fetch(`/api/admin/kyc/${userId}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: decisionStatus, justification: values.justification, rejectionReason: values.rejectionReason, dateNaissance: values.dateNaissance || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify(
        data.error === "date_naissance_required"
          ? "Date de naissance obligatoire pour cette filière chantier (A13) — saisissez-la avant de valider."
          : data.error === "forbidden_wrong_admin_role"
            ? "Refusé : ce compte n'a pas le rôle admin \"kyc\" requis."
            : `Échec : ${data.error ?? res.status}`
      );
      return;
    }
    notify(`KYC ${decisionStatus === "verifie" ? "validé" : "rejeté"}`);
    loadAll();
  }

  // Active/désactive « Garant requis » (User.garantRequired, défaut OFF) — réservé aux
  // filières chantier (le serveur refuse sinon). La file reflète l'état après loadAll().
  async function toggleGarantRequirement(userId: string, role: string, current: boolean) {
    // Garde côté client : le serveur refuse déjà (400 not_chantier_role), inutile d'y aller.
    if (!(CHANTIER_ROLES as readonly string[]).includes(role)) {
      notify("Exigence de garant réservée aux filières chantier.");
      return;
    }
    setGarantToggling(userId);
    const res = await fetch(`/api/admin/kyc/${userId}/garant-requirement`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ garantRequired: !current }),
    });
    setGarantToggling(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify(data.error === "not_chantier_role" ? "Exigence de garant réservée aux filières chantier." : `Échec : ${data.error ?? res.status}`);
      return;
    }
    notify(`Exigence de garant ${!current ? "activée" : "désactivée"} pour ce compte.`);
    loadAll();
  }

  async function decideGarant(id: string, statutAppel: "confirme" | "injoignable") {
    const res = await fetch(`/api/admin/garants/${id}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statutAppel }),
    });
    if (!res.ok) { notify("Échec de l'enregistrement de l'appel garant."); return; }
    notify(`Garant marqué : ${statutAppel === "confirme" ? "confirmé" : "injoignable"}`);
    loadAll();
  }

  async function submitMediationProposal(values: Record<string, string>) {
    if (!mediationModal) return;
    const id = mediationModal;
    setMediationModal(null);
    const res = await fetch(`/api/admin/mediations/${id}/propose`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposedResolution: values.proposedResolution, justification: values.justification }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify(data.error === "forbidden_wrong_admin_role" ? "Refusé : ce compte n'a pas le rôle admin \"mediation\" requis." : `Échec : ${data.error ?? res.status}`);
      return;
    }
    notify("Résolution proposée");
    loadAll();
  }

  async function submitDeleteUser(values: Record<string, string>) {
    if (!deleteModal) return;
    const { userId, email } = deleteModal;
    if (values.confirmEmail?.trim() !== email) {
      notify("Email de confirmation incorrect — suppression annulée.");
      return;
    }
    setDeleteModal(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification: values.justification }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify(`Échec de la suppression : ${data.error ?? res.status}`);
      return;
    }
    notify(`Compte ${email} supprimé`);
    loadAll();
  }

  async function toggleFlag(key: string, zone: string, enabled: boolean) {
    const res = await fetch("/api/admin/feature-flags", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, zone, enabled }),
    });
    if (!res.ok) { notify("Échec de la mise à jour du flag."); return; }
    notify(`${key} (${zone}) : ${enabled ? "activé" : "désactivé"}`);
    loadAll();
  }

  const kanbanByStatus = MISSION_STATUS_ORDER.map(s => ({
    status: s, label: MISSION_STATUS_LABELS[s], items: kanban.filter(m => m.status === s),
  }));

  const activeMissions = kanban.filter(m => m.status !== "brouillon" && m.status !== "cloturee").length;

  const navGroups: Array<{ title: string; items: NavGroupItem[] }> = [
    {
      title: "Pilotage", items: [
        { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard, count: 0 },
        { id: "kanban", label: `Kanban missions (${MISSION_STATUS_ORDER.length} statuts)`, icon: Kanban, count: 0 },
        { id: "flags", label: "Filières & Activation", icon: Flag, count: flags.length },
      ]
    },
    {
      title: "Vérifications", items: [
        { id: "kyc", label: "KYC & Identité", icon: BadgeCheck, count: kyc.length },
        { id: "kyc_historique", label: "Histo. validations", icon: History, href: "/admin/kyc/historique", count: 0 },
        { id: "garants", label: "Garants Manœuvre", icon: Users, count: garants.length },
      ]
    },
    {
      title: "Confiance", items: [
        { id: "litiges", label: "Médiations", icon: Scale, count: mediations.length },
        { id: "antifraude", label: "Anti-collusion", icon: ShieldCheck, count: collusion.length },
      ]
    },
  ];

  const selectSection = (id: string) => {
    setActiveSection(id);
    setSidebarOpen(false);
  };

  const activeLabel = navGroups.flatMap(g => g.items).find(i => i.id === activeSection)?.label ?? "";

  return (
    <div className="min-h-screen bg-[#f9fafb] text-gray-900 antialiased" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white px-4 py-2.5 rounded-full text-sm font-medium shadow-2xl flex items-center gap-2 max-w-[90vw]">
          <span className="w-2 h-2 rounded-full bg-[#FCD116] animate-pulse shrink-0" />{toast}
        </div>
      )}

      <div className="flex">
        {/* ---- Sidebar ---- */}
        <aside className={`fixed lg:sticky top-0 z-40 h-screen bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 w-[300px] shrink-0 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:h-screen overflow-hidden`}>
          <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${GREEN} 0%, ${YELLOW} 50%, ${RED} 100%)` }} />
          <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-[13px] shadow-sm"
                style={{ background: `linear-gradient(135deg, ${GREEN}, ${YELLOW})` }}>SA</div>
              <div className="leading-tight">
                <div className="font-bold text-[14px] tracking-tight">FlexWork</div>
                <div className="text-[11px] text-gray-500 font-medium">Espace Admin</div>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
            {navGroups.map(group => (
              <div key={group.title}>
                <div className="px-2 mb-2 text-[10px] font-bold tracking-[0.12em] uppercase text-gray-400">{group.title}</div>
                <ul className="space-y-0.5">
                  {group.items.map(item => {
                    const active = activeSection === item.id;
                    const classes = `group w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all text-left ${active ? "text-white shadow-sm" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`;
                    const style = active ? { background: GREEN } : undefined;
                    const inner = (
                      <>
                        <span className="flex items-center gap-2.5">
                          <item.icon size={16} className={active ? "text-white" : "text-gray-400 group-hover:text-gray-600"} />
                          {item.label}
                        </span>
                        {item.count > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                            style={{ background: item.count > 3 ? RED : YELLOW, color: item.count > 3 ? "white" : "#7a5a00" }}>{item.count}</span>
                        )}
                      </>
                    );
                    if (item.href) {
                      return (
                        <li key={item.id}>
                          <Link href={item.href} onClick={() => setSidebarOpen(false)} className={classes} style={{ textDecoration: "none", ...style }}>{inner}</Link>
                        </li>
                      );
                    }
                    return (
                      <li key={item.id}>
                        <button onClick={() => selectSection(item.id)} className={classes} style={style}>{inner}</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-gray-100 bg-white space-y-2">
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-[#f9fafb] border border-gray-100">
              <Avatar name={session?.user?.email ?? "Admin"} size={36} />
              <div className="leading-tight flex-1 min-w-0">
                <div className="text-[12px] font-bold truncate">{session?.user?.email ?? "Admin FlexWork"}</div>
                <div className="text-[11px] text-gray-500">Espace Admin</div>
              </div>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-[12px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
            >
              <LogOut size={15} />
              Déconnexion
            </button>
          </div>
        </aside>

        {/* ---- Main ---- */}
        <main className="flex-1 min-w-0">
          <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-gray-200">
            <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${GREEN} 0%, ${YELLOW} 50%, ${RED} 100%)` }} />
            <div className="px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg border border-gray-200 bg-white"><Menu size={18} /></button>
                <div className="min-w-0">
                  <h1 className="text-[18px] lg:text-[20px] font-extrabold tracking-tight">{activeLabel || "Tableau de bord Admin"}</h1>
                  <div className="text-[12px] text-gray-500 font-medium">Données en direct — Prisma/PostgreSQL</div>
                </div>
              </div>
              <button onClick={() => loadAll()} className="h-8 px-3 rounded-full border border-gray-200 bg-white text-[12px] font-medium hover:bg-gray-50">
                {loading ? "Actualisation..." : "Actualiser"}
              </button>
            </div>
          </div>

          <div className="px-4 lg:px-8 py-6 space-y-10">
            {/* Overview */}
            {activeSection === "overview" && (
            <section id="overview" className="scroll-mt-24 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label="Missions actives" value={activeMissions} sub={`${kanban.length} au total`} border={GREEN} />
                <StatCard label="KYC en attente" value={kyc.length} border={kyc.length > 3 ? RED : YELLOW} />
                <StatCard label="Garants à confirmer" value={garants.length} border={garants.length > 0 ? RED : GREEN} />
                <StatCard label="Médiations ouvertes" value={mediations.length} border={mediations.length > 0 ? RED : GREEN} />
              </div>
              <p className="text-[11px] text-gray-400">
                Chiffre d&apos;affaires / commissions non affichés : aucun modèle de facturation plateforme dans le schéma v3 (le PSP détient l&apos;escrow, modele-skillafrica-v3-Flexwork.md §6).
              </p>
            </section>
            )}

            {activeSection === "kanban" && (
            <section id="kanban" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[14px] font-bold">Kanban missions — {MISSION_STATUS_ORDER.length} statuts réels</h2>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#008751] text-white font-bold">{kanban.length} missions</span>
                </div>
                <div className="p-3 overflow-x-auto pb-2">
                  <div className="flex gap-3 min-w-max">
                    {kanbanByStatus.map(col => (
                      <div key={col.status} className={`w-[220px] shrink-0 rounded-xl border ${col.status === "mediation_ouverte" ? "bg-red-50/60 border-red-200" : "bg-[#f9fafb] border-gray-200"}`}>
                        <div className="px-3 py-2.5 flex items-center justify-between border-b border-gray-200/70">
                          <span className="text-[11px] font-bold truncate">{col.label}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                            style={{ background: col.items.length ? GREEN : "#e5e7eb", color: col.items.length ? "white" : "#6b7280" }}>{col.items.length}</span>
                        </div>
                        <div className="p-2 space-y-2 min-h-[80px]">
                          {col.items.map(m => (
                            <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono font-bold text-gray-500">#{m.id.slice(0, 8)}</span>
                                {m.mediationEnCours && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white">⚠ Litige</span>}
                              </div>
                              <div className="mt-1 text-[12px] font-semibold leading-tight line-clamp-2">{m.titre}</div>
                              <div className="mt-1 text-[11px] text-gray-500 truncate">{m.client.email}</div>
                              <div className="mt-1 text-[11px] font-bold text-gray-700">{m.budget > 0 ? `${m.budget.toLocaleString("fr-FR")} XOF` : "—"}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSection === "flags" && (
            <section id="flags" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[14px] font-bold">Filières & Activation</h2>
                  <span className="text-[11px] text-gray-500">FeatureFlag (clé × zone)</span>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-[12px] text-gray-500 max-w-2xl">
                    Activation manuelle après signature effective d&apos;un partenaire dans la zone — jamais automatique.
                  </p>
                  {flags.length === 0 ? (
                    <EmptyState text="Aucun feature flag enregistré pour l'instant." />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {flags.map(f => (
                        <div key={f.id} className="rounded-xl border p-3.5 bg-white" style={{ borderTop: `3px solid ${f.enabled ? GREEN : "#d1d5db"}` }}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-[12px] font-bold">{f.key}</div>
                              <div className="text-[11px] text-gray-500">{f.zone}</div>
                            </div>
                            <Toggle checked={f.enabled} onChange={v => toggleFlag(f.key, f.zone, v)} />
                          </div>
                          {f.note && <div className="mt-2 text-[11px] text-gray-500">{f.note}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
            )}

            {activeSection === "kyc" && (
            <section id="kyc" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold">Vérifications KYC en attente</h2>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-red-600 text-white font-bold">{kyc.length} dossiers</span>
                </div>
                {kyc.length === 0 ? <EmptyState text="Aucun dossier KYC en attente." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-[#f9fafb] text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <tr><th className="px-4 py-2.5">Utilisateur</th><th className="px-4 py-2.5">Profil</th><th className="px-4 py-2.5">Documents</th><th className="px-4 py-2.5">Déposé</th><th className="px-4 py-2.5">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-[12px]">
                        {kyc.map(r => {
                          const allVerified = r.documents.length > 0 && r.documents.every((d) => d.status === "verifie");
                          return (
                          <tr key={r.userId}>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-medium"><Avatar name={r.email} size={24} /> {r.email}</span></td>
                            <td className="px-4 py-3">
                              <a href={`/profil/${r.userId}`} target="_blank" rel="noreferrer"
                                className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                                {r.isAdmin ? `Admin (${r.adminRole ?? "?"})` : ROLE_LABELS[r.role] ?? r.role}
                              </a>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{r.documents.map(d => d.type).join(", ") || "—"}</td>
                            <td className="px-4 py-3 text-gray-600">{new Date(r.createdAt).toLocaleDateString("fr-FR")}</td>
                            <td className="px-4 py-3 flex flex-wrap gap-1.5">
                              <button
                                onClick={() => toggleGarantRequirement(r.userId, r.role, r.garantRequired)}
                                disabled={garantToggling === r.userId || !(CHANTIER_ROLES as readonly string[]).includes(r.role)}
                                title={(CHANTIER_ROLES as readonly string[]).includes(r.role) ? (r.garantRequired ? "Désactiver l'exigence de garant (présentiel/hybride)" : "Activer l'exigence de garant (présentiel/hybride)") : "Réservé aux filières chantier (artisan, manœuvre, expert BTP)"}
                                className={`h-7 px-2.5 rounded-full text-[10.5px] font-semibold border transition-colors disabled:opacity-50 ${r.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"} ${!(CHANTIER_ROLES as readonly string[]).includes(r.role) ? "opacity-40 cursor-not-allowed" : ""}`}
                              >
                                {garantToggling === r.userId ? "…" : r.garantRequired ? "Garant ON" : "Garant OFF"}
                              </button>
                              <button onClick={() => setViewingDocs({ userId: r.userId, email: r.email })} title="Voir les documents"
                                className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center hover:bg-gray-200 transition-colors">
                                <Eye size={14} />
                              </button>
                              <button onClick={() => setKycModal({ userId: r.userId, decisionStatus: "verifie", role: r.role })} disabled={!allVerified}
                                title={allVerified ? "Valider le KYC" : "Validez d'abord chaque document individuellement (bouton 👁)"}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${allVerified ? "bg-[#008751] text-white hover:bg-[#006e43] cursor-pointer" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}>
                                <Check size={14} />
                              </button>
                              <button onClick={() => setKycModal({ userId: r.userId, decisionStatus: "rejete", role: r.role })} title="Rejeter le KYC"
                                className="w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 transition-colors">
                                <X size={14} />
                              </button>
                              <button onClick={() => setDeleteModal({ userId: r.userId, email: r.email })} title="Supprimer le compte"
                                className="w-7 h-7 rounded-full border border-red-200 text-red-700 flex items-center justify-center hover:bg-red-50 transition-colors">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Exigence de garant, compte par compte — indépendante de la file ci-dessus :
                  candidater exige un KYC vérifié, donc les comptes concernés en sont sortis. */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-[13px] font-bold">Exigence de garant — filière chantier</h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">Désactivée par défaut. Une fois activée, le compte doit avoir un garant obligatoire pour candidater en présentiel ou hybride.</p>
                  </div>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-bold">{garantAccounts.filter(a => a.garantRequired).length} / {garantAccounts.length} actives</span>
                </div>
                {garantAccounts.length === 0 ? <EmptyState text="Aucun compte de filière chantier." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-[#f9fafb] text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <tr><th className="px-4 py-2.5">Compte</th><th className="px-4 py-2.5">Filière</th><th className="px-4 py-2.5">KYC</th><th className="px-4 py-2.5">Garant requis</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-[12px]">
                        {garantAccounts.map(a => (
                          <tr key={a.userId}>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-medium"><Avatar name={a.email} size={24} /> {a.email}</span></td>
                            <td className="px-4 py-3 text-gray-600">{ROLE_LABELS[a.role] ?? a.role}</td>
                            <td className="px-4 py-3 text-gray-600">{KYC_STATUS_LABELS[a.kycStatus] ?? a.kycStatus}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => toggleGarantRequirement(a.userId, a.role, a.garantRequired)}
                                disabled={garantToggling === a.userId}
                                title={a.garantRequired ? "Désactiver l'exigence de garant (présentiel/hybride)" : "Activer l'exigence de garant (présentiel/hybride)"}
                                className={`h-7 px-2.5 rounded-full text-[10.5px] font-semibold border transition-colors disabled:opacity-50 ${a.garantRequired ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                              >
                                {garantToggling === a.userId ? "…" : a.garantRequired ? "Garant ON" : "Garant OFF"}
                              </button>
                              {a.garantRequired && a.garantRequiredSetAt && (
                                <div className="text-[10.5px] text-gray-400 mt-1">
                                  Activée le {new Date(a.garantRequiredSetAt).toLocaleDateString("fr-FR")}
                                  {a.garantRequiredSetByEmail ? ` par ${a.garantRequiredSetByEmail}` : ""}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            )}

            {activeSection === "garants" && (
            <section id="garants" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold">Garants Manœuvre à confirmer</h2>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-red-100 text-red-700 font-bold">{garants.length} dossiers</span>
                </div>
                {garants.length === 0 ? <EmptyState text="Aucun garant en attente d'appel." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-[#f9fafb] text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <tr><th className="px-4 py-2.5">Manœuvre</th><th className="px-4 py-2.5">Garant</th><th className="px-4 py-2.5">Tél.</th><th className="px-4 py-2.5">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-[12px]">
                        {garants.map(g => (
                          <tr key={g.id}>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-2"><Avatar name={g.manoeuvre.email} size={22} /> {g.manoeuvre.email}</span></td>
                            <td className="px-4 py-3">{g.nom} {g.obligatoire && <span className="text-[10px] text-gray-400">(obligatoire)</span>}</td>
                            <td className="px-4 py-3 font-mono text-gray-600">{g.tel}</td>
                            <td className="px-4 py-3 flex gap-1.5">
                              <button onClick={() => decideGarant(g.id, "confirme")} title="Marquer confirmé"
                                className="w-7 h-7 rounded-full bg-[#008751] text-white flex items-center justify-center hover:bg-[#006e43] transition-colors">
                                <PhoneCall size={14} />
                              </button>
                              <button onClick={() => decideGarant(g.id, "injoignable")} title="Marquer injoignable"
                                className="w-7 h-7 rounded-full bg-gray-600 text-white flex items-center justify-center hover:bg-gray-700 transition-colors">
                                <PhoneOff size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            )}

            {activeSection === "litiges" && (
            <section id="litiges" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold">Médiations en cours</h2>
                  <span className="text-[10px] font-mono px-2 py-1 rounded-full bg-gray-100">Résolution non contraignante — modele-skillafrica-v3 §9</span>
                </div>
                {mediations.length === 0 ? <EmptyState text="Aucune médiation ouverte." /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[#f9fafb] text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <tr><th className="px-4 py-2.5">Mission</th><th className="px-4 py-2.5">Motif</th><th className="px-4 py-2.5">Ouvert par</th><th className="px-4 py-2.5">Résolution proposée</th><th className="px-4 py-2.5">Action</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {mediations.map(m => (
                          <tr key={m.id}>
                            <td className="px-4 py-3 font-medium">{m.mission.titre}</td>
                            <td className="px-4 py-3">{m.reason}</td>
                            <td className="px-4 py-3 text-gray-600">{m.openedBy}</td>
                            <td className="px-4 py-3 text-gray-600">{m.proposedResolution ?? "—"}</td>
                            <td className="px-4 py-3">
                              <button onClick={() => setMediationModal(m.id)} className="px-3 py-1.5 rounded-full bg-[#008751] text-white text-[11px] font-bold hover:bg-[#006e43] transition-colors">Proposer une résolution</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            )}

            {activeSection === "antifraude" && (
            <section id="antifraude" className="scroll-mt-24">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-[14px] font-bold">Anti-collusion 🛡️</h2>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#008751] text-white font-bold">PspEscrowOperation</span>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-[12px] text-gray-500 max-w-3xl mb-2">
                    Paires client/prestataire avec opérations d&apos;escrow PSP répétées et suspectes (même device, montants ronds).
                  </p>
                  {collusion.length === 0 ? <EmptyState text="Aucune paire suspecte détectée." /> : (
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-[#f9fafb] text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        <tr><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Prestataire</th><th className="px-4 py-2.5">Transactions</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {collusion.map((c, i) => (
                          <tr key={i}>
                            <td className="px-4 py-3 font-mono text-[11px]">{c.clientId}</td>
                            <td className="px-4 py-3 font-mono text-[11px]">{c.providerId}</td>
                            <td className="px-4 py-3 font-bold">{c.transactionCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
            )}

            <div className="pb-10 flex items-center justify-center gap-2 text-[10px] text-gray-400 font-medium">
              <span className="w-6 h-1 rounded-full" style={{ background: GREEN }} />
              <span className="w-6 h-1 rounded-full" style={{ background: YELLOW }} />
              <span className="w-6 h-1 rounded-full" style={{ background: RED }} />
              <span className="ml-2">FlexWork — données en direct</span>
            </div>
          </div>
        </main>
      </div>

      {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {viewingDocs && (
        <KycDocsViewer userId={viewingDocs.userId} email={viewingDocs.email} onClose={() => setViewingDocs(null)} onDecide={() => loadAll()} />
      )}

      {kycModal && (
        <DecisionModal
          title={kycModal.decisionStatus === "verifie" ? "Valider le dossier KYC" : "Rejeter le dossier KYC"}
          // Motif obligatoire uniquement pour un rejet — valider un dossier conforme n'a pas
          // besoin d'être justifié. Aucun champ pour une validation « simple » ; en revanche,
          // une validation de filière chantier exige la date de naissance lue sur la pièce
          // (A13) — sans elle, le compte serait « verifie » mais bloqué en candidature chantier.
          fields={
            kycModal.decisionStatus === "rejete"
              ? [{ key: "rejectionReason", label: "Motif du rejet (visible par l'utilisateur)", type: "text" as const, required: true, placeholder: "Ex : photo illisible, document expiré..." }]
              : (CHANTIER_ROLES as readonly string[]).includes(kycModal.role ?? "")
                ? [{ key: "dateNaissance", label: "Date de naissance (lue sur la pièce d'identité)", type: "date" as const, required: true, placeholder: "" }]
                : []
          }
          onCancel={() => setKycModal(null)}
          onSubmit={submitKycDecision}
        />
      )}

      {mediationModal && (
        <DecisionModal
          title="Proposer une résolution de médiation"
          fields={[
            { key: "proposedResolution", label: "Résolution proposée (min. 5 caractères)", type: "textarea", required: true, placeholder: "Ex : remboursement partiel de 50%..." },
            { key: "justification", label: "Justification", type: "textarea", required: true, placeholder: "Motif de la décision, consigné dans le journal d'audit..." },
          ]}
          onCancel={() => setMediationModal(null)}
          onSubmit={submitMediationProposal}
        />
      )}

      {deleteModal && (
        <DecisionModal
          title={`Supprimer le compte ${deleteModal.email} ?`}
          fields={[
            { key: "confirmEmail", label: `Tapez "${deleteModal.email}" pour confirmer`, type: "text", required: true, placeholder: deleteModal.email },
            { key: "justification", label: "Justification", type: "textarea", required: true, placeholder: "Motif de la suppression, consigné dans le journal d'audit..." },
          ]}
          onCancel={() => setDeleteModal(null)}
          onSubmit={submitDeleteUser}
          danger
        />
      )}
    </div>
  );
}
