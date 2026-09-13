import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireProposalParty } from "@/lib/resource-guard";
import { buildDevisDocument, type DevisDocument } from "@/lib/devis-document";
import type { DevisData } from "@/lib/devis";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  CONTENT_W,
  DARK,
  GREY,
  PdfCanvas,
  formatDateLong,
  widthsFor,
} from "@/lib/pdf-kit";

export const dynamic = "force-dynamic";

// Export documentaire du DEVIS — réservé au client de la mission et au prestataire auteur de
// la proposition (404 pour un tiers, y compris un autre candidat : voir requireProposalParty).
// Format HTML (autonome, imprimable) ou PDF (pdf-lib), exactement comme l'export du contrat
// (.../contract/document) dont il reprend le moteur de mise en page (src/lib/pdf-kit.ts) et
// la source de vérité unique (src/lib/devis-document.ts, partagée avec l'écran).
//
// Le document porte son propre état : un devis validé s'imprime « Devis définitif », un devis
// encore en négociation le dit en toutes lettres. On ne refuse pas l'export d'un devis non
// validé — le prestataire a de bonnes raisons d'imprimer son chiffrage avant de l'envoyer —
// mais aucun document ne peut laisser croire à un accord qui n'existe pas.

/** Validité d'un prix chiffré, en jours pleins à compter de la validation par le client. */
const VALIDITE_JOURS = 30;

const ROLE_LABELS: Record<string, string> = {
  client: "Client",
  expert_digital: "Expert digital — travailleur indépendant",
  expert_btp_autres: "Expert BTP — travailleur indépendant",
  artisan: "Artisan indépendant",
  manoeuvre: "Manœuvre indépendant",
};

function roleLabel(role: string | undefined, fallback: string): string {
  return (role && ROLE_LABELS[role]) || fallback;
}

function adresseDe(u: { address?: string | null; city?: string | null; country?: string | null }): string {
  const parts = [u.address, u.city, u.country].filter((v) => v && v.trim());
  return parts.length ? parts.join(", ") : "Adresse non renseignée";
}

async function buildPdf(doc: DevisDocument, docUrl: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const canvas = new PdfCanvas({
    pdf,
    regular,
    bold,
    headerTitle: `${doc.titre} — ${doc.missionTitre}`,
    docUrl,
  });
  canvas.newPage();

  // ── Titre + référence ──
  canvas.centered(doc.titre, { size: 16, font: bold, color: DARK, gap: 4 });
  canvas.centered(`Référence ${doc.reference}`, { size: 10.5, font: regular, color: GREY, gap: 4 });
  canvas.centered(doc.missionTitre, { size: 10.5, font: regular, color: GREY, gap: 14 });

  // ── Parties ──
  const labelW = widthsFor([0.42, 0.58]);
  const partyBox = (heading: string, party: DevisDocument["client"], gap: number) =>
    canvas.table({
      headers: [heading, party.name],
      rows: party.lines.map((l) => [l.label, l.value]),
      widths: labelW,
      align: ["right", "left"],
      darkCols: [1],
      gap,
    });
  partyBox("LE CLIENT", doc.client, 10);
  partyBox("ET LE PRESTATAIRE", doc.provider, 14);

  // ── Mention d'état ──
  canvas.wrapped(doc.mention, { size: 9.5, gap: 12, justify: true });

  // ── Détail chiffré ──
  canvas.heading("Détail du chiffrage", { size: 12 });
  canvas.rule();
  canvas.table({
    headers: ["#", "Poste", "Qté", "Unité", "P.U.", "Montant", "Échéance"],
    rows: doc.lines.map((l) => [l.numero, l.description, l.quantite, l.unite, l.prixUnitaire, l.montant, l.echeance]),
    widths: widthsFor([0.05, 0.33, 0.07, 0.09, 0.15, 0.16, 0.15]),
    align: ["left", "left", "right", "left", "right", "right", "left"],
    darkCols: [1, 5],
    gap: 10,
  });

  // ── Totaux ──
  canvas.table({
    headers: ["Récapitulatif", "Montant"],
    rows: doc.totals.map((t) => [t.label, t.value]),
    widths: widthsFor([0.65, 0.35]),
    align: ["left", "right"],
    darkCols: [1],
    gap: 14,
  });

  // ── Conditions ──
  canvas.heading("Conditions", { size: 12 });
  canvas.rule();
  canvas.table({
    headers: ["Élément", "Valeur"],
    rows: doc.conditions.map((c) => [c.label, c.value]),
    widths: labelW,
    align: ["right", "left"],
    darkCols: [1],
    gap: 14,
  });

  // ── Message du prestataire ──
  if (doc.notes) {
    canvas.keepSectionTogether(9.5, 3.6, 6, [doc.notes]);
    canvas.heading("Message du prestataire", { size: 12 });
    canvas.rule();
    canvas.wrapped(doc.notes, { size: 9.5, gap: 12, justify: true });
  }

  // ── Mentions ──
  canvas.keepSectionTogether(9.5, 3.6, 6, doc.mentionsLegales);
  canvas.heading("Mentions", { size: 12 });
  canvas.rule();
  for (const m of doc.mentionsLegales) {
    canvas.wrapped(m, { size: 9.5, gap: 6, justify: true });
  }

  canvas.wrapped(`Document généré automatiquement sur Flexwork — ${formatDateLong(new Date())}`, {
    size: 8,
    color: GREY,
    gap: 0,
    maxWidth: CONTENT_W,
  });

  canvas.finish();
  return pdf.save();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(doc: DevisDocument): string {
  const partyRows = (p: DevisDocument["client"]) =>
    p.lines.map((l) => `<tr><th>${escapeHtml(l.label)}</th><td>${escapeHtml(l.value)}</td></tr>`).join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${escapeHtml(doc.titre)} ${escapeHtml(doc.reference)}</title>
<style>
  :root { --green:#008751; --dark:#18181b; --grey:#6b7280; --border:#d9d9dd; --bg:#f2f2f3; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 24px 64px; font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif; color:var(--dark); max-width:840px; margin-inline:auto; }
  h1 { font-size:24px; text-align:center; margin:0 0 4px; }
  .ref, .mission { text-align:center; color:var(--grey); font-size:14px; margin:0 0 4px; }
  h2 { font-size:16px; color:var(--green); margin:28px 0 6px; border-bottom:1px solid var(--border); padding-bottom:6px; }
  table { width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; }
  th, td { border:1px solid var(--border); padding:7px 9px; text-align:left; vertical-align:top; }
  thead th, tbody th { background:var(--bg); font-weight:700; }
  tbody tr:nth-child(even) td { background:#fafafb; }
  td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .mention { background:var(--bg); border:1px solid var(--border); padding:10px 12px; border-radius:6px; margin:14px 0; }
  .total td { font-weight:700; background:var(--bg); }
  .legal p { color:var(--grey); font-size:12.5px; }
  footer { margin-top:32px; color:var(--grey); font-size:11.5px; text-align:center; }
  @media print { body { padding:0; } }
</style></head>
<body>
  <h1>${escapeHtml(doc.titre)}</h1>
  <p class="ref">Référence ${escapeHtml(doc.reference)}</p>
  <p class="mission">${escapeHtml(doc.missionTitre)}</p>

  <table><thead><tr><th>LE CLIENT</th><th>${escapeHtml(doc.client.name)}</th></tr></thead><tbody>${partyRows(doc.client)}</tbody></table>
  <table><thead><tr><th>ET LE PRESTATAIRE</th><th>${escapeHtml(doc.provider.name)}</th></tr></thead><tbody>${partyRows(doc.provider)}</tbody></table>

  <p class="mention">${escapeHtml(doc.mention)}</p>

  <h2>Détail du chiffrage</h2>
  <table>
    <thead><tr><th>#</th><th>Poste</th><th>Qté</th><th>Unité</th><th>P.U.</th><th>Montant</th><th>Échéance</th></tr></thead>
    <tbody>${doc.lines
      .map(
        (l) =>
          `<tr><td>${escapeHtml(l.numero)}</td><td>${escapeHtml(l.description)}</td><td class="num">${escapeHtml(l.quantite)}</td><td>${escapeHtml(l.unite)}</td><td class="num">${escapeHtml(l.prixUnitaire)}</td><td class="num">${escapeHtml(l.montant)}</td><td>${escapeHtml(l.echeance)}</td></tr>`
      )
      .join("")}</tbody>
  </table>

  <table>
    <thead><tr><th>Récapitulatif</th><th>Montant</th></tr></thead>
    <tbody>${doc.totals
      .map((t) => `<tr class="${t.emphasis ? "total" : ""}"><td>${escapeHtml(t.label)}</td><td class="num">${escapeHtml(t.value)}</td></tr>`)
      .join("")}</tbody>
  </table>

  <h2>Conditions</h2>
  <table><tbody>${doc.conditions
    .map((c) => `<tr><th>${escapeHtml(c.label)}</th><td>${escapeHtml(c.value)}</td></tr>`)
    .join("")}</tbody></table>

  ${doc.notes ? `<h2>Message du prestataire</h2><p>${escapeHtml(doc.notes).replace(/\n/g, "<br>")}</p>` : ""}

  <h2>Mentions</h2>
  <div class="legal">${doc.mentionsLegales.map((m) => `<p>${escapeHtml(m)}</p>`).join("")}</div>

  <footer>Document généré automatiquement sur Flexwork — ${escapeHtml(formatDateLong(new Date()))}</footer>
</body></html>`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, proposalId } = await params;

  const guard = await requireProposalParty(missionId, proposalId, userId);
  if (!guard.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const proposal = await prisma.missionProposal.findUnique({
    where: { id: proposalId },
    include: {
      provider: { select: { firstname: true, lastname: true, role: true, address: true, city: true, country: true, tel: true, email: true } },
      mission: {
        include: {
          client: { select: { firstname: true, lastname: true, role: true, address: true, city: true, country: true, tel: true, email: true } },
        },
      },
    },
  });
  // Une candidature sans chiffrage (« brouillon » : candidature envoyée, devis pas encore
  // soumis) n'a pas de document à produire — il n'y a littéralement rien à imprimer.
  if (!proposal || !proposal.devisData) {
    return NextResponse.json({ error: "devis_not_found" }, { status: 404 });
  }

  const devis = proposal.devisData as unknown as DevisData;
  const mission = proposal.mission;
  const definitif = proposal.status === "devis_valide" || proposal.status === "acceptee";

  const doc = buildDevisDocument({
    proposalId: proposal.id,
    missionTitre: mission.titre,
    missionDescription: mission.description,
    devise: mission.currency,
    devis,
    definitif,
    // Peut manquer sur une proposition validée avant l'ajout du champ : le document reste
    // « définitif » (c'est le statut qui l'établit) et tait simplement la date.
    valideLe: proposal.devisValideAt,
    round: proposal.roundActuel,
    roundsMax: mission.maxRevisionRounds,
    validiteJours: VALIDITE_JOURS,
    client: {
      name: [mission.client.firstname, mission.client.lastname].filter(Boolean).join(" ") || "Client",
      adresse: adresseDe(mission.client),
      tel: mission.client.tel,
      email: mission.client.email,
      roleLabel: roleLabel(mission.client.role, "Client"),
    },
    provider: {
      name: [proposal.provider.firstname, proposal.provider.lastname].filter(Boolean).join(" ") || "Prestataire",
      adresse: adresseDe(proposal.provider),
      tel: proposal.provider.tel,
      email: proposal.provider.email,
      roleLabel: roleLabel(proposal.provider.role, "Travailleur indépendant"),
    },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://flexwork.app";
  const docUrl = `${base}/api/missions/${missionId}/proposals/${proposalId}/devis/document?format=html`;
  const slug = definitif ? "devis-definitif" : "devis";

  const format = new URL(req.url).searchParams.get("format");

  // JSON : alimente la vue in-app (/missions/[id]/devis/[proposalId]) avec EXACTEMENT le
  // document servi en PDF et en HTML. L'écran ne recompose rien de son côté — c'est ce qui
  // garantit que ce qu'on lit à l'écran est ce qu'on télécharge.
  if (format === "json") {
    return NextResponse.json({ document: doc, definitif, pdfUrl: `${docUrl.replace("format=html", "format=pdf")}` });
  }

  if (format === "pdf") {
    const bytes = await buildPdf(doc, docUrl);
    // Buffer.from : le Uint8Array de pdf-lib (ArrayBufferLike) n'est pas accepté tel quel
    // comme BodyInit par les typages @types récents.
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}-${doc.reference}.pdf"`,
      },
    });
  }

  return new NextResponse(buildHtml(doc), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}-${doc.reference}.html"`,
    },
  });
}
