import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requireContractByMission } from "@/lib/resource-guard";
import { buildContractSections, buildContractParties, type ContractSnapshot } from "@/lib/contract-clauses";
import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

// Export documentaire du contrat de prestation — réservé aux deux parties (404 pour un
// tiers). Format HTML (autonome, imprimable) ou PDF (pdf-lib). Même source de vérité que
// l'écran : buildContractSections (src/lib/contract-clauses.ts).
//
// Le rendu PDF reproduit le UI/UX de l'export de référence « Contrat de prestation —
// Électricien(ne) d'équipement / Chantier » (2026-08-26) : bandeau d'en-tête paginé (titre +
// horodatage), titre centré + référence, blocs « LE CLIENT » / « ET LE PRESTATAIRE » en
// tableaux, tableau des jalons avec montant total, articles séparés par des filets, section
// signatures et pied de page « Page X sur Y ».

// Échelle typographique mesurée sur le modèle de référence (A4 595x842) et reprise ici :
//   titre 16 · référence 10,5 · titre d'article 12 · corps 9,5 · en-tête/pied 7.
// Le corps était déjà à la bonne taille ; l'écart marquant portait sur les titres d'articles
// (11 contre 12) et sur les bandes d'en-tête/pied (9 contre 7), trop lourdes pour du rappel.
//
// MARGIN reste à 56 pt et NE suit PAS le modèle (18 pt) : cette valeur y est un artefact
// d'impression navigateur (marges « étroites » de Chrome), pas un choix de mise en page —
// la recopier donnerait des lignes de 559 pt, illisibles à 9,5 pt.
const MARGIN = 56;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 32;

// Palette alignée sur l'app (et la référence) : #008751 titres d'articles, #18181b texte,
// #F2F2F3 bandeaux, #D9D9DD bordures.
const GREEN = rgb(0, 0.529, 0.318);
const DARK = rgb(0.094, 0.094, 0.106);
const GREY = rgb(0.42, 0.42, 0.46);
const HEADER_BG = rgb(0.949, 0.949, 0.953);
const TABLE_ALT = rgb(0.98, 0.98, 0.984);
const BORDER = rgb(0.851, 0.851, 0.867);

function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Helvetica (WinAnsi) ne connaît pas les espaces insécables étroites de toLocaleString("fr-FR")
// (U+202F/U+00A0) ni le « ✓ » — on les remplace par des glyphes sûrs avant de dessiner.
function sanitize(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

// Nettoyage typographique des paragraphes : espaces fines (Helvetica), double ponctuation
// (concaténation clause + description) et espaces multiples.
function cleanParagraph(s: string): string {
  return sanitize(s)
    .replace(/\.{2,}/g, ".")
    .replace(/\.\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMontant(n: number, devise: string): string {
  return sanitize(`${Math.round(n).toLocaleString("fr-FR")} ${devise}`);
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Horodatage du bloc de signatures, au format du modèle de référence : « 24 août 2026 à 18:17 ».
// La date seule (formatDateLong) ne suffit pas : deux signatures du même jour deviendraient
// indistinguables alors que leur ORDRE est justement ce que le contrat établit.
function formatDateSignature(d: Date): string {
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(/\u202f/g, " ");
  return `${formatDateLong(d)} à ${heure}`;
}

function formatDateTime(d: Date): string {
  return d
    .toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(/\u202f/g, " ");
}

function fingerprintCourt(fp: string): string {
  return fp.replace(/[^A-Fa-f0-9]/g, "").slice(0, 12).toUpperCase();
}

// Référence de certificat au format du modèle de référence : CERT-cmt7z5df-CLI-MT7Z69.
// L'identifiant brut (cuid de 25 caractères) était affiché tel quel : illisible, et sans
// indication de la partie qu'il couvre.
function certificatReference(contractRef: string, role: "CLIENT" | "PRESTATAIRE", certId: string): string {
  const partie = role === "CLIENT" ? "CLI" : "PRE";
  return `CERT-${contractRef.toLowerCase()}-${partie}-${certId.slice(-6).toUpperCase()}`;
}

type PdfParty = {
  fullName: string;
  roleLabel: string;
  adresse: string;
};

type PdfSignature = {
  name: string;
  roleLabel: string;
  fingerprint: string | null;
  certId: string | null;
  signedAt: Date | null;
  signatureId: string | null;
  signedDataHash: string | null;
  signerRole: "CLIENT" | "PRESTATAIRE";
};

type PdfParams = {
  reference: string;
  contractId: string;
  objet: string;
  docUrl: string;
  client: PdfParty;
  provider: PdfParty;
  signatureClient: PdfSignature | null;
  signatureProvider: PdfSignature | null;
  snapshot: ContractSnapshot;
};

class PdfDoc {
  private pdf: PDFDocument;
  private regular: PDFFont;
  private bold: PDFFont;
  private page!: PDFPage;
  private pages: PDFPage[] = [];
  private y = 0;
  private pageNo = 0;
  private params: PdfParams;

  constructor(pdf: PDFDocument, regular: PDFFont, bold: PDFFont, params: PdfParams) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.params = params;
  }

  async render() {
    this.newPage();
    this.title();
    this.partyBoxes();
    this.intro();
    this.articles();
    await this.signatures();
    // « Page X sur Y » n'est connu qu'une fois tout le contenu posé.
    this.pages.forEach((page, i) => this.drawFooter(page, i));
  }

  // ── Gestion des pages ──
  private newPage() {
    this.pageNo += 1;
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN - HEADER_H;
    this.drawHeader();
  }

  private ensure(h: number) {
    if (this.y - h < MARGIN + 14) this.newPage();
  }

  private drawHeader() {
    const p = this.page;
    p.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: HEADER_BG });
    const title = `Contrat de prestation — ${this.params.objet}`;
    p.drawText(title, { x: MARGIN, y: PAGE_H - HEADER_H + 13, size: 7, font: this.regular, color: GREY, maxWidth: PAGE_W - MARGIN * 2 - 150 });
    const right = formatDateTime(new Date());
    const rw = this.regular.widthOfTextAtSize(right, 9);
    p.drawText(right, { x: PAGE_W - MARGIN - rw, y: PAGE_H - HEADER_H + 13, size: 7, font: this.regular, color: GREY });
    // Filet de séparation sous le bandeau d'en-tête.
    p.drawLine({ start: { x: 0, y: PAGE_H - HEADER_H }, end: { x: PAGE_W, y: PAGE_H - HEADER_H }, thickness: 0.8, color: BORDER });
  }

  private drawFooter(page: PDFPage, index: number) {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 26, color: HEADER_BG });
    page.drawText(this.params.docUrl, { x: MARGIN, y: 9, size: 7, font: this.regular, color: GREY, maxWidth: PAGE_W - MARGIN * 2 - 120 });
    const right = `Page ${index + 1} sur ${this.pages.length}`;
    const rw = this.regular.widthOfTextAtSize(right, 7);
    page.drawText(right, { x: PAGE_W - MARGIN - rw, y: 9, size: 7, font: this.regular, color: GREY });
  }

  // ── Primitives de texte ──
  private wrapped(
    text: string,
    opts: { size?: number; font?: PDFFont; color?: Color; gap?: number; leading?: number; maxWidth?: number; indent?: number; justify?: boolean } = {}
  ) {
    const { size = 9.5, font = this.regular, color = DARK, gap = 0, leading = 3.6, maxWidth = CONTENT_W, indent = 0, justify = false } = opts;
    const usable = maxWidth - indent;
    for (const para of cleanParagraph(text).split("\n")) {
      const lines = wrapText(para, font, size, usable);
      lines.forEach((line, li) => {
        this.ensure(size + 3);
        const isLast = li === lines.length - 1;
        if (justify && !isLast && line.includes(" ")) {
          // Justifié : répartition de l'espace excédentaire entre les mots (style référence).
          const words = line.split(" ");
          const step = (usable - font.widthOfTextAtSize(line, size)) / (words.length - 1);
          const spaceW = font.widthOfTextAtSize(" ", size);
          let cx = MARGIN + indent;
          for (const wd of words) {
            this.page.drawText(wd, { x: cx, y: this.y, size, font, color });
            cx += font.widthOfTextAtSize(wd, size) + spaceW + step;
          }
        } else {
          this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color });
        }
        this.y -= size * 1.28 + leading;
      });
    }
    this.y -= gap;
  }

  // Hauteur (en points) du texte enveloppé — pour anticiper les sauts de page.
  private measureWrapped(text: string, size: number, leading: number, maxWidth: number): number {
    let h = 0;
    for (const para of cleanParagraph(text).split("\n")) {
      h += wrapText(para, this.regular, size, maxWidth).length * (size * 1.28 + leading);
    }
    return h;
  }

  // Fait démarrer une section (titre + filet + paragraphes) sur une nouvelle page si elle ne
  // tient pas dans l'espace restant — évite les paragraphes orphelins en bas de page.
  private keepSectionTogether(size: number, leading: number, gap: number, paragraphs: string[]) {
    const headingH = 11 * 1.28 + 2;
    const ruleH = 12;
    const parasH = paragraphs.reduce((acc, p) => acc + this.measureWrapped(p, size, leading, CONTENT_W) + gap, 0);
    if (this.y - (headingH + ruleH + parasH + 8) < MARGIN + 14) this.newPage();
  }

  private heading(text: string, opts: { size?: number; gap?: number } = {}) {
    const { size = 11, gap = 3 } = opts;
    this.ensure(size + 6);
    this.page.drawText(sanitize(text), { x: MARGIN, y: this.y, size, font: this.bold, color: GREEN });
    this.y -= size * 1.28 + gap;
  }

  private centered(text: string, opts: { size: number; font: PDFFont; color: Color; gap: number }) {
    const { size, font, color, gap } = opts;
    const w = font.widthOfTextAtSize(sanitize(text), size);
    this.ensure(size + 4);
    this.page.drawText(sanitize(text), { x: (PAGE_W - w) / 2, y: this.y, size, font, color });
    this.y -= size * 1.28 + gap;
  }

  private rule() {
    this.ensure(12);
    this.y -= 5;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.6, color: BORDER });
    this.y -= 7;
  }

  // ── Titre + référence ──
  private title() {
    this.centered("Contrat de prestation de services", { size: 16, font: this.bold, color: DARK, gap: 4 });
    this.centered(`Référence ${this.params.reference}`, { size: 10.5, font: this.regular, color: GREY, gap: 14 });
  }

  // ── Tableaux (blocs parties + tableau des jalons) ──
  private table(opts: {
    headers: string[];
    rows: string[][];
    widths?: number[];
    align?: ("left" | "right")[];
    total?: { label: string; value: string };
    gap?: number;
    darkCols?: number[];
  }) {
    const { headers, rows, total, darkCols = [] } = opts;
    const widths = opts.widths ?? headers.map(() => CONTENT_W / headers.length);
    const align = opts.align ?? headers.map(() => "left" as const);
    const pad = 5;
    const lineH = 11;
    const headerSize = 8.5;
    const bodySize = 9;

    const allRows: { cells: string[]; bold?: boolean; header?: boolean; alt?: boolean }[] = [
      { cells: headers, header: true },
      ...rows.map((r, i) => ({ cells: r, alt: i % 2 === 1 })),
    ];
    if (total) {
      allRows.push({
        cells: headers.map((_, i) => (i === 0 ? total.label : i === headers.length - 2 ? total.value : "")),
        bold: true,
      });
    }

    const heights = allRows.map((r) => {
      const maxLines = Math.max(
        1,
        ...r.cells.map((c, ci) =>
          wrapText(sanitize(c), r.header || r.bold ? this.bold : this.regular, r.header ? headerSize : bodySize, widths[ci] - pad * 2).length
        )
      );
      return maxLines * lineH + pad;
    });
    const totalH = heights.reduce((a, b) => a + b, 0);
    this.ensure(totalH + 8);

    // Coordonnées des colonnes (origines X, marge incluse).
    const colX: number[] = [];
    let x = MARGIN;
    for (const w of widths) {
      colX.push(x);
      x += w;
    }
    const top = this.y;
    let rowTop = top;

    for (let ri = 0; ri < allRows.length; ri++) {
      const r = allRows[ri];
      const h = heights[ri];
      const bottom = rowTop - h;
      const bg = r.header || r.bold ? HEADER_BG : r.alt ? TABLE_ALT : undefined;
      if (bg) {
        this.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_W, height: h, color: bg });
      }
      r.cells.forEach((cell, ci) => {
        const font = r.header || r.bold ? this.bold : this.regular;
        const size = r.header ? headerSize : bodySize;
        const lines = wrapText(sanitize(cell), font, size, widths[ci] - pad * 2);
        let baseline = rowTop - pad - size * 0.72;
        for (const ln of lines) {
          const tw = font.widthOfTextAtSize(ln, size);
          const lx = align[ci] === "right" ? colX[ci] + widths[ci] - pad - tw : colX[ci] + pad;
          const col = r.header || r.bold || darkCols.includes(ci) ? DARK : GREY;
          this.page.drawText(ln, { x: lx, y: baseline, size, font, color: col });
          baseline -= lineH;
        }
      });
      rowTop -= h;
    }

    // Filets : cadre extérieur, séparateurs de colonnes et de lignes.
    const bottom = top - totalH;
    this.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_W, height: totalH, borderColor: BORDER, borderWidth: 0.6 });
    for (let ci = 1; ci < widths.length; ci++) {
      const lx = colX[ci];
      this.page.drawLine({ start: { x: lx, y: top }, end: { x: lx, y: bottom }, thickness: 0.5, color: BORDER });
    }
    let ry = top;
    for (const h of heights) {
      ry -= h;
      this.page.drawLine({ start: { x: MARGIN, y: ry }, end: { x: PAGE_W - MARGIN, y: ry }, thickness: 0.5, color: BORDER });
    }

    this.y = bottom;
    this.y -= opts.gap ?? 0;
  }

  // ── Blocs « LE CLIENT » / « ET LE PRESTATAIRE » ──
  // Construits par buildContractParties (src/lib/contract-clauses.ts), la même source que
  // l'écran. Auparavant ce bloc était codé en dur ICI : le PDF affichait « Forme juridique »,
  // « SIRET » et « Représenté par » quand l'écran affichait adresse/téléphone/e-mail — même
  // contrat, deux en-têtes différents. Et les deux premiers ne sont jamais renseignés (le
  // schéma ne les collecte pas, ils n'existent pas dans cette juridiction) : le contrat signé
  // portait donc deux lignes « Non renseigné » permanentes, plus un « Représenté par » qui
  // répétait le nom déjà en en-tête faute de distinction personne morale / représentant.
  private partyBoxes() {
    const labelW = widthsFor([0.42, 0.58]);
    // `name` : repli sur l'identité jointe par l'API quand le snapshot ne le porte pas —
    // les contrats générés avant l'ajout du bloc Parties (2026-08-31) n'ont que id/email/tel
    // dans leur snapshot figé, et afficheraient sinon « Client » / « Prestataire ».
    // Même repli que l'écran (missions/[id]/contract/page.tsx).
    const parties = buildContractParties({
      reference: this.params.reference,
      client: { ...(this.params.snapshot.client ?? {}), name: this.params.snapshot.client?.name ?? this.params.client.fullName },
      provider: { ...(this.params.snapshot.provider ?? {}), name: this.params.snapshot.provider?.name ?? this.params.provider.fullName },
    });
    const box = (b: { heading: string; name: string; lines: { label: string; value: string }[] }, gap: number) =>
      this.table({
        headers: [b.heading, b.name],
        rows: b.lines.map((l) => [l.label, l.value]),
        widths: labelW,
        align: ["right", "left"],
        darkCols: [1],
        gap,
      });
    box(parties.client, 10);
    box(parties.provider, 14);
  }

  // ── Paragraphe d'introduction ──
  private intro() {
    this.wrapped(
      `Ci-après désignés ensemble « les Parties », il a été convenu et arrêté ce qui suit, dans le cadre de la mission référencée ${this.params.reference} initiée sur la plateforme.`,
      { size: 9.5, gap: 10, justify: true }
    );
  }

  // ── Articles ──
  private articles() {
    const sections = buildContractSections(this.params.snapshot);

    sections.forEach((s, idx) => {
      const paragraphs = s.paragraphs.filter((p) => p.trim());
      if (paragraphs.length === 0 && !s.table) return;
      const isLast = idx === sections.length - 1;

      // Le tableau vient de buildContractSections (source unique partagée avec l'écran) et
      // n'est plus reconstruit ici : l'ancienne version le rebâtissait depuis snapshot.jalons
      // et ne s'affichait donc PAS sur une mission sans jalon, alors que l'écran, lui,
      // montrait la ligne unique — l'écran et le PDF signé divergeaient.
      const table = s.table;
      if (!table) {
        // Garde le titre + filet + paragraphes ensemble (pas de paragraphe orphelin).
        this.keepSectionTogether(9.5, 2.8, 3, paragraphs);
      }
      this.heading(s.title, { size: 12, gap: 2 });
      this.rule();

      if (table) {
        // Rendu « Jalons et livrables » : intro → tableau → reste des paragraphes.
        if (paragraphs[0]) this.wrapped(paragraphs[0], { size: 9.5, gap: 6, justify: true });
        this.table({
          headers: table.columns,
          rows: table.rows,
          widths: widthsFor([0.08, 0.4, 0.16, 0.2, 0.16]),
          align: ["left", "left", "left", "right", "left"],
          total: { label: table.totalLabel, value: table.totalValue },
          gap: 8,
        });
        paragraphs.slice(1).forEach((p) => {
          this.wrapped(p, { size: 9.5, leading: 2.8, gap: 3, justify: true });
        });
      } else {
        for (const p of paragraphs) {
          this.wrapped(p, { size: 9.5, leading: 2.8, gap: 3, justify: true });
        }
      }

      // Respiration entre sections (les filets sont désormais sous les titres).
      if (!isLast) this.y -= 6;
      else this.y -= 2;
    });
  }

  // ── Signatures ──
  private async signatures() {
    // Section finale dédiée sur sa propre page, comme la référence : titre + texte + blocs QR
    // ne sont jamais séparés d'une page à l'autre.
    this.newPage();

    this.heading("Signatures électroniques", { size: 12, gap: 4 });
    this.wrapped(
      "Fait électroniquement, en un exemplaire numérique unique faisant foi entre les Parties, qui reconnaissent avoir pris connaissance de l'ensemble des clauses qui précèdent et les accepter sans réserve. Chaque signature est matérialisée par un QR code cryptographique vérifiable (RSA-SHA256, conforme eIDAS).",
      { size: 9, gap: 14, justify: true }
    );

    const gap = 12;
    const boxW = (CONTENT_W - gap) / 2;
    const boxH = 138; // + titre sur sa propre ligne (voir signatureBox)
    this.ensure(boxH + 8);

    const cl = this.params.signatureClient;
    const pr = this.params.signatureProvider;
    const fallbackSig = (party: PdfParty, signerRole: "CLIENT" | "PRESTATAIRE"): PdfSignature => ({
      name: party.fullName,
      roleLabel: party.roleLabel,
      fingerprint: null,
      certId: null,
      signedAt: null,
      signatureId: null,
      signedDataHash: null,
      signerRole,
    });

    // QR codes embarqués — même payload que le composant SignatureQRCode de l'écran.
    const qrClient = await this.embedSignatureQr(cl);
    const qrProvider = await this.embedSignatureQr(pr);
    this.signatureBox(MARGIN, boxW, boxH, "POUR LE CLIENT", cl ?? fallbackSig(this.params.client, "CLIENT"), qrClient);
    this.signatureBox(MARGIN + boxW + gap, boxW, boxH, "POUR LE PRESTATAIRE", pr ?? fallbackSig(this.params.provider, "PRESTATAIRE"), qrProvider);
    this.y -= boxH + 8;

    this.centered(`Document généré automatiquement sur Flexwork — ${formatDateLong(new Date())}`, {
      size: 8.5,
      font: this.regular,
      color: GREY,
      gap: 0,
    });
  }

  // Génère le QR PNG de la signature (même payload que src/components/signature-qrcode.tsx)
  // et l'embarque dans le PDF. Null si la signature n'existe pas encore (case « En attente »).
  private async embedSignatureQr(sig: PdfSignature | null): Promise<PDFImage | null> {
    if (!sig || !sig.signatureId || !sig.signedAt || !sig.signedDataHash) return null;
    const qrPayload = JSON.stringify({
      v: 1,
      cid: this.params.contractId,
      sid: sig.signatureId,
      role: sig.signerRole,
      signer: sig.name,
      ts: sig.signedAt.toISOString(),
      fingerprint: sig.fingerprint,
      hash: sig.signedDataHash,
      method: "RSA-SHA256",
      verify: "/api/signature/verify",
    });
    const buf = await QRCode.toBuffer(qrPayload, {
      width: 240,
      margin: 1,
      color: { dark: "#14213D", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    });
    return this.pdf.embedPng(buf);
  }

  private signatureBox(x: number, w: number, h: number, title: string, sig: PdfSignature, qr: PDFImage | null) {
    const top = this.y;
    const bottom = top - h;
    const left = x + 10;
    const rightEdge = x + w - 10;
    this.page.drawRectangle({ x, y: bottom, width: w, height: h, borderColor: BORDER, borderWidth: 0.6 });

    // Titre du bloc, sur SA PROPRE LIGNE.
    // Auparavant le titre était posé à top-14 et le nom à top-16, soit 2 points d'écart :
    // « POUR LE PRESTATAIRE » (8 pt gras, ~85 pt de large) débordait largement la gouttière
    // de 64 pt réservée au QR et venait se superposer au nom du signataire.
    const titleY = top - 14;
    this.page.drawText(title, { x: left, y: titleY, size: 8, font: this.bold, color: GREY });

    // QR code à gauche (54 px) ; texte à droite — le tout SOUS le titre.
    const qrSize = 54;
    const qrTop = top - 30 - qrSize;
    if (qr) {
      this.page.drawImage(qr, { x: left, y: qrTop, width: qrSize, height: qrSize });
    } else {
      this.page.drawRectangle({ x: left, y: qrTop, width: qrSize, height: qrSize, borderColor: BORDER, borderWidth: 0.5 });
      this.page.drawText("QR non disponible", { x: left + 2, y: qrTop + qrSize / 2 - 3, size: 6.5, font: this.regular, color: GREY });
    }

    const tx = left + qrSize + 10;
    const txW = rightEdge - tx;
    let yy = top - 32;
    this.page.drawText(sanitize(sig.name), { x: tx, y: yy, size: 9.5, font: this.bold, color: DARK, maxWidth: txW });
    yy -= 12;
    this.page.drawText(sanitize(sig.roleLabel), { x: tx, y: yy, size: 7.5, font: this.regular, color: GREY, maxWidth: txW });
    yy -= 10;
    if (sig.fingerprint) {
      this.page.drawText(fingerprintCourt(sig.fingerprint), { x: tx, y: yy, size: 7, font: this.regular, color: GREY });
      yy -= 10;
    }
    if (sig.certId) {
      const ref = certificatReference(this.params.reference, sig.signerRole, sig.certId);
      this.page.drawText(ref, { x: tx, y: yy, size: 7, font: this.regular, color: GREY, maxWidth: txW });
    }

    // Filet sous le bloc QR.
    const ruleY = qrTop - 8;
    this.page.drawLine({ start: { x: left, y: ruleY }, end: { x: rightEdge, y: ruleY }, thickness: 0.5, color: BORDER });

    // Statut de vérification.
    let vy = ruleY - 13;
    if (sig.signedAt) {
      this.drawCheck(left, vy);
      this.page.drawText("Signature vérifiable", { x: left + 10, y: vy, size: 8, font: this.bold, color: GREEN });
      vy -= 12;
      this.page.drawText(formatDateSignature(sig.signedAt), { x: left, y: vy, size: 8, font: this.regular, color: GREY });
    } else {
      this.page.drawText("En attente de signature", { x: left, y: vy, size: 8, font: this.regular, color: GREY });
    }
  }

  private drawCheck(x: number, y: number) {
    this.page.drawLine({ start: { x, y: y - 4 }, end: { x: x + 3, y: y - 1 }, thickness: 1, color: GREEN });
    this.page.drawLine({ start: { x: x + 3, y: y - 1 }, end: { x: x + 7, y: y - 6 }, thickness: 1, color: GREEN });
  }
}

// Largeurs de colonnes en fractions de la largeur utile, converties en points.
function widthsFor(fractions: number[]): number[] {
  return fractions.map((f) => CONTENT_W * f);
}

async function buildPdf(params: PdfParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const doc = new PdfDoc(pdf, regular, bold, params);
  await doc.render();
  return pdf.save();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: missionId } = await params;

  // F-02 étendu : seules les deux parties peuvent télécharger/voir le document du contrat.
  const guard = await requireContractByMission(missionId, userId);
  if (!guard.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contract = await prisma.prestationContract.findUnique({
    where: { id: guard.contract.id },
    include: {
      mission: {
        include: {
          client: { select: { id: true, firstname: true, lastname: true, role: true, address: true, city: true, country: true } },
          proposals: {
            where: { status: { in: ["acceptee", "devis_valide"] } },
            include: { provider: { select: { id: true, firstname: true, lastname: true, role: true, address: true, city: true, country: true } } },
          },
        },
      },
      signatures: { include: { certificate: { select: { userId: true, keyFingerprint: true, id: true, commonName: true } } } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const snapshot = contract.termsSnapshot as ContractSnapshot;
  const provider = contract.mission.proposals[0]?.provider;
  const clientName = [contract.mission.client.firstname, contract.mission.client.lastname].filter(Boolean).join(" ") || "Client";
  const providerName = [provider?.firstname, provider?.lastname].filter(Boolean).join(" ") || "Prestataire";

  const adresseDe = (u: { address?: string | null; city?: string | null; country?: string | null }): string => {
    const parts = [u.address, u.city, u.country].filter((v) => v && v.trim());
    return parts.length ? parts.join(", ") : "Adresse non renseignée";
  };
  const roleLabelDe = (role: string | undefined, fallback: string): string => {
    const labels: Record<string, string> = {
      artisan: "Artisan indépendant",
      manoeuvre: "Manœuvre indépendant",
      expert: "Expert indépendant",
      prestataire: "Prestataire indépendant",
    };
    return (role && labels[role]) || fallback;
  };

  const sigClientRow = contract.signatures.find((s) => s.certificate.userId === contract.mission.clientId);
  const sigProviderRow = contract.signatures.find((s) => s.certificate.userId === provider?.id);
  const toSig = (
    row: {
      id: string;
      signedAt: Date;
      signedDataHash: string;
      certificate: { keyFingerprint: string; id: string; commonName: string };
    } | undefined,
    name: string,
    roleLabel: string,
    signerRole: "CLIENT" | "PRESTATAIRE"
  ): PdfSignature | null =>
    row
      ? {
          name,
          roleLabel,
          fingerprint: row.certificate.keyFingerprint,
          certId: row.certificate.id,
          signedAt: row.signedAt,
          signatureId: row.id,
          signedDataHash: row.signedDataHash,
          signerRole,
        }
      : null;

  const reference = contract.id.slice(0, 8).toUpperCase();
  const format = new URL(req.url).searchParams.get("format");

  if (format === "pdf") {
    const bytes = await buildPdf({
      reference,
      contractId: contract.id,
      objet: snapshot.objet ?? "Mission",
      docUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://flexwork.app"}/api/missions/${missionId}/contract/document?format=html`,
      client: {
        fullName: clientName,
        roleLabel: roleLabelDe(contract.mission.client.role, "Client"),
        adresse: adresseDe(contract.mission.client),
      },
      provider: {
        fullName: providerName,
        roleLabel: roleLabelDe(provider?.role, "Travailleur indépendant"),
        adresse: adresseDe(provider ?? {}),
      },
      signatureClient: toSig(sigClientRow, clientName, roleLabelDe(contract.mission.client.role, "Client"), "CLIENT"),
      signatureProvider: toSig(sigProviderRow, providerName, roleLabelDe(provider?.role, "Travailleur indépendant"), "PRESTATAIRE"),
      snapshot,
    });
    // Buffer.from : le Uint8Array de pdf-lib (ArrayBufferLike) n'est pas accepté tel quel
    // comme BodyInit par les typages @types récents.
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contrat-${reference}.pdf"`,
      },
    });
  }

  // HTML autonome (imprimable — impression → PDF si besoin)
  const sections = buildContractSections(snapshot);
  const articlesHtml = sections
    .filter((s) => s.paragraphs.some((p) => p.trim()))
    .map(
      (s) => `
        <h2>${s.title}</h2>
        ${s.paragraphs.filter((p) => p.trim()).map((p) => `<p>${p}</p>`).join("")}
      `
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Contrat ${reference}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Inter, Arial, sans-serif; color: #18181b; max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.55; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #52525b; font-size: 13px; margin-bottom: 20px; }
  h2 { font-size: 14px; color: #008751; margin: 18px 0 6px; }
  p { font-size: 13px; margin: 6px 0; }
  .sign { margin-top: 28px; border-top: 1px solid #e4e4e7; padding-top: 12px; font-size: 12px; color: #52525b; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>Contrat de prestation de services</h1>
  <div class="meta">
    Référence ${reference}<br>
    Client : ${clientName}<br>
    Prestataire : ${providerName}<br>
    Établi sur la plateforme FlexWork — Bénin
  </div>
  ${articlesHtml}
  <div class="sign">
    Signatures électroniques matérialisées par QR code cryptographique vérifiable (RSA-SHA256) sur la plateforme.<br>
    Document généré automatiquement sur FlexWork.
  </div>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="contrat-${reference}.html"` },
  });
}
